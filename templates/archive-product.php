<?php
/**
 * Vlastní šablona archivu kategorie produktů.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

get_header();

$term = get_queried_object();

// Načteme všechny produkty v kategorii bez stránkování
$products = wc_get_products([
    'status'   => 'publish',
    'limit'    => -1,
    'category' => [ $term->slug ],
    'orderby'  => 'menu_order',
    'order'    => 'ASC',
]);

?>

<div class="sp-archive-outer">
  <div class="sp-archive-wrapper">

  <?php if ( ! empty( $products ) ) : ?>

    <?php
    // První produkt – výchozí obrázek pro pravý panel
    $first      = $products[0];
    $first_img  = get_the_post_thumbnail_url( $first->get_id(), 'large' ) ?: wc_placeholder_img_src( 'large' );
    $first_name = $first->get_name();
    ?>

    <!-- LEVÝ SLOUPEC – seznam produktů -->
    <div class="sp-product-list">

      <?php foreach ( $products as $index => $product ) :

        $product_id  = $product->get_id();
        $name        = $product->get_name();
        $short_desc  = $product->get_short_description();
        $permalink   = $product->get_permalink();
        $thumb_url   = get_the_post_thumbnail_url( $product_id, 'large' ) ?: wc_placeholder_img_src( 'large' );
        $is_variable = $product->is_type( 'variable' );
        $price_html  = $product->get_price_html();

        // Varianty – připravíme data pro JS
        $variations_data = [];
        if ( $is_variable )
        {
            $available_variations = $product->get_available_variations();
            foreach ( $available_variations as $variation )
            {
                $var_obj   = wc_get_product( $variation['variation_id'] );
                $var_image = $variation['image']['url'] ?? $thumb_url;
                $var_attrs = [];

                foreach ( $variation['attributes'] as $attr_key => $attr_val )
                {
                    // attr_key z get_available_variations() má tvar 'attribute_pa_hmotnost'
                    // select generuje klíč 'attribute_' . sanitize_title( str_replace('pa_', '', $attr_name) )
                    // = 'attribute_hmotnost'
                    // → sjednotíme: stripneme prefix 'attribute_pa_' nebo 'attribute_' a dáme zpět 'attribute_'
                    $stripped               = preg_replace( '/^attribute_(?:pa_)?/', '', $attr_key );
                    $normalized_key         = 'attribute_' . sanitize_title( $stripped );
                    $var_attrs[ $normalized_key ] = stripslashes( trim( $attr_val, '"' ) );
                }

                $variations_data[] = [
                    'id'         => $variation['variation_id'],
                    'price_html' => $var_obj ? $var_obj->get_price_html() : $price_html,
                    'image'      => $var_image,
                    'attributes' => $var_attrs,
                    'in_stock'   => $var_obj ? $var_obj->is_in_stock() : false,
                ];
            }
        }

        $active_class = ( $index === 0 ) ? ' active' : '';

        // Jméno pro zobrazení – pro variabilní produkty přidáme hodnoty atributů první varianty
        $display_name = $name;
        if ( $is_variable && ! empty( $variations_data ) )
        {
            $first_attrs = $variations_data[0]['attributes']; // e.g. ['attribute_hmotnost' => '50g']
            $attr_vals   = [];
            foreach ( $first_attrs as $attr_key => $attr_val )
            {
                if ( $attr_val === '' ) continue;
                // Rekonstruuj název taxonomie (attribute_hmotnost → pa_hmotnost)
                $tax_name = 'pa_' . preg_replace( '/^attribute_/', '', $attr_key );
                if ( taxonomy_exists( $tax_name ) )
                {
                    $term        = get_term_by( 'slug', $attr_val, $tax_name );
                    $attr_vals[] = $term ? $term->name : $attr_val;
                }
                else
                {
                    $attr_vals[] = $attr_val;
                }
            }
            if ( ! empty( $attr_vals ) )
            {
                $display_name = $name . ' - ' . implode( ', ', $attr_vals );
            }
        }

      ?>

      <div
        class="sp-product-item<?php echo $active_class; ?>"
        data-id="<?php echo esc_attr( $product_id ); ?>"
        data-img="<?php echo esc_url( $thumb_url ); ?>"
        data-name="<?php echo esc_attr( $name ); ?>"
        data-price="<?php echo esc_attr( strip_tags( $price_html ) ); ?>"
        data-price-html="<?php echo esc_attr( $price_html ); ?>"
        data-permalink="<?php echo esc_url( $permalink ); ?>"
        data-type="<?php echo $is_variable ? 'variable' : 'simple'; ?>"
        data-variations="<?php echo esc_attr( wp_json_encode( $variations_data ) ); ?>"
      >

        <h3><?php echo esc_html( $display_name ); ?></h3>

        <?php if ( $short_desc ) : ?>
          <div class="sp-product-desc"><?php echo wp_kses_post( do_shortcode( $short_desc ) ); ?></div>
        <?php endif; ?>

        <!-- Inline akce – desktop -->
        <div class="sp-inline-actions">

          <?php if ( $is_variable ) : ?>
            <div class="sp-variation-selects">
              <?php
              $attributes = $product->get_variation_attributes();
              foreach ( $attributes as $attr_name => $options ) :
                $label = wc_attribute_label( $attr_name );
                // Klíč sjednocen s $normalized_key výše:
                // stripneme 'pa_' prefix pokud existuje, pak sanitize_title
                $attr_key_normalized = 'attribute_' . sanitize_title( preg_replace( '/^pa_/', '', $attr_name ) );
              ?>
                <div class="sp-variation-row">
                  <label><?php echo esc_html( $label ); ?></label>
                  <select
                    class="sp-inline-variation-select"
                    data-attribute="<?php echo esc_attr( $attr_key_normalized ); ?>"
                  >
                    <option value="">— Vyberte —</option>
<?php foreach ( $options as $option ) : ?>
  <option value="<?php echo esc_attr( trim( $option, '"' ) ); ?>">
    <?php echo esc_html( trim( $option, '"' ) ); ?>
  </option>
<?php endforeach; ?>
                  </select>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>

          <div class="sp-inline-bottom-row">
            <div class="sp-inline-price" id="sp-inline-price-<?php echo esc_attr( $product_id ); ?>">
              <?php echo $price_html; ?>
            </div>
            <input type="number" class="sp-qty sp-inline-qty" value="1" min="1" />
            <button
              class="sp-add-to-cart custom-product-btn sp-inline-cart-btn"
              data-product-id="<?php echo esc_attr( $product_id ); ?>"
            >
              DO KOŠÍKU
            </button>
            <a href="<?php echo esc_url( $permalink ); ?>" class="sp-detail-btn">
              ZOBRAZIT DETAIL
            </a>
          </div>

        </div><!-- /.sp-inline-actions -->

        <!-- Inline blok pro mobil -->
        <div class="sp-mobile-panel">

          <img
            class="sp-mobile-img"
            src="<?php echo esc_url( $thumb_url ); ?>"
            alt="<?php echo esc_attr( $name ); ?>"
          />

          <div class="sp-mobile-price"><?php echo $price_html; ?></div>

          <?php if ( $is_variable ) : ?>
            <div class="sp-variation-selects">
              <?php
              $attributes = $product->get_variation_attributes();
              foreach ( $attributes as $attr_name => $options ) :
                $label = wc_attribute_label( $attr_name );
                $attr_key_normalized = 'attribute_' . sanitize_title( preg_replace( '/^pa_/', '', $attr_name ) );
              ?>
                <div class="sp-variation-row">
                  <label><?php echo esc_html( $label ); ?></label>
                  <select
                    class="sp-inline-variation-select"
                    data-attribute="<?php echo esc_attr( $attr_key_normalized ); ?>"
                  >
                    <option value="">— Vyberte —</option>
<?php foreach ( $options as $option ) : ?>
  <option value="<?php echo esc_attr( trim( $option, '"' ) ); ?>">
    <?php echo esc_html( trim( $option, '"' ) ); ?>
  </option>
<?php endforeach; ?>
                  </select>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>

          <div class="sp-qty-row">
            <input type="number" class="sp-qty sp-inline-qty" value="1" min="1" />
          </div>

          <div class="sp-action-row">
            <button
              class="sp-add-to-cart custom-product-btn sp-inline-cart-btn"
              data-product-id="<?php echo esc_attr( $product_id ); ?>"
            >
              DO KOŠÍKU
            </button>
            <a href="<?php echo esc_url( $permalink ); ?>" class="sp-detail-btn">
              ZOBRAZIT DETAIL
            </a>
          </div>

        </div><!-- /.sp-mobile-panel -->

      </div><!-- /.sp-product-item -->

      <?php endforeach; ?>

    </div><!-- /.sp-product-list -->

    <!-- PRAVÝ SLOUPEC – desktop sticky panel -->
    <div class="sp-product-panel">
      <div class="sp-image-frame">
        <img id="sp-panel-img" src="<?php echo esc_url( $first_img ); ?>" alt="<?php echo esc_attr( $first_name ); ?>" />
        <div class="sp-projector-flash" id="sp-projector-flash"></div>
      </div>
    </div><!-- /.sp-product-panel -->

  <?php else : ?>
    <p>V této kategorii zatím nejsou žádné produkty.</p>
  <?php endif; ?>

  </div><!-- /.sp-archive-wrapper -->
</div><!-- /.sp-archive-outer -->

<?php get_footer(); ?>
