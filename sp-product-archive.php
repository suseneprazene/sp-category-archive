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
        add_action( 'wp_ajax_sp_cfb_bundle_ui',        [ $this, 'ajax_cfb_bundle_ui' ] );
        add_action( 'wp_ajax_nopriv_sp_cfb_bundle_ui', [ $this, 'ajax_cfb_bundle_ui' ] );
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
            '1.1.0'
        );

        wp_enqueue_script(
            'sp-product-archive',
            plugin_dir_url( __FILE__ ) . 'assets/script.js',
            [ 'jquery' ],
            '1.1.0',
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

    /**
     * AJAX handler: renders the cfb bundle selector UI for a single product.
     *
     * The cfb plugin (bundles.php) hooks its flavor-selector HTML + inline JS/CSS
     * into `woocommerce_before_add_to_cart_button`.  We set up the WooCommerce
     * product context, trigger that action, and return the captured HTML.
     * No bundle logic is re-implemented here – we fully delegate to cfb.
     */
    public function ajax_cfb_bundle_ui()
    {
        $product_id = absint( $_GET['product_id'] ?? 0 );

        if ( ! $product_id ) {
            wp_send_json_error( [ 'message' => 'Missing product_id.' ] );
        }

        if ( get_post_meta( $product_id, '_cfb_is_bundle', true ) !== '1' ) {
            wp_send_json_error( [ 'message' => 'Not a cfb bundle product.' ] );
        }

        $wc_product = wc_get_product( $product_id );
        if ( ! $wc_product ) {
            wp_send_json_error( [ 'message' => 'Product not found.' ] );
        }

        // Set up the global WooCommerce product context expected by cfb's hook.
        global $post, $product;
        $orig_post    = $post;
        $orig_product = $product;

        $post    = get_post( $product_id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
        $product = $wc_product;             // phpcs:ignore WordPress.WP.GlobalVariablesOverride
        setup_postdata( $post );

        ob_start();
        do_action( 'woocommerce_before_add_to_cart_button' );
        $html = ob_get_clean();

        wp_reset_postdata();
        $post    = $orig_post;    // phpcs:ignore WordPress.WP.GlobalVariablesOverride
        $product = $orig_product; // phpcs:ignore WordPress.WP.GlobalVariablesOverride

        if ( empty( trim( $html ) ) ) {
            wp_send_json_error( [ 'message' => 'Bundle UI rendered empty – cfb plugin may not be active.' ] );
        }

        $bundle_items = (array) get_post_meta( $product_id, '_cfb_bundle_items', true );
        $required_qty = (int) array_sum( array_column( $bundle_items, 'limit' ) );

        wp_send_json_success( [
            'html'         => $html,
            'name'         => $wc_product->get_name(),
            'required_qty' => $required_qty,
        ] );
    }
}

new SP_Product_Archive();
