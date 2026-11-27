<?php
/**
 * Plugin bootstrap.
 *
 * @package TricityWriter
 */

namespace TricityWriter;

defined( 'ABSPATH' ) || exit;

/**
 * Wires hooks and exposes site facts shared by several routes.
 */
final class Plugin {

	/**
	 * Registers all hooks. Called once from the main plugin file.
	 */
	public static function boot(): void {
		add_action( 'rest_api_init', array( Rest\Routes::class, 'register' ) );
		add_filter( 'rest_post_dispatch', array( Rest\Routes::class, 'no_cache' ), 10, 3 );
		Seo::boot();
		Updater::boot();

		if ( is_admin() ) {
			Admin\Page::boot();
		}
	}

	/**
	 * Site facts returned on pairing and status. Mirrors siteInfoSchema in packages/shared.
	 *
	 * @return array<string, string|null>
	 */
	public static function site_info(): array {
		return array(
			'name'           => (string) get_bloginfo( 'name' ),
			'url'            => home_url(),
			'wp_version'     => (string) get_bloginfo( 'version' ),
			'plugin_version' => TCW_VERSION,
			'seo_plugin'     => Seo::detect(),
		);
	}
}
