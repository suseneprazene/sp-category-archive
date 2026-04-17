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
        add_action( 'wp_ajax_sp_cfb_bundle_ui',         [ $this, 'ajax_cfb_bundle_ui' ] );
        add_action( 'wp_ajax_nopriv_sp_cfb_bundle_ui',  [ $this, 'ajax_cfb_bundle_ui' ] );
        add_action( 'wp_ajax_sp_cfb_add_to_cart',        [ $this, 'ajax_cfb_add_to_cart' ] );
        add_action( 'wp_ajax_nopriv_sp_cfb_add_to_cart', [ $this, 'ajax_cfb_add_to_cart' ] );

        // Cart + order display of CFB flavor selection.
        // Priority 99 ensures we run after any CFB own filter on the same hook.
        add_filter( 'woocommerce_add_cart_item_data',          [ $this, 'cfb_save_selection_to_cart_item' ], 99, 2 );
        add_filter( 'woocommerce_get_item_data',               [ $this, 'cfb_display_selection_in_cart' ], 10, 2 );
        add_action( 'woocommerce_checkout_create_order_line_item', [ $this, 'cfb_add_selection_to_order_meta' ], 10, 4 );
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
            'html'             => $html,
            'name'             => $wc_product->get_name(),
            'required_qty'     => $required_qty,
            'bundle_items_raw' => $bundle_items, // debug: raw _cfb_bundle_items structure
            'add_to_cart_nonce' => wp_create_nonce( 'sp_cfb_add_to_cart' ),
        ] );
    }

    /**
     * AJAX handler: adds a CFB bundle product to the WooCommerce cart.
     *
     * Calls WC()->cart->add_to_cart() directly, bypassing the standard
     * template_redirect flow (which checks is_purchasable() and may reject
     * CFB custom product types).  CFB's own hooks – woocommerce_add_cart_item_data
     * and woocommerce_add_to_cart_validation – still fire normally because they
     * are filters/actions called inside WC's add_to_cart() method.
     *
     * $_POST['cfb_flavor_selection'] is set before the call so CFB's filter can
     * read it exactly as it would on the single product page.
     */
    public function ajax_cfb_add_to_cart()
    {
        check_ajax_referer( 'sp_cfb_add_to_cart', 'nonce' );

        $product_id           = absint( $_POST['product_id'] ?? 0 );
        $cfb_flavor_selection = isset( $_POST['cfb_flavor_selection'] )
            ? wp_unslash( $_POST['cfb_flavor_selection'] )
            : '';

        if ( ! $product_id ) {
            wp_send_json_error( [ 'message' => 'Missing product_id.' ] );
        }

        $wc_product = wc_get_product( $product_id );
        if ( ! $wc_product ) {
            wp_send_json_error( [ 'message' => 'Product not found.' ] );
        }

        // Put cfb_flavor_selection in $_POST so CFB's woocommerce_add_cart_item_data
        // filter can read it (same as on the single product page form submit).
        $_POST['cfb_flavor_selection']    = $cfb_flavor_selection;
        $_REQUEST['cfb_flavor_selection'] = $cfb_flavor_selection;

        // Set up the global WooCommerce product context that CFB's hooks expect.
        // Without this, CFB filters that access $product or get_the_ID() would
        // read stale / null values in the AJAX context, causing fatal errors on
        // the second (and subsequent) add-to-cart calls when the cart is non-empty.
        global $post, $product;
        $orig_post    = $post;
        $orig_product = $product;

        $post    = get_post( $product_id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
        $product = $wc_product;             // phpcs:ignore WordPress.WP.GlobalVariablesOverride
        setup_postdata( $post );

        // Temporarily allow adding even if the product is flagged as non-purchasable.
        // CFB bundles are sometimes set as not purchasable via the standard WC flow
        // to prevent direct adds, but we handle the flow ourselves here.
        $force_purchasable = static function ( $purchasable, $product ) use ( $product_id ) {
            return ( $product->get_id() === $product_id ) ? true : $purchasable;
        };
        add_filter( 'woocommerce_is_purchasable', $force_purchasable, 99, 2 );

        // Clear any stale notices so we only report errors from this call.
        wc_clear_notices();

        $cart_item_key = false;
        try {
            $cart_item_key = WC()->cart->add_to_cart( $product_id, 1 );
        } catch ( \Throwable $e ) {
            remove_filter( 'woocommerce_is_purchasable', $force_purchasable, 99 );
            wp_reset_postdata();
            $post    = $orig_post;    // phpcs:ignore WordPress.WP.GlobalVariablesOverride
            $product = $orig_product; // phpcs:ignore WordPress.WP.GlobalVariablesOverride
            wp_send_json_error( [ 'message' => 'Chyba při přidávání do košíku.' ] );
        }

        remove_filter( 'woocommerce_is_purchasable', $force_purchasable, 99 );
        wp_reset_postdata();
        $post    = $orig_post;    // phpcs:ignore WordPress.WP.GlobalVariablesOverride
        $product = $orig_product; // phpcs:ignore WordPress.WP.GlobalVariablesOverride

        if ( false === $cart_item_key ) {
            // Collect WC error notices added during the failed add_to_cart call.
            $error_notices = wc_get_notices( 'error' );
            $messages      = array_map(
                static function ( $n ) {
                    return is_array( $n ) ? wp_strip_all_tags( $n['notice'] ?? '' ) : wp_strip_all_tags( $n );
                },
                $error_notices
            );
            wc_clear_notices();
            wp_send_json_error( [
                'message' => implode( ' ', array_filter( $messages ) ) ?: 'Produkt se nepodařilo přidat do košíku.',
            ] );
        }

        // Return refreshed cart fragments so the JS can update the cart widget.
        // Wrap in try-catch: rendering the mini cart iterates existing cart items
        // and may invoke CFB hooks that crash if the cart already contains bundle
        // items – a render failure should not prevent a successful add-to-cart
        // response (the JS falls back to get_refreshed_fragments on empty fragments).
        $fragments = [];
        if ( function_exists( 'wc_get_cart_item_data_hash' ) || class_exists( 'WC_AJAX' ) ) {
            try {
                ob_start();
                woocommerce_mini_cart();
                $mini_cart = ob_get_clean();
                $fragments['div.widget_shopping_cart_content'] = '<div class="widget_shopping_cart_content">' . $mini_cart . '</div>';
            } catch ( \Throwable $e ) {
                // Mini cart render failed – return empty fragments so the JS
                // falls back to its own get_refreshed_fragments request.
                if ( ob_get_level() ) {
                    ob_end_clean();
                }
                $fragments = [];
            }
        }

        wp_send_json_success( [
            'cart_item_key' => $cart_item_key,
            'fragments'     => $fragments,
            'cart_hash'     => WC()->cart->get_cart_hash(),
        ] );
    }

    /**
     * Persist the CFB flavor selection into WooCommerce cart item data so
     * it survives page loads and can be displayed in the cart, order views,
     * and confirmation emails.
     *
     * Runs at priority 99 (after any CFB own filter) so we do not interfere
     * with whatever CFB itself stores under its own keys.
     *
     * @param array $cart_item_data Existing cart item data.
     * @param int   $product_id     Product being added.
     * @return array
     */
    public function cfb_save_selection_to_cart_item( array $cart_item_data, int $product_id ): array
    {
        if ( empty( $_POST['cfb_flavor_selection'] ) ) {
            return $cart_item_data;
        }

        $raw = wp_unslash( $_POST['cfb_flavor_selection'] );
        $sel = json_decode( $raw, true );
        if ( ! is_array( $sel ) ) {
            return $cart_item_data;
        }

        $selected = [];
        foreach ( $sel as $flavor_id => $data ) {
            $qty = absint( $data['qty'] ?? 0 );
            if ( $qty > 0 ) {
                $selected[ absint( $flavor_id ) ] = [
                    'name' => sanitize_text_field( $data['name'] ?? '' ),
                    'qty'  => $qty,
                ];
            }
        }

        if ( ! empty( $selected ) ) {
            $cart_item_data['sp_cfb_selection'] = $selected;
        }

        return $cart_item_data;
    }

    /**
     * Display the saved CFB flavor selection as cart item meta on the
     * cart / mini-cart pages.
     *
     * @param array $item_data Existing item data rows.
     * @param array $cart_item Cart item array.
     * @return array
     */
    public function cfb_display_selection_in_cart( array $item_data, array $cart_item ): array
    {
        if ( empty( $cart_item['sp_cfb_selection'] ) ) {
            return $item_data;
        }

        $lines = [];
        foreach ( $cart_item['sp_cfb_selection'] as $data ) {
            if ( ! empty( $data['name'] ) ) {
                $lines[] = esc_html( $data['qty'] . '× ' . $data['name'] );
            }
        }

        if ( ! empty( $lines ) ) {
            $item_data[] = [
                'key'   => __( 'Výběr balíčku', 'sp-product-archive' ),
                'value' => implode( '<br>', $lines ),
                'display' => '',
            ];
        }

        return $item_data;
    }

    /**
     * Write each selected CFB flavor as a separate order line-item meta entry.
     * This makes the selection visible in:
     *  – the WooCommerce admin order detail page
     *  – order confirmation / processing emails to the customer and admin
     *
     * @param \WC_Order_Item_Product $item         Order line item.
     * @param string                 $cart_item_key Cart item key.
     * @param array                  $cart_item     Cart item data.
     * @param \WC_Order              $order         The order.
     */
    public function cfb_add_selection_to_order_meta(
        \WC_Order_Item_Product $item,
        string $cart_item_key,
        array $cart_item,
        \WC_Order $order
    ): void {
        if ( empty( $cart_item['sp_cfb_selection'] ) ) {
            return;
        }

        foreach ( $cart_item['sp_cfb_selection'] as $data ) {
            if ( empty( $data['name'] ) ) {
                continue;
            }
            // Label is the flavor name; value is the quantity.
            // display_key / display_value let themes show it cleanly.
            $item->add_meta_data(
                sanitize_text_field( $data['name'] ),
                absint( $data['qty'] ) . '×',
                false
            );
        }
    }
}

new SP_Product_Archive();
