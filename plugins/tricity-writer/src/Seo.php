<?php
/**
 * SEO plugin detection and field adapters.
 *
 * @package TricityWriter
 */

namespace TricityWriter;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the neutral SEO fields {title, description, focus_keyword} through whichever SEO
 * plugin is active. Without one, the fields are kept in our own meta and printed in the page head.
 */
final class Seo {

	const META_KEYS = array(
		'yoast'    => array(
			'title'         => '_yoast_wpseo_title',
			'description'   => '_yoast_wpseo_metadesc',
			'focus_keyword' => '_yoast_wpseo_focuskw',
		),
		'rankmath' => array(
			'title'         => 'rank_math_title',
			'description'   => 'rank_math_description',
			'focus_keyword' => 'rank_math_focus_keyword',
		),
		// AIOSEO's source of truth is its own aioseo_posts table (see write_aioseo()); it also mirrors
		// title and description into these meta keys.
		'aioseo'   => array(
			'title'         => '_aioseo_title',
			'description'   => '_aioseo_description',
			'focus_keyword' => '_tcw_seo_focus_keyword',
		),
		'none'     => array(
			'title'         => '_tcw_seo_title',
			'description'   => '_tcw_seo_description',
			'focus_keyword' => '_tcw_seo_focus_keyword',
		),
	);

	/**
	 * Registers front-end output used when no SEO plugin is active.
	 */
	public static function boot(): void {
		add_filter( 'pre_get_document_title', array( self::class, 'document_title' ), 20 );
		add_action( 'wp_head', array( self::class, 'meta_description' ), 1 );
	}

	/**
	 * The active SEO plugin, or null when none of the supported ones is active.
	 *
	 * @return string|null One of 'yoast', 'rankmath', 'aioseo'.
	 */
	public static function detect(): ?string {
		if ( defined( 'WPSEO_VERSION' ) ) {
			return 'yoast';
		}
		if ( defined( 'RANK_MATH_VERSION' ) ) {
			return 'rankmath';
		}
		if ( defined( 'AIOSEO_VERSION' ) ) {
			return 'aioseo';
		}
		return null;
	}

	/**
	 * Current SEO fields for a post.
	 *
	 * @param int $post_id Post ID.
	 * @return array{title: string, description: string, focus_keyword: string}
	 */
	public static function read( int $post_id ): array {
		$plugin = self::detect();
		$fields = array();
		foreach ( self::keys( $plugin ) as $field => $key ) {
			$fields[ $field ] = (string) get_post_meta( $post_id, $key, true );
		}

		if ( 'aioseo' === $plugin ) {
			$model = self::aioseo_model( $post_id );
			if ( $model && ! empty( $model->id ) ) {
				$fields['title']       = (string) $model->title;
				$fields['description'] = (string) $model->description;
			}
		}
		return $fields;
	}

	/**
	 * Writes the given fields; fields not present are left unchanged.
	 *
	 * @param int                   $post_id Post ID.
	 * @param array<string, string> $fields  Any of title, description, focus_keyword.
	 */
	public static function write( int $post_id, array $fields ): void {
		$plugin = self::detect();
		foreach ( self::keys( $plugin ) as $field => $key ) {
			if ( isset( $fields[ $field ] ) ) {
				update_post_meta( $post_id, $key, wp_slash( $fields[ $field ] ) );
			}
		}
		if ( 'aioseo' === $plugin ) {
			self::write_aioseo( $post_id, $fields );
		}
	}

	/**
	 * Hooked to pre_get_document_title.
	 *
	 * @param string $title Title so far.
	 */
	public static function document_title( $title ) {
		$value = self::own_value( 'title' );
		return '' !== $value ? $value : $title;
	}

	/**
	 * Hooked to wp_head.
	 */
	public static function meta_description(): void {
		$value = self::own_value( 'description' );
		if ( '' !== $value ) {
			printf( '<meta name="description" content="%s" />' . "\n", esc_attr( $value ) );
		}
	}

	/**
	 * Our own stored field for the current singular page, when no SEO plugin handles output.
	 *
	 * @param string $field Field name.
	 */
	private static function own_value( string $field ): string {
		if ( null !== self::detect() || ! is_singular() ) {
			return '';
		}
		return (string) get_post_meta( (int) get_queried_object_id(), self::META_KEYS['none'][ $field ], true );
	}

	/**
	 * Meta keys for a plugin.
	 *
	 * @param string|null $plugin Detected plugin.
	 * @return array<string, string>
	 */
	private static function keys( ?string $plugin ): array {
		return self::META_KEYS[ null === $plugin ? 'none' : $plugin ];
	}

	/**
	 * AIOSEO's per-post model, when its classes are available.
	 *
	 * @param int $post_id Post ID.
	 * @return object|null
	 */
	private static function aioseo_model( int $post_id ) {
		$class = '\AIOSEO\Plugin\Common\Models\Post';
		if ( ! class_exists( $class ) || ! method_exists( $class, 'getPost' ) ) {
			return null;
		}
		return call_user_func( array( $class, 'getPost' ), $post_id );
	}

	/**
	 * Writes title, description and focus keyphrase into AIOSEO's own table.
	 *
	 * @param int                   $post_id Post ID.
	 * @param array<string, string> $fields  Fields to write.
	 */
	private static function write_aioseo( int $post_id, array $fields ): void {
		$model = self::aioseo_model( $post_id );
		if ( ! $model ) {
			return;
		}
		$model->post_id = $post_id;
		if ( isset( $fields['title'] ) ) {
			$model->title = $fields['title'];
		}
		if ( isset( $fields['description'] ) ) {
			$model->description = $fields['description'];
		}
		if ( isset( $fields['focus_keyword'] ) ) {
			$model->keyphrases = wp_json_encode(
				array(
					'focus'      => array( 'keyphrase' => $fields['focus_keyword'] ),
					'additional' => array(),
				)
			);
		}
		$model->save();
	}
}
