<?php
/**
 * Removes all connector data when the plugin is deleted (deactivation keeps connections).
 *
 * @package TricityWriter
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'tcw_connections' );
delete_option( 'tcw_pairing_codes' );
delete_option( 'tcw_update_source' );
delete_site_transient( 'tcw_update_manifest' );
