<?php
/**
 * Plugin Name: SP Product Archive
 * Description: Vlastní layout archivu kategorií WooCommerce – stejný styl jako sekce kategorií.
 * Version: 1.0.0
 * Author: suseneprazene.cz
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class SP_Product_Archive
{
    public function __construct()
    {
        add_filter( 'template_include', [ $this, 'override_category_template' ], 99 );
        add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_assets' ] );
        add_action( 'wp_enqueue_scripts', [ $this, 'maybe_enqueue_bundle_assets' ], 20 );
    }

    public function override_category_template( $template )
    {
        if ( is_product_category() )
        {
            $custom = plugin_dir_path( __FILE__ ) . 'templates/archive-product.php';
            if ( file_exists( $custom ) )
            {
                return $custom;
            }
        }
        return $template;
    }

    public function enqueue_assets()
    {
        if ( ! is_product_category() ) return;

        wp_enqueue_style(
            'sp-product-archive',
            plugin_dir_url( __FILE__ ) . 'assets/style.css',
            [],
            '1.0.1'
        );

        wp_enqueue_script(
            'sp-product-archive',
            plugin_dir_url( __FILE__ ) . 'assets/script.js',
            [ 'jquery' ],
            '1.0.1',
            true
        );

        // Předáme WooCommerce AJAX URL a nonce do JS
        wp_localize_script( 'sp-product-archive', 'SP_Archive', [
            'ajax_url'      => admin_url( 'admin-ajax.php' ),
            'wc_ajax_url'   => WC_AJAX::get_endpoint( '%%endpoint%%' ),
            'nonce'         => wp_create_nonce( 'sp-add-to-cart' ),
            'currency'      => get_woocommerce_currency_symbol(),
        ]);
    }

    /**
     * Conditionally enqueue assets from the produkty-darky-kupony plugin
     * when at least one product in the current category uses the [fb_bundle_preview] shortcode.
     * Runs at priority 20 so the other plugin's priority-10 hooks have already registered its scripts.
     * Silently skips if that plugin is not active (shortcode not registered).
     */
    public function maybe_enqueue_bundle_assets()
    {
        if ( ! is_product_category() ) return;

        // If the shortcode is not registered the plugin is not active – skip silently.
        if ( ! shortcode_exists( 'fb_bundle_preview' ) ) return;

        $term = get_queried_object();
        if ( ! $term || ! isset( $term->slug ) ) return;

        // Single lightweight query: find one product in this category whose
        // short description (post_excerpt) contains the shortcode.
        global $wpdb;
        $has_shortcode = (bool) $wpdb->get_var( $wpdb->prepare(
            "SELECT p.ID
             FROM {$wpdb->posts} AS p
             INNER JOIN {$wpdb->term_relationships} AS tr ON tr.object_id = p.ID
             INNER JOIN {$wpdb->term_taxonomy} AS tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
             INNER JOIN {$wpdb->terms} AS t ON t.term_id = tt.term_id
             WHERE p.post_status = 'publish'
               AND p.post_type  = 'product'
               AND tt.taxonomy  = 'product_cat'
               AND t.slug       = %s
               AND p.post_excerpt LIKE %s
             LIMIT 1",
            $term->slug,
             '%' . $wpdb->esc_like( '[fb_bundle_preview' ) . '%'
        ) );

        if ( ! $has_shortcode ) return;

        if ( wp_script_is( 'fb-quick-view', 'registered' ) ) {
            wp_enqueue_script( 'fb-quick-view' );
        }
        if ( wp_style_is( 'fb-modal-styles', 'registered' ) ) {
            wp_enqueue_style( 'fb-modal-styles' );
        }
    }
}

new SP_Product_Archive();
