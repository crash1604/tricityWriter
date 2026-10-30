<?php
/**
 * Media upload endpoint.
 *
 * @package TricityWriter
 */

namespace TricityWriter\Rest;

use WP_Error;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

/**
 * Accepts base64 images (already optimized by the platform) and adds them to the media library.
 */
final class Media {

	const MAX_BYTES = 10485760;

	const EXTENSIONS = array(
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/webp' => 'webp',
		'image/gif'  => 'gif',
	);

	/**
	 * POST /media
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function upload( WP_REST_Request $request ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return Errors::forbidden();
		}

		$mime = (string) $request->get_param( 'mime_type' );
		if ( ! isset( self::EXTENSIONS[ $mime ] ) ) {
			return Errors::invalid( 'mime_type', __( 'Only JPEG, PNG, WebP and GIF images are accepted.', 'tricity-writer' ) );
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- binary upload transport.
		$bytes = base64_decode( (string) $request->get_param( 'data' ), true );
		if ( false === $bytes || '' === $bytes ) {
			return Errors::invalid( 'data', __( 'Image data must be base64.', 'tricity-writer' ) );
		}
		if ( strlen( $bytes ) > self::MAX_BYTES ) {
			return Errors::invalid( 'data', __( 'Image is larger than 10 MB.', 'tricity-writer' ) );
		}

		$post_id = (int) $request->get_param( 'post_id' );
		if ( $post_id && ! current_user_can( 'edit_post', $post_id ) ) {
			return Errors::forbidden();
		}

		$name = sanitize_file_name( pathinfo( (string) $request->get_param( 'filename' ), PATHINFO_FILENAME ) );
		if ( '' === $name ) {
			$name = 'image';
		}
		$upload = wp_upload_bits( $name . '.' . self::EXTENSIONS[ $mime ], null, $bytes );
		if ( ! empty( $upload['error'] ) ) {
			return new WP_Error( 'tcw_upload_failed', (string) $upload['error'], array( 'status' => 500 ) );
		}

		// The bytes must really be the declared image type, whatever the request claims.
		if ( wp_get_image_mime( $upload['file'] ) !== $mime ) {
			wp_delete_file( $upload['file'] );
			return Errors::invalid( 'data', __( 'The file is not a valid image of the declared type.', 'tricity-writer' ) );
		}

		$title         = (string) $request->get_param( 'title' );
		$attachment_id = wp_insert_attachment(
			array(
				'post_mime_type' => $mime,
				'post_title'     => sanitize_text_field( '' !== $title ? $title : $name ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			),
			$upload['file'],
			$post_id,
			true
		);
		if ( is_wp_error( $attachment_id ) ) {
			wp_delete_file( $upload['file'] );
			return $attachment_id;
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		wp_update_attachment_metadata( $attachment_id, wp_generate_attachment_metadata( $attachment_id, $upload['file'] ) );

		$alt = sanitize_text_field( (string) $request->get_param( 'alt' ) );
		if ( '' !== $alt ) {
			update_post_meta( $attachment_id, '_wp_attachment_image_alt', wp_slash( $alt ) );
		}

		return self::describe( $attachment_id );
	}

	/**
	 * Attachment fields. Mirrors mediaSchema.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return array<string, mixed>
	 */
	private static function describe( int $attachment_id ): array {
		$meta = wp_get_attachment_metadata( $attachment_id );
		return array(
			'id'        => $attachment_id,
			'url'       => (string) wp_get_attachment_url( $attachment_id ),
			'mime_type' => (string) get_post_mime_type( $attachment_id ),
			'width'     => isset( $meta['width'] ) ? (int) $meta['width'] : null,
			'height'    => isset( $meta['height'] ) ? (int) $meta['height'] : null,
			'alt'       => (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true ),
		);
	}
}
