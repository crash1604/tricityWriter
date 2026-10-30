<?php
/**
 * Connection token authentication.
 *
 * @package TricityWriter
 */

namespace TricityWriter;

use WP_Error;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

/**
 * Authenticates REST requests by connection token and switches to the connection's user.
 */
final class Auth {

	/**
	 * Connection resolved for the current request.
	 *
	 * @var array<string, mixed>|null
	 */
	private static $connection = null;

	/**
	 * Permission callback for token-authenticated routes.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public static function check( WP_REST_Request $request ) {
		$token = self::token_from( $request );
		if ( '' === $token ) {
			return new WP_Error( 'tcw_missing_token', __( 'Missing connection token.', 'tricity-writer' ), array( 'status' => 401 ) );
		}

		$connection = Connections::find_by_token( $token );
		if ( null === $connection ) {
			return new WP_Error( 'tcw_invalid_token', __( 'Invalid or revoked connection token.', 'tricity-writer' ), array( 'status' => 401 ) );
		}

		$user = get_userdata( (int) $connection['user_id'] );
		if ( ! $user || ! user_can( $user, 'edit_posts' ) ) {
			return new WP_Error( 'tcw_user_not_allowed', __( 'The connected user can no longer edit posts.', 'tricity-writer' ), array( 'status' => 403 ) );
		}

		wp_set_current_user( $user->ID );
		Connections::touch( (string) $connection['id'] );
		self::$connection = $connection;

		return true;
	}

	/**
	 * The connection authenticated by check(), for use inside route callbacks.
	 *
	 * @return array<string, mixed>|null
	 */
	public static function connection(): ?array {
		return self::$connection;
	}

	/**
	 * Reads the token from X-TCW-Token, falling back to Authorization: Bearer. The custom header comes
	 * first because many hosts strip Authorization before PHP sees it.
	 *
	 * @param WP_REST_Request $request Current request.
	 */
	private static function token_from( WP_REST_Request $request ): string {
		$token = trim( (string) $request->get_header( 'x-tcw-token' ) );
		if ( '' !== $token ) {
			return $token;
		}

		$authorization = (string) $request->get_header( 'authorization' );
		if ( 0 === stripos( $authorization, 'Bearer ' ) ) {
			return trim( substr( $authorization, 7 ) );
		}
		return '';
	}
}
