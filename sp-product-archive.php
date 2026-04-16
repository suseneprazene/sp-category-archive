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
            '1.0.0'
        );

        wp_enqueue_script(
            'sp-product-archive',
            plugin_dir_url( __FILE__ ) . 'assets/script.js',
            [ 'jquery' ],
            '1.0.0',
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
}

new SP_Product_Archive();
