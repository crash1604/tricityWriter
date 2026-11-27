<?php
/**
 * Plugin updates from the paired TriCity Writer dashboard.
 *
 * @package TricityWriter
 */

namespace TricityWriter;

defined( 'ABSPATH' ) || exit;

/**
 * The connector is installed from the dashboard, not from WordPress.org, so WordPress asks this class
 * whether a newer version exists. The plugin's "Update URI" header routes that question to the
 * update_plugins_{hostname} filter (WordPress 5.8+) and keeps WordPress.org from offering updates for
 * a plugin that merely shares our slug.
 *
 * The answer comes from the version manifest the paired dashboard publishes next to the plugin zip.
 * Updates show up in WP admin like any other and install only when an administrator chooses to (or has
 * turned on auto-updates for this plugin).
 */
final class Updater {

	const SOURCE_OPTION   = 'tcw_update_source';
	const CACHE_TRANSIENT = 'tcw_update_manifest';
	// Must match the host of "Update URI" in tricity-writer.php. ".invalid" never resolves.
	const UPDATE_HOST   = 'tricity-writer.invalid';
	const MANIFEST_PATH = '/downloads/tricity-writer.json';
	const PACKAGE_PATH  = '/downloads/tricity-writer.zip';

	/**
	 * Registers the update hooks. Runs on every request: update checks also happen during cron.
	 */
	public static function boot(): void {
		add_filter( 'update_plugins_' . self::UPDATE_HOST, array( self::class, 'check' ), 10, 3 );
		add_filter( 'plugins_api', array( self::class, 'info' ), 10, 3 );
	}

	/**
	 * Remembers the dashboard address sent when pairing or checking status. The most recent one wins.
	 *
	 * Where updates come from decides what code an administrator installs, so only a connection whose
	 * user could install plugin updates anyway may set it (pairing codes can come from any author),
	 * and only over HTTPS, so the manifest and package can't be swapped in transit.
	 *
	 * @param string $url     Dashboard origin, e.g. https://app.example.com.
	 * @param int    $user_id WordPress user the connection acts as.
	 */
	public static function remember_source( string $url, int $user_id ): void {
		if ( ! user_can( $user_id, 'update_plugins' ) ) {
			return;
		}
		$url = untrailingslashit( esc_url_raw( $url, array( 'https' ) ) );
		if ( '' === $url || 'https' !== wp_parse_url( $url, PHP_URL_SCHEME ) || get_option( self::SOURCE_OPTION ) === $url ) {
			return;
		}
		update_option( self::SOURCE_OPTION, $url, false );
		delete_site_transient( self::CACHE_TRANSIENT );
	}

	/**
	 * Filter update_plugins_{hostname}: the newest version the dashboard offers.
	 *
	 * @param array|false $update      Update data from earlier callbacks, or false.
	 * @param array       $plugin_data Headers of the plugin being checked.
	 * @param string      $plugin_file Plugin basename, e.g. tricity-writer/tricity-writer.php.
	 * @return array|false
	 */
	public static function check( $update, $plugin_data, $plugin_file ) {
		if ( plugin_basename( TCW_PLUGIN_FILE ) !== $plugin_file ) {
			return $update;
		}
		$manifest = self::manifest();
		if ( null === $manifest ) {
			return $update;
		}
		return array(
			'id'           => 'https://' . self::UPDATE_HOST . '/connector',
			'slug'         => 'tricity-writer',
			'plugin'       => $plugin_file,
			'version'      => $manifest['version'],
			'url'          => $manifest['source'],
			'package'      => $manifest['package'],
			'requires'     => $manifest['requires'],
			'requires_php' => $manifest['requires_php'],
			'tested'       => $manifest['tested'],
		);
	}

	/**
	 * Filter plugins_api: the "View details" dialog in WP admin.
	 *
	 * @param false|object|array $result Earlier result.
	 * @param string             $action API action.
	 * @param object             $args   Request arguments.
	 * @return false|object|array
	 */
	public static function info( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || ! isset( $args->slug ) || 'tricity-writer' !== $args->slug ) {
			return $result;
		}
		$manifest = self::manifest();
		if ( null === $manifest ) {
			return $result;
		}
		return (object) array(
			'name'          => 'TriCity Writer Connector',
			'slug'          => 'tricity-writer',
			'version'       => $manifest['version'],
			'author'        => 'TriCity Writer',
			'homepage'      => $manifest['source'],
			'requires'      => $manifest['requires'],
			'requires_php'  => $manifest['requires_php'],
			'tested'        => $manifest['tested'],
			'download_link' => $manifest['package'],
			'sections'      => array(
				'description' => esc_html__( 'Connects this site to TriCity Writer so it can draft, publish and optimize content for you.', 'tricity-writer' ),
				'changelog'   => wp_kses_post( $manifest['changelog'] ),
			),
		);
	}

	/**
	 * The dashboard's manifest, cached for 12 hours (1 hour after a failed fetch).
	 *
	 * @return array{version: string, package: string, requires: string, requires_php: string, tested: string, changelog: string, source: string}|null
	 */
	private static function manifest(): ?array {
		$source = (string) get_option( self::SOURCE_OPTION, '' );
		if ( '' === $source ) {
			return null;
		}

		$cached = get_site_transient( self::CACHE_TRANSIENT );
		if ( is_array( $cached ) && isset( $cached['source'] ) && $cached['source'] === $source ) {
			return isset( $cached['manifest'] ) && is_array( $cached['manifest'] ) ? $cached['manifest'] : null;
		}

		$manifest = self::fetch( $source );
		set_site_transient(
			self::CACHE_TRANSIENT,
			array(
				'source'   => $source,
				'manifest' => $manifest,
			),
			null === $manifest ? HOUR_IN_SECONDS : 12 * HOUR_IN_SECONDS
		);
		return $manifest;
	}

	/**
	 * Downloads and validates the manifest.
	 *
	 * @param string $source Dashboard origin.
	 * @return array{version: string, package: string, requires: string, requires_php: string, tested: string, changelog: string, source: string}|null
	 */
	private static function fetch( string $source ): ?array {
		// wp_safe_remote_get refuses private and loopback addresses.
		$response = wp_safe_remote_get( $source . self::MANIFEST_PATH, array( 'timeout' => 10 ) );
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) || ! isset( $data['version'] ) || ! is_string( $data['version'] ) ) {
			return null;
		}
		if ( ! preg_match( '/^\d+\.\d+\.\d+$/', $data['version'] ) ) {
			return null;
		}

		// The package always comes from the paired dashboard itself, never from a URL in the manifest.
		return array(
			'version'      => $data['version'],
			'package'      => $source . self::PACKAGE_PATH,
			'requires'     => self::text( $data, 'requires', '6.0' ),
			'requires_php' => self::text( $data, 'requires_php', '7.4' ),
			'tested'       => self::text( $data, 'tested', '' ),
			'changelog'    => self::text( $data, 'changelog', '' ),
			'source'       => $source,
		);
	}

	/**
	 * A string field from the manifest, or a default.
	 *
	 * @param array  $data     Decoded manifest.
	 * @param string $key      Field name.
	 * @param string $fallback Default value.
	 */
	private static function text( array $data, string $key, string $fallback ): string {
		return isset( $data[ $key ] ) && is_string( $data[ $key ] ) ? $data[ $key ] : $fallback;
	}
}
