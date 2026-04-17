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

    // Přidej třídu has-bundle pro produkty s bundle náhledem (fb fixed bundles)
    items.forEach(function (item)
    {
      if (item.querySelector('.fb-bundle-preview'))
      {
        item.classList.add('has-bundle');
      }
    });

    // ── CFB Bundle Modal (bundles.php / flavor selector) ────────────────────

    // Vytvoříme modal element (pouze jednou)
    var cfbBundleModal = document.getElementById('sp-cfb-bundle-modal');
    if ( ! cfbBundleModal)
    {
      cfbBundleModal = document.createElement('div');
      cfbBundleModal.id = 'sp-cfb-bundle-modal';
      cfbBundleModal.setAttribute('role', 'dialog');
      cfbBundleModal.setAttribute('aria-modal', 'true');
      cfbBundleModal.innerHTML =
        '<div id="sp-cfb-bundle-backdrop"></div>' +
        '<div id="sp-cfb-bundle-dialog">' +
          '<button id="sp-cfb-bundle-close" aria-label="Zavřít">&times;</button>' +
          '<h2 id="sp-cfb-bundle-title"></h2>' +
          '<div id="sp-cfb-bundle-body"></div>' +
          '<div id="sp-cfb-bundle-footer">' +
            '<button id="sp-cfb-bundle-add" class="custom-product-btn single_add_to_cart_button" disabled>' +
              'PŘIDAT DO KOŠÍKU' +
            '</button>' +
          '</div>' +
          '<div id="sp-cfb-bundle-msg"></div>' +
        '</div>';
      document.body.appendChild(cfbBundleModal);
    }

    var cfbCurrentProductId  = null;
    var cfbCurrentPermalink  = null;

    function closeCfbBundleModal()
    {
      cfbBundleModal.classList.remove('sp-cfb-bundle-open');
      // Skryjeme také cfb product-preview modal, pokud byl otevřen uvnitř
      var innerBg  = document.getElementById('cfbModalBg');
      var innerMod = document.getElementById('cfbModal');
      if (innerBg)  innerBg.style.display  = 'none';
      if (innerMod) innerMod.style.display = 'none';
    }

    document.getElementById('sp-cfb-bundle-backdrop').addEventListener('click', closeCfbBundleModal);
    document.getElementById('sp-cfb-bundle-close').addEventListener('click', closeCfbBundleModal);

    // Klávesa Escape zavře modal
    document.addEventListener('keydown', function (e)
    {
      if (e.key === 'Escape' && cfbBundleModal.classList.contains('sp-cfb-bundle-open'))
      {
        closeCfbBundleModal();
      }
    });

    // Klik na tlačítko "VÝBĚR PRODUKTŮ"
    document.addEventListener('click', function (e)
    {
      var btn = e.target.closest('.sp-bundle-select-btn');
      if ( ! btn) return;

      e.stopPropagation();

      var item = btn.closest('.sp-product-item');
      cfbCurrentProductId = btn.dataset.productId || ( item ? item.dataset.id : null );
      cfbCurrentPermalink = item ? item.dataset.permalink : null;

      var titleEl  = document.getElementById('sp-cfb-bundle-title');
      var bodyEl   = document.getElementById('sp-cfb-bundle-body');
      var addBtn   = document.getElementById('sp-cfb-bundle-add');
      var msgEl    = document.getElementById('sp-cfb-bundle-msg');

      // Výchozí stav modalu
      titleEl.textContent  = item ? item.dataset.name : '';
      bodyEl.innerHTML     = '<div class="sp-cfb-bundle-loading">Načítám…</div>';
      addBtn.disabled      = true;
      addBtn.textContent   = 'PŘIDAT DO KOŠÍKU';
      msgEl.textContent    = '';

      cfbBundleModal.classList.add('sp-cfb-bundle-open');

      // Načteme bundle UI přes AJAX (renderuje cfb plugin server-side)
      $.ajax(
      {
        url:    SP_Archive.ajax_url,
        method: 'GET',
        data:
        {
          action:     'sp_cfb_bundle_ui',
          product_id: cfbCurrentProductId
        },
        success: function (response)
        {
          if ( ! response.success)
          {
            bodyEl.innerHTML = '<p>Chyba načítání výběru.</p>';
            return;
          }
          titleEl.textContent = response.data.name;
          // jQuery .html() vykoná inline <script> tagy (vč. cfb $(document).ready());
          // cfb kód spravuje disabled stav addBtn (má třídu single_add_to_cart_button)
          $(bodyEl).html(response.data.html);
          // Ujistíme se, že tlačítko začíná disabled –
          // cfb ho povolí teprve po dokončení validního výběru (+/-)
          addBtn.disabled = true;
        },
        error: function ()
        {
          bodyEl.innerHTML = '<p>Chyba spojení.</p>';
        }
      });
    });

    // Klik na "PŘIDAT DO KOŠÍKU" uvnitř bundle modalu
    document.getElementById('sp-cfb-bundle-add').addEventListener('click', function ()
    {
      if (this.disabled) return;
      if ( ! cfbCurrentProductId || ! cfbCurrentPermalink) return;

      var selectionInput = document.getElementById('cfb_flavor_selection');
      var selectionValue = selectionInput ? selectionInput.value : '';

      // Základní klientská validace: alespoň jedna položka musí být vybrána
      if ( ! selectionValue)
      {
        document.getElementById('sp-cfb-bundle-msg').textContent = 'Prosím vyberte položky balíčku.';
        return;
      }

      try
      {
        var selObj   = JSON.parse(selectionValue);
        var total    = Object.values(selObj).reduce(function (s, v) { return s + (v.qty || 0); }, 0);
        if (total === 0)
        {
          document.getElementById('sp-cfb-bundle-msg').textContent = 'Prosím vyberte položky balíčku.';
          return;
        }
      }
      catch (e) { /* Pokud JSON parsování selže, necháme server validovat */ }

      var addBtn = this;
      addBtn.disabled    = true;
      addBtn.textContent = '\u2026';
      document.getElementById('sp-cfb-bundle-msg').textContent = '';

      var params = new URLSearchParams();
      params.append('add-to-cart',           cfbCurrentProductId);
      params.append('product_id',            cfbCurrentProductId);
      params.append('quantity',              '1');
      params.append('cfb_flavor_selection',  selectionValue);

      $.ajax(
      {
        url:         cfbCurrentPermalink,
        method:      'POST',
        contentType: 'application/x-www-form-urlencoded',
        data:        params.toString(),
        success: function ()
        {
          // Refresh WooCommerce cart fragments
          if (typeof SP_Archive !== 'undefined' && SP_Archive.wc_ajax_url)
          {
            $.ajax(
            {
              url:    SP_Archive.wc_ajax_url.replace('%%endpoint%%', 'get_refreshed_fragments'),
              method: 'POST',
              success: function (r)
              {
                if (r && r.fragments)
                {
                  $.each(r.fragments, function (key, value)
                  {
                    if ($(key).length) $(key).replaceWith(value);
                  });
                  $(document.body).trigger('wc_fragments_refreshed');
                }
              }
            });
          }

          addBtn.textContent = '✓ Přidáno';
          setTimeout(function ()
          {
            closeCfbBundleModal();
            addBtn.textContent = 'PŘIDAT DO KOŠÍKU';
            addBtn.disabled    = false;
          }, 1500);
        },
        error: function ()
        {
          document.getElementById('sp-cfb-bundle-msg').textContent = 'Chyba při přidávání do košíku.';
          addBtn.textContent = 'PŘIDAT DO KOŠÍKU';
          addBtn.disabled    = false;
        }
      });
    });

    // ── Backdrop pro fb-modal (bundle quick-view z fixed-bundles.php) ───────
    var fbModal = document.getElementById('fb-modal');
    if (fbModal)
    {
      var fbBackdrop = document.createElement('div');
      fbBackdrop.id = 'sp-fb-backdrop';
      document.body.appendChild(fbBackdrop);

      var fbObserver = new MutationObserver(function ()
      {
        fbBackdrop.classList.toggle('sp-fb-backdrop-active', fbModal.style.display === 'block');
      });
      fbObserver.observe(fbModal, { attributes: true, attributeFilter: ['style'] });

      fbBackdrop.addEventListener('click', function ()
      {
        fbModal.style.display = 'none';
      });

      // ── Oprava šipek navigace a názvu varianty v modálu ─────────────────
      // fb-quick-view.js zpracuje zobrazení modálu; my sledujeme aktuální
      // pozici a doplníme název varianty do <h2> po každém načtení obsahu.

      var spFbContainer    = null;
      var spFbCurrentIndex = 0;
      var spFbTotalItems   = 0;
      var spFbItemName     = '';

      function spFbGetNameFromContainer(container, index)
      {
        if ( ! container) return '';
        var items = container.querySelectorAll('.fb-preview-item');
        var found = Array.prototype.find.call(items, function (item)
        {
          return parseInt(item.dataset.index, 10) === index;
        });
        if ( ! found) return '';
        var p = found.querySelector('p');
        return p ? p.textContent.trim() : '';
      }

      function spFbUpdateArrows()
      {
        var prevBtn = document.getElementById('fb-modal-prev');
        var nextBtn = document.getElementById('fb-modal-next');
        if (prevBtn) prevBtn.style.display = spFbCurrentIndex > 0 ? 'block' : 'none';
        if (nextBtn) nextBtn.style.display = spFbCurrentIndex < spFbTotalItems - 1 ? 'block' : 'none';

        // Přepíšeme název v <h2> správným názvem varianty.
        // Guard: nastavíme jen pokud se text liší – jinak by mutace textu
        // znovu spustila tento observer a vznikla by nekonečná smyčka.
        if (spFbItemName && fbModalContent)
        {
          var h2 = fbModalContent.querySelector('h2');
          if (h2 && h2.textContent !== spFbItemName) h2.textContent = spFbItemName;
        }
      }

      // Klik na položku preview – zaznamenej kontejner, index a název
      document.addEventListener('click', function (e)
      {
        var previewItem = e.target.closest('.fb-preview-item');
        if (previewItem)
        {
          spFbContainer    = previewItem.closest('.fb-bundle-preview');
          spFbCurrentIndex = parseInt(previewItem.dataset.index, 10);
          if (isNaN(spFbCurrentIndex)) spFbCurrentIndex = 0;
          spFbTotalItems   = spFbContainer ? spFbContainer.querySelectorAll('.fb-preview-item').length : 0;
          var nameEl       = previewItem.querySelector('p');
          spFbItemName     = nameEl ? nameEl.textContent.trim() : '';
        }

        // Šipka zpět
        if (e.target.closest('#fb-modal-prev'))
        {
          spFbCurrentIndex = Math.max(0, spFbCurrentIndex - 1);
          spFbItemName     = spFbGetNameFromContainer(spFbContainer, spFbCurrentIndex);
        }

        // Šipka vpřed
        if (e.target.closest('#fb-modal-next'))
        {
          spFbCurrentIndex = Math.min(spFbTotalItems - 1, spFbCurrentIndex + 1);
          spFbItemName     = spFbGetNameFromContainer(spFbContainer, spFbCurrentIndex);
        }
      });

      // Po načtení obsahu modálu (AJAX hotový) oprav šipky a název
      var fbModalContent = document.getElementById('fb-modal-content');
      if (fbModalContent)
      {
        new MutationObserver(spFbUpdateArrows)
          .observe(fbModalContent, { childList: true, subtree: true });
      }
    }

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
          e.target.closest('.sp-bundle-select-btn') ||
          e.target.closest('.sp-detail-btn')      ||
          e.target.closest('select')              ||
          e.target.closest('input')               ||
          e.target.closest('.fb-bundle-preview')  ||
          e.target.closest('#fb-modal')
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
