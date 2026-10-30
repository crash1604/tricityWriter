<?php
/**
 * Posts and pages endpoints.
 *
 * @package TricityWriter
 */

namespace TricityWriter\Rest;

use TricityWriter\Seo;
use WP_Error;
use WP_Post;
use WP_Post_Type;
use WP_Query;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

/**
 * List, read, create, update and trash posts and pages. Every handler checks the connected user's
 * capabilities for the specific operation; Auth::check() has already resolved that user.
 */
final class Posts {

	const TYPES             = array( 'post', 'page' );
	const WRITABLE_STATUSES = array( 'draft', 'publish', 'future', 'private' );
	const READABLE_STATUSES = array( 'publish', 'draft', 'future', 'pending', 'private' );

	/**
	 * GET /posts
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function index( WP_REST_Request $request ) {
		$type_object = self::type_object( $request->get_param( 'type' ) ?? 'post' );
		if ( is_wp_error( $type_object ) ) {
			return $type_object;
		}
		if ( ! current_user_can( $type_object->cap->edit_posts ) ) {
			return Errors::forbidden();
		}

		$status = (string) ( $request->get_param( 'status' ) ?? 'any' );
		if ( 'any' !== $status && ! in_array( $status, self::READABLE_STATUSES, true ) ) {
			return Errors::invalid( 'status', __( 'Unknown post status.', 'tricity-writer' ) );
		}

		$args = array(
			'post_type'           => $type_object->name,
			'post_status'         => 'any' === $status ? self::READABLE_STATUSES : array( $status ),
			'posts_per_page'      => min( 100, max( 1, (int) ( $request->get_param( 'per_page' ) ?? 20 ) ) ),
			'paged'               => max( 1, (int) ( $request->get_param( 'page' ) ?? 1 ) ),
			'orderby'             => 'date',
			'order'               => 'DESC',
			'ignore_sticky_posts' => true,
		);
		$search = trim( (string) $request->get_param( 'search' ) );
		if ( '' !== $search ) {
			$args['s'] = $search;
		}
		if ( ! current_user_can( $type_object->cap->edit_others_posts ) ) {
			$args['author'] = get_current_user_id();
		}

		$query = new WP_Query( $args );
		return array(
			'items' => array_map( array( self::class, 'summary' ), $query->posts ),
			'total' => (int) $query->found_posts,
			'pages' => (int) $query->max_num_pages,
		);
	}

	/**
	 * GET /posts/{id}
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function show( WP_REST_Request $request ) {
		$post = self::editable( (int) $request['id'] );
		return is_wp_error( $post ) ? $post : self::full( $post );
	}

	/**
	 * POST /posts
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function create( WP_REST_Request $request ) {
		$type_object = self::type_object( $request->get_param( 'type' ) ?? 'post' );
		if ( is_wp_error( $type_object ) ) {
			return $type_object;
		}
		if ( ! current_user_can( $type_object->cap->create_posts ) ) {
			return Errors::forbidden();
		}

		$postarr = array(
			'post_type'   => $type_object->name,
			'post_status' => 'draft',
		);
		$result  = self::apply_fields( $postarr, $request, $type_object );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// wp_insert_post() expects slashed data, like the core REST controller passes it.
		$post_id = wp_insert_post( wp_slash( $postarr ), true );
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		$result = self::apply_relations( $post_id, $request );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return self::full( get_post( $post_id ) );
	}

	/**
	 * POST /posts/{id}
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>|WP_Error
	 */
	public static function update( WP_REST_Request $request ) {
		$post = self::editable( (int) $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$type_object = get_post_type_object( $post->post_type );

		$postarr = array( 'ID' => $post->ID );
		$result  = self::apply_fields( $postarr, $request, $type_object );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( count( $postarr ) > 1 ) {
			$updated = wp_update_post( wp_slash( $postarr ), true );
			if ( is_wp_error( $updated ) ) {
				return $updated;
			}
		}

		$result = self::apply_relations( $post->ID, $request );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		clean_post_cache( $post->ID );
		return self::full( get_post( $post->ID ) );
	}

	/**
	 * POST /posts/{id}/trash
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, bool>|WP_Error
	 */
	public static function trash( WP_REST_Request $request ) {
		$post = self::editable( (int) $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		if ( ! current_user_can( 'delete_post', $post->ID ) ) {
			return Errors::forbidden();
		}
		if ( ! wp_trash_post( $post->ID ) ) {
			return new WP_Error( 'tcw_trash_failed', __( 'The post could not be moved to the trash.', 'tricity-writer' ), array( 'status' => 500 ) );
		}
		return array( 'ok' => true );
	}

	/**
	 * POST /posts/{id}/seo: writes whichever of title, description and focus_keyword are sent.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, string>|WP_Error
	 */
	public static function seo( WP_REST_Request $request ) {
		$post = self::editable( (int) $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$fields = array();
		foreach ( array( 'title', 'description', 'focus_keyword' ) as $field ) {
			if ( null !== $request->get_param( $field ) ) {
				$fields[ $field ] = sanitize_text_field( (string) $request->get_param( $field ) );
			}
		}
		Seo::write( $post->ID, $fields );
		return Seo::read( $post->ID );
	}

	/**
	 * Post fields for list responses. Mirrors postSummarySchema.
	 *
	 * @param WP_Post $post Post.
	 * @return array<string, mixed>
	 */
	public static function summary( WP_Post $post ): array {
		return array(
			'id'                 => $post->ID,
			'type'               => $post->post_type,
			'title'              => $post->post_title,
			'status'             => $post->post_status,
			'date_gmt'           => self::iso( $post->post_date_gmt, $post->post_date ),
			'modified_gmt'       => self::iso( $post->post_modified_gmt, $post->post_modified ),
			'link'               => (string) get_permalink( $post ),
			'word_count'         => str_word_count( wp_strip_all_tags( $post->post_content ) ),
			'has_featured_image' => has_post_thumbnail( $post ),
		);
	}

	/**
	 * Full post. Mirrors postSchema.
	 *
	 * @param WP_Post $post Post.
	 * @return array<string, mixed>
	 */
	public static function full( WP_Post $post ): array {
		$thumbnail_id = (int) get_post_thumbnail_id( $post );
		$author       = get_userdata( (int) $post->post_author );

		return self::summary( $post ) + array(
			'content'            => $post->post_content,
			'excerpt'            => $post->post_excerpt,
			'categories'         => self::term_names( $post->ID, 'category' ),
			'tags'               => self::term_names( $post->ID, 'post_tag' ),
			'featured_media'     => $thumbnail_id ? $thumbnail_id : null,
			'featured_image_url' => $thumbnail_id ? (string) wp_get_attachment_url( $thumbnail_id ) : null,
			'author'             => array(
				'id'           => (int) $post->post_author,
				'display_name' => $author ? $author->display_name : '',
			),
			'seo'                => Seo::read( $post->ID ),
		);
	}

	/**
	 * Copies scalar fields from the request into a wp_insert_post()/wp_update_post() array.
	 *
	 * @param array<string, mixed> $postarr     Post array, modified in place.
	 * @param WP_REST_Request      $request     Current request.
	 * @param WP_Post_Type         $type_object Post type being written.
	 * @return true|WP_Error
	 */
	private static function apply_fields( array &$postarr, WP_REST_Request $request, WP_Post_Type $type_object ) {
		$map = array(
			'title'   => 'post_title',
			'content' => 'post_content',
			'excerpt' => 'post_excerpt',
		);
		foreach ( $map as $param => $field ) {
			if ( null !== $request->get_param( $param ) ) {
				$postarr[ $field ] = (string) $request->get_param( $param );
			}
		}

		$status = $request->get_param( 'status' );
		if ( null !== $status ) {
			if ( ! in_array( $status, self::WRITABLE_STATUSES, true ) ) {
				return Errors::invalid( 'status', __( 'Unknown post status.', 'tricity-writer' ) );
			}
			if ( 'draft' !== $status && ! current_user_can( $type_object->cap->publish_posts ) ) {
				return new WP_Error( 'tcw_cannot_publish', __( 'The connected user cannot publish this content type.', 'tricity-writer' ), array( 'status' => 403 ) );
			}
			$postarr['post_status'] = $status;
		}

		$date_gmt = $request->get_param( 'date_gmt' );
		if ( null !== $date_gmt ) {
			$timestamp = strtotime( (string) $date_gmt );
			if ( false === $timestamp ) {
				return Errors::invalid( 'date_gmt', __( 'Invalid date.', 'tricity-writer' ) );
			}
			$postarr['post_date_gmt'] = gmdate( 'Y-m-d H:i:s', $timestamp );
			$postarr['post_date']     = get_date_from_gmt( $postarr['post_date_gmt'] );
			$postarr['edit_date']     = true;
		} elseif ( 'future' === $status ) {
			return Errors::invalid( 'date_gmt', __( 'Scheduling requires date_gmt.', 'tricity-writer' ) );
		}

		$author = $request->get_param( 'author' );
		if ( null !== $author ) {
			$author = (int) $author;
			if ( get_current_user_id() !== $author && ! current_user_can( $type_object->cap->edit_others_posts ) ) {
				return Errors::forbidden();
			}
			if ( ! get_userdata( $author ) ) {
				return Errors::invalid( 'author', __( 'Unknown author.', 'tricity-writer' ) );
			}
			$postarr['post_author'] = $author;
		}

		return true;
	}

	/**
	 * Applies categories, tags and featured image after the post exists.
	 *
	 * @param int             $post_id Post ID.
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	private static function apply_relations( int $post_id, WP_REST_Request $request ) {
		$taxonomies = array(
			'categories' => 'category',
			'tags'       => 'post_tag',
		);
		foreach ( $taxonomies as $param => $taxonomy ) {
			$names = $request->get_param( $param );
			if ( ! is_array( $names ) || ! is_object_in_taxonomy( get_post_type( $post_id ), $taxonomy ) ) {
				continue;
			}
			$term_ids = self::resolve_terms( $names, $taxonomy );
			if ( is_wp_error( $term_ids ) ) {
				return $term_ids;
			}
			$set = wp_set_post_terms( $post_id, $term_ids, $taxonomy );
			if ( is_wp_error( $set ) ) {
				return $set;
			}
		}

		if ( $request->has_param( 'featured_media' ) ) {
			$media_id = $request->get_param( 'featured_media' );
			if ( null === $media_id || 0 === (int) $media_id ) {
				delete_post_thumbnail( $post_id );
			} elseif ( ! wp_attachment_is_image( (int) $media_id ) ) {
				return Errors::invalid( 'featured_media', __( 'Featured media must be an image attachment.', 'tricity-writer' ) );
			} else {
				set_post_thumbnail( $post_id, (int) $media_id );
			}
		}

		return true;
	}

	/**
	 * Maps term names to IDs, creating missing terms when the user may manage the taxonomy.
	 * Names the user cannot create are skipped rather than failing the whole request.
	 *
	 * @param array<int, mixed> $names    Term names.
	 * @param string            $taxonomy Taxonomy.
	 * @return array<int, int>|WP_Error
	 */
	private static function resolve_terms( array $names, string $taxonomy ) {
		$taxonomy_object = get_taxonomy( $taxonomy );
		if ( ! $taxonomy_object || ! current_user_can( $taxonomy_object->cap->assign_terms ) ) {
			return Errors::forbidden();
		}
		$can_create = current_user_can( $taxonomy_object->cap->manage_terms );

		$ids = array();
		foreach ( $names as $name ) {
			$name = sanitize_text_field( (string) $name );
			if ( '' === $name ) {
				continue;
			}
			$term = get_term_by( 'name', $name, $taxonomy );
			if ( $term ) {
				$ids[] = (int) $term->term_id;
				continue;
			}
			if ( $can_create ) {
				$created = wp_insert_term( $name, $taxonomy );
				if ( ! is_wp_error( $created ) ) {
					$ids[] = (int) $created['term_id'];
				}
			}
		}
		return array_values( array_unique( $ids ) );
	}

	/**
	 * A post the current user may edit, or an error.
	 *
	 * @param int $post_id Post ID.
	 * @return WP_Post|WP_Error
	 */
	private static function editable( int $post_id ) {
		$post = get_post( $post_id );
		if ( ! $post || ! in_array( $post->post_type, self::TYPES, true ) ) {
			return new WP_Error( 'tcw_not_found', __( 'Post not found.', 'tricity-writer' ), array( 'status' => 404 ) );
		}
		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			return Errors::forbidden();
		}
		return $post;
	}

	/**
	 * Post type object for a supported type.
	 *
	 * @param mixed $type Requested type.
	 * @return WP_Post_Type|WP_Error
	 */
	private static function type_object( $type ) {
		if ( ! in_array( $type, self::TYPES, true ) ) {
			return Errors::invalid( 'type', __( 'Type must be post or page.', 'tricity-writer' ) );
		}
		return get_post_type_object( $type );
	}

	/**
	 * Term names attached to a post.
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $taxonomy Taxonomy.
	 * @return array<int, string>
	 */
	private static function term_names( int $post_id, string $taxonomy ): array {
		$names = wp_get_post_terms( $post_id, $taxonomy, array( 'fields' => 'names' ) );
		return is_wp_error( $names ) ? array() : array_map( 'html_entity_decode', $names );
	}

	/**
	 * ISO 8601 UTC timestamp. Drafts have no GMT date yet, so fall back to converting the local one.
	 *
	 * @param string $gmt   GMT date (Y-m-d H:i:s) or the zero date.
	 * @param string $local Local date (Y-m-d H:i:s).
	 */
	private static function iso( string $gmt, string $local ): string {
		if ( '0000-00-00 00:00:00' === $gmt ) {
			$gmt = get_gmt_from_date( $local );
		}
		return gmdate( 'Y-m-d\TH:i:s\Z', (int) strtotime( $gmt . ' UTC' ) );
	}
}
