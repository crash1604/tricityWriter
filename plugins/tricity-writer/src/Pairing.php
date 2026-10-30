<?php
/**
 * One-time pairing codes.
 *
 * @package TricityWriter
 */

namespace TricityWriter;

defined( 'ABSPATH' ) || exit;

/**
 * Issues and redeems single-use pairing codes.
 *
 * Codes live in a non-autoloaded option rather than transients, because persistent object caches
 * can evict transients before they expire. Only a hash of each code is stored.
 */
final class Pairing {

	const OPTION = 'tcw_pairing_codes';
	const TTL    = 600;

	// 32 symbols without look-alikes (0/O, 1/I); 12 of them give 60 bits, too many to brute force.
	const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const LENGTH   = 12;

	/**
	 * Creates a code bound to a connection name and the WordPress user who generated it.
	 *
	 * @param string $name    Human-readable connection name.
	 * @param int    $user_id User the connection will act as.
	 * @return string Code formatted for display, e.g. "ABCD-EFGH-JKLM".
	 */
	public static function issue( string $name, int $user_id ): string {
		$raw = '';
		for ( $i = 0; $i < self::LENGTH; $i++ ) {
			$raw .= self::ALPHABET[ random_int( 0, strlen( self::ALPHABET ) - 1 ) ];
		}

		$codes = self::pending();

		$codes[ self::hash( $raw ) ] = array(
			'name'       => $name,
			'user_id'    => $user_id,
			'expires_at' => time() + self::TTL,
		);
		update_option( self::OPTION, $codes, false );

		return implode( '-', str_split( $raw, 4 ) );
	}

	/**
	 * Redeems a code. A matching code is deleted on first use.
	 *
	 * @param string $code Code as typed by the user; separators and case are ignored.
	 * @return array{name: string, user_id: int, expires_at: int}|null Null when unknown or expired.
	 */
	public static function consume( string $code ): ?array {
		$raw   = strtoupper( (string) preg_replace( '/[^A-Za-z0-9]/', '', $code ) );
		$hash  = self::hash( $raw );
		$codes = self::pending();

		if ( ! isset( $codes[ $hash ] ) ) {
			update_option( self::OPTION, $codes, false );
			return null;
		}

		$entry = $codes[ $hash ];
		unset( $codes[ $hash ] );
		update_option( self::OPTION, $codes, false );

		return $entry;
	}

	/**
	 * Unexpired codes, keyed by hash.
	 *
	 * @return array<string, array{name: string, user_id: int, expires_at: int}>
	 */
	private static function pending(): array {
		$codes = get_option( self::OPTION, array() );
		if ( ! is_array( $codes ) ) {
			return array();
		}

		$now = time();
		return array_filter(
			$codes,
			static function ( $entry ) use ( $now ) {
				return is_array( $entry ) && isset( $entry['expires_at'] ) && $entry['expires_at'] > $now;
			}
		);
	}

	/**
	 * Hash used for storage and lookup.
	 *
	 * @param string $raw Normalized code.
	 */
	private static function hash( string $raw ): string {
		return hash( 'sha256', $raw );
	}
}
