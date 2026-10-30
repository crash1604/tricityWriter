<?php
/**
 * Categories and tags endpoint.
 *
 * @package TricityWriter
 */

namespace TricityWriter\Rest;

use WP_Error;
use WP_REST_Request;
use WP_Term;

defined( 'ABSPATH' ) || exit;

/**
 * Lists categories or tags so the platform can choose existing terms instead of inventing new ones.
 */
final class Terms {

	/**
	 * GET /terms?taxonomy=category|post_tag
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<int, array<string, mixed>>|WP_Error
	 */
	public static function index( WP_REST_Request $request ) {
		$taxonomy = (string) $request->get_param( 'taxonomy' );
		if ( ! in_array( $taxonomy, array( 'category', 'post_tag' ), true ) ) {
			return Errors::invalid( 'taxonomy', __( 'Taxonomy must be category or post_tag.', 'tricity-writer' ) );
		}
		if ( ! current_user_can( 'edit_posts' ) ) {
			return Errors::forbidden();
		}

		$args   = array(
			'taxonomy'   => $taxonomy,
			'hide_empty' => false,
			'number'     => 500,
			'orderby'    => 'name',
		);
		$search = trim( (string) $request->get_param( 'search' ) );
		if ( '' !== $search ) {
			$args['search'] = $search;
		}

		$terms = get_terms( $args );
		if ( is_wp_error( $terms ) ) {
			return $terms;
		}
		return array_map(
			static function ( WP_Term $term ) {
				return array(
					'id'     => (int) $term->term_id,
					'name'   => html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' ),
					'slug'   => $term->slug,
					'parent' => (int) $term->parent,
					'count'  => (int) $term->count,
				);
			},
			array_values( $terms )
		);
	}
}
