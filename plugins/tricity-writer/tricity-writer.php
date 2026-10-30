<?php
/**
 * Plugin Name:       TriCity Writer Connector
 * Description:       Connects this site to TriCity Writer so it can draft, publish and optimize content for you.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            TriCity Writer
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       tricity-writer
 *
 * @package TricityWriter
 */

defined( 'ABSPATH' ) || exit;

define( 'TCW_VERSION', '0.1.0' );

// PSR-4 style autoloading for TricityWriter\ classes in src/, without a Composer runtime dependency.
spl_autoload_register(
	static function ( $class_name ) {
		$prefix = 'TricityWriter\\';
		if ( 0 !== strpos( $class_name, $prefix ) ) {
			return;
		}
		$path = __DIR__ . '/src/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';
		if ( is_readable( $path ) ) {
			require $path;
		}
	}
);

TricityWriter\Plugin::boot();
