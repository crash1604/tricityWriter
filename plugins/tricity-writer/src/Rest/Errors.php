<?php
/**
 * Shared REST error responses.
 *
 * @package TricityWriter
 */

namespace TricityWriter\Rest;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * WP_Error factories with consistent codes and statuses.
 */
final class Errors {

	/**
	 * The connected user lacks the capability for this operation.
	 */
	public static function forbidden(): WP_Error {
		return new WP_Error( 'tcw_forbidden', __( 'The connected user is not allowed to do this.', 'tricity-writer' ), array( 'status' => 403 ) );
	}

	/**
	 * A request parameter is invalid.
	 *
	 * @param string $param   Parameter name.
	 * @param string $message Human-readable reason.
	 */
	public static function invalid( string $param, string $message ): WP_Error {
		return new WP_Error(
			'tcw_invalid_param',
			$message,
			array(
				'status' => 400,
				'param'  => $param,
			)
		);
	}
}
