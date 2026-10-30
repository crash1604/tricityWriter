<?php
/**
 * Admin screen: generate pairing codes and manage connections.
 *
 * @package TricityWriter
 */

namespace TricityWriter\Admin;

use TricityWriter\Connections;
use TricityWriter\Pairing;

defined( 'ABSPATH' ) || exit;

/**
 * The "TriCity Writer" admin menu page.
 */
final class Page {

	const SLUG = 'tricity-writer';

	/**
	 * Code generated during this request, shown once.
	 *
	 * @var string|null
	 */
	private static $code = null;

	/**
	 * Notice for this request: array{0: 'success'|'error', 1: string}.
	 *
	 * @var array<int, string>|null
	 */
	private static $notice = null;

	/**
	 * Registers admin hooks.
	 */
	public static function boot(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
	}

	/**
	 * Hooked to admin_menu.
	 */
	public static function menu(): void {
		$hook = add_menu_page(
			__( 'TriCity Writer', 'tricity-writer' ),
			__( 'TriCity Writer', 'tricity-writer' ),
			'edit_posts',
			self::SLUG,
			array( self::class, 'render' ),
			'dashicons-edit-page'
		);
		add_action( 'load-' . $hook, array( self::class, 'handle_post' ) );
	}

	/**
	 * Handles form submissions before the page renders.
	 */
	public static function handle_post(): void {
		if ( ! isset( $_POST['tcw_action'] ) ) {
			return;
		}
		$action = sanitize_key( wp_unslash( $_POST['tcw_action'] ) );

		if ( 'generate' === $action ) {
			check_admin_referer( 'tcw_generate' );
			$name = isset( $_POST['tcw_name'] ) ? sanitize_text_field( wp_unslash( $_POST['tcw_name'] ) ) : '';
			if ( '' === $name ) {
				self::$notice = array( 'error', __( 'Give the connection a name so you can recognize it later.', 'tricity-writer' ) );
				return;
			}
			self::$code = Pairing::issue( $name, get_current_user_id() );
			return;
		}

		if ( 'revoke' === $action ) {
			check_admin_referer( 'tcw_revoke' );
			$id          = isset( $_POST['tcw_connection'] ) ? sanitize_text_field( wp_unslash( $_POST['tcw_connection'] ) ) : '';
			$connections = self::visible_connections();
			if ( isset( $connections[ $id ] ) && Connections::revoke( $id ) ) {
				self::$notice = array( 'success', __( 'Connection revoked.', 'tricity-writer' ) );
			} else {
				self::$notice = array( 'error', __( 'Connection not found.', 'tricity-writer' ) );
			}
		}
	}

	/**
	 * Administrators see every connection; other users only their own.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	private static function visible_connections(): array {
		$all = Connections::all();
		if ( current_user_can( 'manage_options' ) ) {
			return $all;
		}
		$user_id = get_current_user_id();
		return array_filter(
			$all,
			static function ( $connection ) use ( $user_id ) {
				return (int) $connection['user_id'] === $user_id;
			}
		);
	}

	/**
	 * Renders the page.
	 */
	public static function render(): void {
		$connections = self::visible_connections();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'TriCity Writer', 'tricity-writer' ); ?></h1>

			<?php if ( null !== self::$notice ) : ?>
				<div class="notice notice-<?php echo esc_attr( self::$notice[0] ); ?>"><p><?php echo esc_html( self::$notice[1] ); ?></p></div>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Connect new account', 'tricity-writer' ); ?></h2>
			<?php if ( null !== self::$code ) : ?>
				<p><?php esc_html_e( 'Enter this code in TriCity Writer within 10 minutes. It works once.', 'tricity-writer' ); ?></p>
				<p><code id="tcw-pairing-code" style="font-size:1.6em;padding:.4em .6em;"><?php echo esc_html( self::$code ); ?></code></p>
			<?php else : ?>
				<form method="post">
					<?php wp_nonce_field( 'tcw_generate' ); ?>
					<input type="hidden" name="tcw_action" value="generate" />
					<p>
						<label for="tcw-name"><?php esc_html_e( 'Connection name', 'tricity-writer' ); ?></label><br />
						<input type="text" id="tcw-name" name="tcw_name" class="regular-text" required
							placeholder="<?php esc_attr_e( 'e.g. Marketing team', 'tricity-writer' ); ?>" />
					</p>
					<?php submit_button( __( 'Generate pairing code', 'tricity-writer' ), 'primary', 'submit', false ); ?>
				</form>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Connections', 'tricity-writer' ); ?></h2>
			<?php if ( array() === $connections ) : ?>
				<p><?php esc_html_e( 'No connections yet.', 'tricity-writer' ); ?></p>
			<?php else : ?>
				<table class="widefat striped">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Name', 'tricity-writer' ); ?></th>
							<th><?php esc_html_e( 'Acts as', 'tricity-writer' ); ?></th>
							<th><?php esc_html_e( 'Created', 'tricity-writer' ); ?></th>
							<th><?php esc_html_e( 'Last used', 'tricity-writer' ); ?></th>
							<th></th>
						</tr>
					</thead>
					<tbody>
					<?php foreach ( $connections as $id => $connection ) : ?>
						<?php $user = get_userdata( (int) $connection['user_id'] ); ?>
						<tr>
							<td><?php echo esc_html( $connection['name'] ); ?></td>
							<td><?php echo esc_html( $user ? $user->display_name : __( '(deleted user)', 'tricity-writer' ) ); ?></td>
							<td><?php echo esc_html( wp_date( get_option( 'date_format' ), $connection['created_at'] ) ); ?></td>
							<td><?php echo esc_html( $connection['last_seen_at'] ? human_time_diff( $connection['last_seen_at'] ) : __( 'Never', 'tricity-writer' ) ); ?></td>
							<td>
								<form method="post">
									<?php wp_nonce_field( 'tcw_revoke' ); ?>
									<input type="hidden" name="tcw_action" value="revoke" />
									<input type="hidden" name="tcw_connection" value="<?php echo esc_attr( $id ); ?>" />
									<?php submit_button( __( 'Revoke', 'tricity-writer' ), 'delete small', 'submit', false ); ?>
								</form>
							</td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<?php
	}
}
