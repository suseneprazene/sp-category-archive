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
            '<button id="sp-cfb-bundle-add" class="custom-product-btn" disabled>' +
              'PŘIDAT DO KOŠÍKU' +
            '</button>' +
          '</div>' +
          '<div id="sp-cfb-bundle-msg"></div>' +
        '</div>';
      document.body.appendChild(cfbBundleModal);
    }

    var cfbCurrentProductId  = null;
    var cfbCurrentPermalink  = null;
    var cfbRequiredQty       = 0;
    var cfbPollInterval      = null;

    // ── CFB Debug Logger ──────────────────────────────────────────────────────
    // Aktivace: window.spCfbDebug = true (výchozí), deaktivace: false
    // Vše logovano do konzole s prefixem [CFB].
    window.spCfbDebug = (window.spCfbDebug !== false);

    var _cfbLastRawSelection = null; // pro diff sledování změn v #cfb_flavor_selection

    function cfbLog(label, data)
    {
      if ( ! window.spCfbDebug) return;
      if (data !== undefined)
      {
        console.groupCollapsed('%c[CFB] ' + label, 'color:#e67e00;font-weight:bold');
        console.log(data);
        console.groupEnd();
      }
      else
      {
        console.log('%c[CFB] ' + label, 'color:#e67e00;font-weight:bold');
      }
    }

    function cfbLogSelectionDiff(context)
    {
      if ( ! window.spCfbDebug) return;
      var selInput = document.getElementById('cfb_flavor_selection');
      var raw      = selInput ? selInput.value : '';

      if (raw === _cfbLastRawSelection) return; // beze změny → přeskočíme
      _cfbLastRawSelection = raw;

      var parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = '⚠ JSON parse chyba: ' + e.message; }

      var total = 0;
      if (parsed && typeof parsed === 'object')
      {
        total = Object.values(parsed).reduce(function (s, v)
        {
          return s + parseInt(v.qty || 0, 10);
        }, 0);
      }

      console.group('%c[CFB] 🔄 #cfb_flavor_selection změna (' + context + ')', 'color:#0070cc;font-weight:bold');
      console.log('raw     :', raw || '(prázdné)');
      console.log('parsed  :', parsed);
      console.log('total   :', total, '/ required:', cfbRequiredQty);
      console.log('btn dis?:', cfbRequiredQty > 0 ? (total !== cfbRequiredQty) : (total === 0));
      console.groupEnd();
    }

    // Sleduj kliknutí na +/- tlačítka cfb pluginu (delegace na document)
    document.addEventListener('click', function (e)
    {
      if ( ! window.spCfbDebug) return;
      var isPlus  = e.target.closest('.cfb-plus');
      var isMinus = e.target.closest('.cfb-minus');
      if ( ! isPlus && ! isMinus) return;

      var btn      = isPlus || isMinus;
      var flavorId = btn.dataset.flavorId  || btn.dataset.flavor_id  || '?';
      var row      = btn.closest('[data-flavor-id]') || btn.closest('[data-flavor_id]') || btn.parentElement;

      // cfb nemusí mít input[type="number"] – hledáme cokoliv co drží qty (input nebo span)
      var qtyInput = row
        ? (row.querySelector('input[type="number"]') ||
           row.querySelector('.cfb-qty') ||
           row.querySelector('[class*="qty"]') ||
           row.querySelector('[class*="count"]'))
        : null;
      var qtyBefore = qtyInput ? (qtyInput.value !== undefined ? qtyInput.value : qtyInput.textContent) : '? (žádný qty element)';

      console.group('%c[CFB] ' + (isPlus ? '➕ PLUS' : '➖ MINUS') + ' klik', 'color:#27ae60;font-weight:bold');
      console.log('flavorId        :', flavorId);
      console.log('qty PŘED klikem :', qtyBefore);
      console.log('btn element     :', btn);
      console.log('btn outerHTML   :', btn.outerHTML);
      console.log('btn dataset     :', JSON.stringify(btn.dataset));
      console.log('row element     :', row);

      // Před klikem: stav #cfb_flavor_selection
      var selBefore = document.getElementById('cfb_flavor_selection');
      var rawBefore = selBefore ? selBefore.value : '(#cfb_flavor_selection nenalezeno!)';
      console.log('#cfb_flavor_selection PŘED:', rawBefore || '(prázdné)');
      console.log('cfbRequiredQty  :', cfbRequiredQty);

      // Po 0 ms přečteme stav po zpracování cfb handlerem
      setTimeout(function ()
      {
        var qtyAfter = qtyInput
          ? (qtyInput.value !== undefined ? qtyInput.value : qtyInput.textContent)
          : '? (žádný qty element)';
        var selInput = document.getElementById('cfb_flavor_selection');
        var rawAfter = selInput ? selInput.value : '(#cfb_flavor_selection nenalezeno!)';
        var parsed   = null;
        try { parsed = rawAfter ? JSON.parse(rawAfter) : null; } catch (err) { parsed = '⚠ JSON parse chyba: ' + err.message; }

        var total = 0;
        if (parsed && typeof parsed === 'object')
        {
          total = Object.values(parsed).reduce(function (s, v) { return s + parseInt(v.qty || 0, 10); }, 0);
        }

        console.log('qty PO kliknutí :', qtyAfter);
        console.log('#cfb_flavor_selection PO:', rawAfter || '(prázdné)');
        console.log('parsed PO       :', parsed);
        console.log('total PO        :', total, '/ required:', cfbRequiredQty,
          total === cfbRequiredQty ? '→ ✅ SHODA (btn by měl být ENABLED)' : '→ 🔴 NESHODUJE SE (btn zůstane disabled)');

        if (rawBefore === rawAfter)
        {
          console.warn('⚠ #cfb_flavor_selection se po kliknutí NEZMĚNILO – cfb plugin neaktualizoval skrytý input!');
        }

        console.groupEnd();

        // Force diff log (vždy, i bez změny)
        var prev = _cfbLastRawSelection;
        _cfbLastRawSelection = null; // reset, aby cfbLogSelectionDiff vždy zlogoval
        cfbLogSelectionDiff(isPlus ? '+klik' : '-klik');
        if (prev === rawAfter)
        {
          // Nic se nezměnilo – zalogujeme bez diff filtru pro jistotu
        }
      }, 0);
    }, true); // capture=true → spustíme dřív než cfb handler (stopPropagation nebrání)

    // ── CFB Debug Logger END ──────────────────────────────────────────────────

    /**
     * Porovná celkový počet vybraných kusů (z #cfb_flavor_selection JSON)
     * s cfbRequiredQty (celkový limit ze všech sekcí, vrácený ze serveru).
     * Povolí tlačítko jen tehdy, když je vybrán přesně požadovaný počet.
     */
    function syncCfbAddBtn()
    {
      var addBtn   = document.getElementById('sp-cfb-bundle-add');
      var selInput = document.getElementById('cfb_flavor_selection');
      if ( ! addBtn) return;
      if ( ! selInput || ! selInput.value) { addBtn.disabled = true; return; }

      var sel;
      try { sel = JSON.parse(selInput.value); }
      catch (e) { addBtn.disabled = true; return; }

      var total = Object.values(sel).reduce(function (s, v)
      {
        return s + parseInt(v.qty || 0, 10);
      }, 0);

      var newDisabled = cfbRequiredQty > 0 ? (total !== cfbRequiredQty) : (total === 0);

      // Log only when button state actually changes
      if (window.spCfbDebug && addBtn.disabled !== newDisabled)
      {
        cfbLog(
          (newDisabled ? '🔒 tlačítko DISABLED' : '✅ tlačítko ENABLED') +
          ' (total=' + total + ' required=' + cfbRequiredQty + ')'
        );
      }

      addBtn.disabled = newDisabled;
      cfbLogSelectionDiff('poll');
    }

    function closeCfbBundleModal()
    {
      cfbBundleModal.classList.remove('sp-cfb-bundle-open');
      if (cfbPollInterval) { clearInterval(cfbPollInterval); cfbPollInterval = null; }
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
            cfbLog('❌ AJAX sp_cfb_bundle_ui selhalo', response);
            return;
          }
          titleEl.textContent = response.data.name;
          cfbRequiredQty      = parseInt(response.data.required_qty || 0, 10);

          cfbLog('📦 Modal otevřen', {
            productId:        cfbCurrentProductId,
            name:             response.data.name,
            required_qty:     cfbRequiredQty,
            '⚠ POZOR – required_qty=0 znamená, že klíč "limit" v _cfb_bundle_items neexistuje': cfbRequiredQty === 0,
            bundle_items_raw: response.data.bundle_items_raw || '(nedostupné)',
            htmlLength:       (response.data.html || '').length + ' znaků'
          });

          // jQuery .html() vloží HTML vč. cfb inline <script> tagy.
          $(bodyEl).html(response.data.html);

          cfbLog('🔍 Prvky v #sp-cfb-bundle-body po vložení HTML', {
            'input[type=number]': document.querySelectorAll('#sp-cfb-bundle-body input[type="number"]').length,
            '.cfb-plus':          document.querySelectorAll('#sp-cfb-bundle-body .cfb-plus').length,
            '.cfb-minus':         document.querySelectorAll('#sp-cfb-bundle-body .cfb-minus').length,
            '#cfb_flavor_selection exists': !! document.getElementById('cfb_flavor_selection'),
            '#cfb_flavor_selection value': (document.getElementById('cfb_flavor_selection') || {}).value || '(prázdné)',
            'všechny hidden inputs': (function ()
            {
              var r = {};
              document.querySelectorAll('#sp-cfb-bundle-body input[type="hidden"]').forEach(function (el)
              {
                r[el.name || el.id || '(no name)'] = el.value;
              });
              return r;
            }())
          });

          _cfbLastRawSelection = null; // reset diff sledování pro nový modal

          // cfb píše do #cfb_flavor_selection přes jQuery .val() – to nativní
          // eventy nespustí. Proto pollujeme každých 150 ms dokud je modal otevřen.
          if (cfbPollInterval) clearInterval(cfbPollInterval);
          cfbPollInterval = setInterval(syncCfbAddBtn, 150);

          // Inicializační sync (výběr je prázdný → disabled)
          syncCfbAddBtn();
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

      // Použijeme WooCommerce AJAX endpoint místo POST na permalink.
      // Endpoint wc-ajax=add_to_cart volá WC()->cart->add_to_cart() a spouští
      // všechny WC filtry vč. woocommerce_add_cart_item_data (kde cfb čte
      // cfb_flavor_selection). Odpovědí je JSON s fragmenty košíku.
      var wcAjaxUrl = (typeof SP_Archive !== 'undefined' && SP_Archive.wc_ajax_url)
        ? SP_Archive.wc_ajax_url.replace('%%endpoint%%', 'add_to_cart')
        : '/?wc-ajax=add_to_cart';

      var params = new URLSearchParams();
      params.append('product_id',           cfbCurrentProductId);
      params.append('quantity',             '1');
      params.append('cfb_flavor_selection', selectionValue);

      cfbLog('🛒 PŘIDAT DO KOŠÍKU – odesílaná data', {
        endpoint:            wcAjaxUrl,
        product_id:          cfbCurrentProductId,
        quantity:            1,
        cfb_flavor_selection: (function ()
        {
          try { return JSON.parse(selectionValue); } catch (e) { return selectionValue; }
        }()),
        params_raw:          params.toString()
      });

      $.ajax(
      {
        url:         wcAjaxUrl,
        method:      'POST',
        contentType: 'application/x-www-form-urlencoded',
        data:        params.toString(),
        success: function (response, status, jqXHR)
        {
          cfbLog('✅ Košík AJAX – odpověď', {
            status:         jqXHR.status,
            contentType:    jqXHR.getResponseHeader('Content-Type'),
            error:          response && response.error,
            notices:        response && response.notices,
            fragmentKeys:   response && response.fragments ? Object.keys(response.fragments) : [],
            responseRaw:    typeof response === 'string' ? response.substring(0, 400) : response
          });

          if (response && response.error)
          {
            // WooCommerce vrátil chybu (nedostatek skladu, neplatný produkt, …)
            var msg = (response.notices || 'WooCommerce odmítl přidat do košíku.');
            document.getElementById('sp-cfb-bundle-msg').innerHTML = msg;
            addBtn.textContent = 'PŘIDAT DO KOŠÍKU';
            addBtn.disabled    = false;
            return;
          }

          // Aplikujeme fragmenty košíku vrácené přímo z add_to_cart odpovědi
          if (response && response.fragments)
          {
            $.each(response.fragments, function (key, value)
            {
              if ($(key).length) $(key).replaceWith(value);
            });
            $(document.body).trigger('wc_fragments_refreshed');
            cfbLog('🔄 Fragmenty košíku aplikovány z add_to_cart odpovědi');
          }
          else
          {
            // Záložní refresh fragmentů
            if (typeof SP_Archive !== 'undefined' && SP_Archive.wc_ajax_url)
            {
              $.ajax(
              {
                url:    SP_Archive.wc_ajax_url.replace('%%endpoint%%', 'get_refreshed_fragments'),
                method: 'POST',
                success: function (r)
                {
                  cfbLog('🔄 Fragmenty košíku refreshnuty (záložní)', { fragmentKeys: r && r.fragments ? Object.keys(r.fragments) : [] });
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
          }

          addBtn.textContent = '✓ Přidáno';
          setTimeout(function ()
          {
            closeCfbBundleModal();
            addBtn.textContent = 'PŘIDAT DO KOŠÍKU';
            addBtn.disabled    = false;
          }, 1500);
        },
        error: function (jqXHR, textStatus, errorThrown)
        {
          cfbLog('❌ Košík AJAX – HTTP chyba', {
            status:      jqXHR.status,
            textStatus:  textStatus,
            errorThrown: errorThrown,
            response:    jqXHR.responseText ? jqXHR.responseText.substring(0, 400) : ''
          });
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
