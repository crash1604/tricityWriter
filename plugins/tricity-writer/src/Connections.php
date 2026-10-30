<?php
/**
 * Paired connections.
 *
 * @package TricityWriter
 */

namespace TricityWriter;

defined( 'ABSPATH' ) || exit;

/**
 * Stores paired connections. Each one acts as the WordPress user who generated its pairing code and
 * is identified by a random token, of which only a SHA-256 hash is kept.
 */
final class Connections {

	const OPTION = 'tcw_connections';

	// Avoid an option write on every request; last-seen only needs minute precision.
	const TOUCH_INTERVAL = 60;

	/**
	 * All connections, keyed by connection id.
	 *
	 * @return array<string, array{name: string, user_id: int, token_hash: string, created_at: int, last_seen_at: int|null}>
	 */
	public static function all(): array {
		$value = get_option( self::OPTION, array() );
		return is_array( $value ) ? $value : array();
	}

	/**
	 * Creates a connection and returns its id and plain token. The token is never retrievable again.
	 *
	 * @param string $name    Human-readable name chosen at pairing time.
	 * @param int    $user_id User the connection acts as.
	 * @return array{0: string, 1: string} [connection id, token]
	 */
	public static function create( string $name, int $user_id ): array {
		$id    = wp_generate_uuid4();
		$token = 'tcw_' . bin2hex( random_bytes( 32 ) );

		$all        = self::all();
		$all[ $id ] = array(
			'name'         => $name,
			'user_id'      => $user_id,
			'token_hash'   => self::hash( $token ),
			'created_at'   => time(),
			'last_seen_at' => null,
		);
		update_option( self::OPTION, $all, false );

		return array( $id, $token );
	}

	/**
	 * Looks a connection up by its plain token.
	 *
	 * @param string $token Token sent by the platform.
	 * @return array<string, mixed>|null The connection record plus its 'id', or null.
	 */
	public static function find_by_token( string $token ): ?array {
		$hash = self::hash( $token );
		foreach ( self::all() as $id => $connection ) {
			if ( isset( $connection['token_hash'] ) && hash_equals( $connection['token_hash'], $hash ) ) {
				return array( 'id' => (string) $id ) + $connection;
			}
		}
		return null;
	}

	/**
	 * Deletes a connection. Its token stops working immediately.
	 *
	 * @param string $id Connection id.
	 * @return bool Whether a connection was removed.
	 */
	public static function revoke( string $id ): bool {
		$all = self::all();
		if ( ! isset( $all[ $id ] ) ) {
			return false;
		}
		unset( $all[ $id ] );
		update_option( self::OPTION, $all, false );
		return true;
	}

	/**
	 * Records that a connection was used.
	 *
	 * @param string $id Connection id.
	 */
	public static function touch( string $id ): void {
		$all = self::all();
		if ( ! isset( $all[ $id ] ) ) {
			return;
		}
		$now = time();
		if ( null !== $all[ $id ]['last_seen_at'] && $now - $all[ $id ]['last_seen_at'] < self::TOUCH_INTERVAL ) {
			return;
		}
		$all[ $id ]['last_seen_at'] = $now;
		update_option( self::OPTION, $all, false );
	}

	/**
	 * Hash used for storage and lookup.
	 *
	 * @param string $token Plain token.
	 */
	private static function hash( string $token ): string {
		return hash( 'sha256', $token );
	}
}
