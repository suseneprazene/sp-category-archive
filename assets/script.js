(function ($)
{
  // ── Pomocné funkce ──────────────────────────────────────────

  function isTouchDevice()
  {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  const panelImg = document.getElementById('sp-panel-img');
  const flash    = document.getElementById('sp-projector-flash');

  function switchImage(newSrc)
  {
    if ( ! panelImg || panelImg.getAttribute('src') === newSrc ) return;

    flash.classList.add('flash-on');

    setTimeout(function ()
    {
      panelImg.src = newSrc;

      setTimeout(function ()
      {
        flash.classList.remove('flash-on');
      }, 80);

    }, 90);
  }

  // ── AJAX přidání do košíku ───────────────────────────────────

  function addToCart(productId, variationId, qty, variationAttrs, btn)
  {
    const originalText = btn.textContent;
    btn.disabled       = true;
    btn.textContent    = '…';

    const item       = btn.closest('.sp-product-item');
    const productUrl = item ? item.dataset.permalink : null;

    if ( ! productUrl)
    {
      console.error('❌ data-permalink chybí na .sp-product-item');
      btn.textContent = 'Chyba konfigurace';
      btn.disabled    = false;
      return;
    }

    const params = new URLSearchParams();
    params.append('add-to-cart',  productId);
    params.append('product_id',   productId);
    params.append('quantity',     qty);

    if (variationId)
    {
      params.append('variation_id', variationId);
    }

    if (variationAttrs && typeof variationAttrs === 'object')
    {
      Object.keys(variationAttrs).forEach(function (key)
      {
        params.append(key, variationAttrs[key]);
      });
    }

    $.ajax(
    {
      url:         productUrl,
      method:      'POST',
      contentType: 'application/x-www-form-urlencoded',
      data:        params.toString(),
      success: function ()
      {
        // Nejdřív refresh fragmentů – teprve po jeho dokončení
        // zobrazíme potvrzení, aby byl minikošík aktuální
        if (typeof SP_Archive !== 'undefined' && SP_Archive.wc_ajax_url)
        {
          $.ajax(
          {
            url:    SP_Archive.wc_ajax_url.replace('%%endpoint%%', 'get_refreshed_fragments'),
            method: 'POST',
            success: function (response)
            {
              if (response && response.fragments)
              {
                $.each(response.fragments, function (key, value)
                {
                  if ($(key).length)
                  {
                    $(key).replaceWith(value);
                  }
                });
                $(document.body).trigger('wc_fragments_refreshed');
              }

              // Fragmenty jsou v DOMu – teprve teď potvrdit uživateli
              btn.textContent = '✓ Přidáno';
              setTimeout(function ()
              {
                btn.textContent = originalText;
                btn.disabled    = false;
              }, 2000);
            },
            error: function ()
            {
              // Refresh fragmentů selhal, ale produkt byl přidán
              btn.textContent = '✓ Přidáno';
              setTimeout(function ()
              {
                btn.textContent = originalText;
                btn.disabled    = false;
              }, 2000);
            }
          });
        }
        else
        {
          // SP_Archive není k dispozici – jen potvrdit přidání
          btn.textContent = '✓ Přidáno';
          setTimeout(function ()
          {
            btn.textContent = originalText;
            btn.disabled    = false;
          }, 2000);
        }
      },
      error: function (jqXHR, textStatus)
      {
        console.error('💥 addToCart selhal:', textStatus, jqXHR.status);
        btn.textContent = 'Chyba spojení';
        setTimeout(function () { btn.textContent = originalText; btn.disabled = false; }, 2000);
      }
    });
  }

  // ── Resolve inline variace ───────────────────────────────────

  function resolveInlineVariation(item)
  {
    const type       = item.dataset.type;
    const variations = JSON.parse(item.dataset.variations || '[]');

    if (type !== 'variable')
    {
      return { variationId: null, attrs: {} };
    }

    const selects  = item.querySelectorAll('.sp-inline-variation-select');
    const selected = {};

    selects.forEach(function (sel)
    {
      selected[sel.dataset.attribute] = sel.value;
    });

    const allChosen = Object.values(selected).every(function (v) { return v !== ''; });

    if ( ! allChosen )
    {
      return { variationId: null, attrs: selected, incomplete: true };
    }

    const match = variations.find(function (v)
    {
      return Object.keys(selected).every(function (key)
      {
        return v.attributes[key] === '' || v.attributes[key] === selected[key];
      });
    });

    if ( ! match ) return { variationId: null, attrs: selected, noMatch: true };

    return { variationId: match.id, attrs: selected };
  }

  // ── Inicializace ─────────────────────────────────────────────

  $(document).ready(function ()
  {
    const items = document.querySelectorAll('.sp-product-item');
    if ( ! items.length ) return;

    // První produkt – otevřít a přepnout obrázek
    if ( ! isTouchDevice() )
    {
      items[0].classList.add('open');
      switchImage(items[0].dataset.img);
    }

    // ── Klik na produkt – toggle .open ──
    items.forEach(function (item)
    {
      item.addEventListener('click', function (e)
      {
        // Ignoruj klik na interaktivní prvky
        if (
          e.target.closest('.sp-inline-cart-btn') ||
          e.target.closest('.sp-detail-btn')      ||
          e.target.closest('select')              ||
          e.target.closest('input')
        ) return;

        if (isTouchDevice()) return;

        const isOpen = item.classList.contains('open');

        // Zavři všechny
        items.forEach(function (i) { i.classList.remove('open'); });

        if ( ! isOpen)
        {
          item.classList.add('open');
          switchImage(item.dataset.img);
        }
      });
    });

    // ── Přidání do košíku ──
    document.addEventListener('click', function (e)
    {
      const btn = e.target.closest('.sp-inline-cart-btn');
      if ( ! btn ) return;

      const item = btn.closest('.sp-product-item');
      if ( ! item ) return;

      const productId = item.dataset.id;
      const qtyInput  = item.querySelector('.sp-inline-qty');
      const qty       = qtyInput ? parseInt(qtyInput.value, 10) : 1;

      const result = resolveInlineVariation(item);

      if (result.incomplete)
      {
        alert('Prosím vyberte variantu produktu.');
        return;
      }

      if (result.noMatch)
      {
        alert('Tato kombinace variant není dostupná.');
        return;
      }

      addToCart(productId, result.variationId, qty, result.attrs, btn);
    });

    // ── Změna varianty – aktualizace ceny a obrázku ──
    document.addEventListener('change', function (e)
    {
      const select = e.target.closest('.sp-inline-variation-select');
      if ( ! select ) return;

      const item       = select.closest('.sp-product-item');
      const variations = JSON.parse(item.dataset.variations || '[]');
      const selects    = item.querySelectorAll('.sp-inline-variation-select');
      const selected   = {};

      selects.forEach(function (sel)
      {
        selected[sel.dataset.attribute] = sel.value;
      });

      const allChosen = Object.values(selected).every(function (v) { return v !== ''; });
      if ( ! allChosen ) return;

      const match = variations.find(function (v)
      {
        return Object.keys(selected).every(function (key)
        {
          return v.attributes[key] === '' || v.attributes[key] === selected[key];
        });
      });

      if ( ! match ) return;

      // Inline cena
      const inlinePrice = item.querySelector('.sp-inline-price');
      if (inlinePrice) inlinePrice.innerHTML = match.price_html;

      // Obrázek v pravém panelu (jen pokud je item open)
      if (item.classList.contains('open'))
      {
        switchImage(match.image);
      }
    });

  });

})(jQuery);
