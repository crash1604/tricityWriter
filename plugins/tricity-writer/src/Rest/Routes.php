<?php
/**
 * REST routes. Mirrors the contract in packages/shared/src/connector.ts; change both together.
 *
 * @package TricityWriter
 */

namespace TricityWriter\Rest;

use TricityWriter\Auth;
use TricityWriter\Connections;
use TricityWriter\Pairing;
use TricityWriter\Plugin;
use TricityWriter\Updater;
use WP_Error;
use WP_HTTP_Response;
use WP_REST_Request;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the tricity-writer/v1 namespace. All writes use POST because many hosts and WAFs block
 * PUT, PATCH and DELETE.
 */
final class Routes {

	const REST_NAMESPACE = 'tricity-writer/v1';

	/**
	 * Hooked to rest_api_init.
	 */
	public static function register(): void {
		$authed = array( Auth::class, 'check' );

		// Unauthenticated: lets the platform's diagnostics tell "plugin missing" from "REST blocked".
		self::route( '/ping', WP_REST_Server::READABLE, array( self::class, 'ping' ), '__return_true' );
		// Unauthenticated by design: possession of an unexpired single-use code is the credential.
		self::route( '/pair', WP_REST_Server::CREATABLE, array( self::class, 'pair' ), '__return_true' );

		self::route( '/status', WP_REST_Server::READABLE, array( self::class, 'status' ), $authed );
		self::route( '/disconnect', WP_REST_Server::CREATABLE, array( self::class, 'disconnect' ), $authed );

		self::route( '/posts', WP_REST_Server::READABLE, array( Posts::class, 'index' ), $authed );
		self::route( '/posts', WP_REST_Server::CREATABLE, array( Posts::class, 'create' ), $authed );
		self::route( '/posts/(?P<id>\d+)', WP_REST_Server::READABLE, array( Posts::class, 'show' ), $authed );
		self::route( '/posts/(?P<id>\d+)', WP_REST_Server::CREATABLE, array( Posts::class, 'update' ), $authed );
		self::route( '/posts/(?P<id>\d+)/trash', WP_REST_Server::CREATABLE, array( Posts::class, 'trash' ), $authed );
		self::route( '/posts/(?P<id>\d+)/seo', WP_REST_Server::CREATABLE, array( Posts::class, 'seo' ), $authed );

		self::route( '/terms', WP_REST_Server::READABLE, array( Terms::class, 'index' ), $authed );
		self::route( '/media', WP_REST_Server::CREATABLE, array( Media::class, 'upload' ), $authed );
	}

	/**
	 * Registers one method on a route; routes with several methods are registered once per method.
	 *
	 * @param string   $path       Route path.
	 * @param string   $methods    HTTP methods.
	 * @param callable $callback   Handler.
	 * @param callable $permission Permission callback.
	 */
	private static function route( string $path, string $methods, $callback, $permission ): void {
		register_rest_route(
			self::REST_NAMESPACE,
			$path,
			array(
				'methods'             => $methods,
				'callback'            => $callback,
				'permission_callback' => $permission,
			)
		);
	}

	/**
	 * GET /ping
	 *
	 * @return array<string, string>
	 */
	public static function ping(): array {
		return array(
			'plugin'  => 'tricity-writer',
			'version' => TCW_VERSION,
		);
	}

	/**
	 * POST /pair: exchanges a pairing code for a long-lived connection token.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function pair( WP_REST_Request $request ) {
		$entry = Pairing::consume( (string) $request->get_param( 'code' ) );
		if ( null === $entry ) {
			return new WP_Error( 'tcw_invalid_code', __( 'Invalid or expired pairing code.', 'tricity-writer' ), array( 'status' => 403 ) );
		}

		list( $id, $token ) = Connections::create( $entry['name'], (int) $entry['user_id'] );
		Updater::remember_source( (string) $request->get_param( 'platform_url' ), (int) $entry['user_id'] );

		return array(
			'connection_id'   => $id,
			'token'           => $token,
			'connection_name' => $entry['name'],
			'site'            => Plugin::site_info(),
		);
	}

	/**
	 * GET /status: token-authenticated health check.
	 *
	 * @param WP_REST_Request $request Current request (optional platform_url).
	 * @return array<string, mixed>
	 */
	public static function status( WP_REST_Request $request ): array {
		$connection = (array) Auth::connection();
		$user       = wp_get_current_user();
		// Sites paired before the connector could update itself learn where updates come from here.
		Updater::remember_source( (string) $request->get_param( 'platform_url' ), $user->ID );

		return array(
			'connection_id'   => (string) $connection['id'],
			'connection_name' => (string) $connection['name'],
			'user'            => array(
				'id'           => $user->ID,
				'display_name' => $user->display_name,
			),
			'capabilities'    => array(
				'publish_posts'     => current_user_can( 'publish_posts' ),
				'edit_pages'        => current_user_can( 'edit_pages' ),
				'upload_files'      => current_user_can( 'upload_files' ),
				'manage_categories' => current_user_can( 'manage_categories' ),
				'unfiltered_html'   => current_user_can( 'unfiltered_html' ),
			),
			'site'            => Plugin::site_info(),
		);
	}

	/**
	 * POST /disconnect: the platform revokes its own connection when a site is removed there.
	 *
	 * @return array<string, bool>
	 */
	public static function disconnect(): array {
		$connection = (array) Auth::connection();
		Connections::revoke( (string) $connection['id'] );
		return array( 'ok' => true );
	}

	/**
	 * Hooked to rest_post_dispatch: connector responses must never be cached by page caches or CDNs.
	 *
	 * @param WP_HTTP_Response $response Outgoing response.
	 * @param WP_REST_Server   $server   REST server.
	 * @param WP_REST_Request  $request  Current request.
	 * @return WP_HTTP_Response
	 */
	public static function no_cache( $response, $server, $request ) {
		if ( $response instanceof WP_HTTP_Response && 0 === strpos( $request->get_route(), '/' . self::REST_NAMESPACE ) ) {
			$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
			do_action( 'litespeed_control_set_nocache', 'tricity-writer connector' );
		}
		return $response;
	}
}
