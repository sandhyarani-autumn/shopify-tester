import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const stores = fs.existsSync('stores-to-run.json')
  ? JSON.parse(fs.readFileSync('stores-to-run.json', 'utf-8'))
  : [];

const stepResults: Record<string, any[]> = {};

if (stores.length === 0) {
  test('No stores scheduled this hour', async () => {
    console.log('No stores are scheduled to run at this time.');
  });
} else {

  for (const store of stores) {

    test(`[${store.client_name}] ${store.store_url}`, async ({ page }) => {

      const steps: any[] = [];
      stepResults[store.store_url] = steps;

      // Clean URL — trailing slash remove
      const storeUrl = store.store_url.replace(/\/$/, '');

      // ── Step 1: Open store ───────────────────────────
      try {
        await page.goto(storeUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        await handleAllPopups(page);
        steps.push({ step: 'Open Store', status: 'pass' });
        console.log(`[${new Date().toISOString()}] ✅ Step 1: Store opened`);
      } catch (e) {
        steps.push({ step: 'Open Store', status: 'fail',
          error: 'Could not open store URL' });
        throw e;
      }

      // ── Step 2: Search product ───────────────────────
      try {
        const searched = await trySearch(page, store.product);
        if (!searched) {
          await page.goto(
            `${storeUrl}/search?q=${encodeURIComponent(store.product)}`,
            { waitUntil: 'domcontentloaded' }
          );
          await page.waitForTimeout(500);
        }
        await handleAllPopups(page);
        steps.push({ step: 'Search Product', status: 'pass' });
        console.log(`[${new Date().toISOString()}] ✅ Step 2: Searched "${store.product}"`);
      } catch (e) {
        steps.push({ step: 'Search Product', status: 'fail',
          error: 'Search failed' });
        throw e;
      }

      // ── Step 3: Open first product ───────────────────
      const productSelectors = [
        // Neweracap specific
        'a.product-card__media',
        'a.product-title',
        '.product-card__media',

        // Generic
        '.product-item a',
        '.product-card a',
        '.grid__item a',
        '[data-product-card] a',
        '.card__heading a',
        '.card__information a',
        '.product a',
        'li.product a',
        'a.product-item-meta__title',
        'a.product-item__aspect-ratio',
        'a[href*="/products/"]',
      ];

      let productOpened = false;
      for (const sel of productSelectors) {
        try {
          const count = await page.locator(sel).count();
          if (count === 0) continue;

          // OFFLOAD TO BROWSER TO AVOID 10,000 IPC WATERFALL ROUNDTRIPS!
          const matchIndex = await page.evaluate((selector) => {
            const els = document.querySelectorAll(selector);
            for (let i=0; i<els.length; i++) {
              const el = els[i] as HTMLElement;
              const text      = (el.textContent || '').toLowerCase().trim();
              const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
              const className = (el.className || '').toLowerCase();
              const href      = (el.getAttribute('href') || '').toLowerCase();

              const isWishlist =
                text.includes('wishlist')      || text.includes('wish list') ||
                text.includes('compare')       || text.includes('favorite')  ||
                text.includes('heart')         ||
                ariaLabel.includes('wishlist') || ariaLabel.includes('save') ||
                ariaLabel.includes('favorite') ||
                className.includes('wishlist') || className.includes('wish') ||
                className.includes('hulk')     || className.includes('favorite');

              if (isWishlist) continue;
              if (href && !href.includes('/product')) continue;

              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width === 0 || rect.height === 0) continue;

              return i; // Target verified & visible
            }
            return -1;
          }, sel);

          if (matchIndex !== -1) {
            try {
              const el = page.locator(sel).nth(matchIndex);
              await el.scrollIntoViewIfNeeded();
              await page.waitForTimeout(300);
              try {
                await el.click({ timeout: 3000 });
              } catch (err) {
                console.log('⚠️ Product click intercepted, attempting to handle popups...');
                await handleAllPopups(page);
                await page.waitForTimeout(300); // Wait for modal fade-out
                try {
                  await el.click({ timeout: 2000 });
                } catch (err2) {
                  console.log(`[${new Date().toISOString()}] ⚠️ Second click failed. Forcing native JS evaluation...`);
                  await el.evaluate(node => (node as HTMLElement).click());
                }
              }
              productOpened = true;
              console.log(`✅ Product clicked: "${sel}" [index ${matchIndex}]`);
              break;
            } catch (innerErr) {
              console.log(`⚠️ Fatal error accessing product node: ${innerErr}`);
            }
          }

          if (productOpened) break;
        } catch {}
      }

      if (!productOpened) {
        steps.push({ step: 'Open Product', status: 'fail',
          error: 'No product found in search results' });
        expect(false, 'No product found').toBe(true);
      } else {
        steps.push({ step: 'Open Product', status: 'pass' });
      }

      await page.waitForTimeout(500);
      await handleAllPopups(page);
      console.log(`[${new Date().toISOString()}] ✅ Step 3: Product page opened`);

      // ── Step 4: Add to Cart ──────────────────────────
      const cartSelectors = [
        'button.button.w-full',
        'button.button:has-text("ADD TO CART")',
        'button.button:has-text("Add to Cart")',
        'button.button:has-text("Add to cart")',
        'button:has-text("ADD TO CART")',
        'button:has-text("Add to Cart")',
        'button:has-text("Add to cart")',
        'button[name="add"]',
        'input[name="add"]',
        '.product-form__submit',
        '[data-testid="add-to-cart"]',
      ];

      let addedToCart = false;
      for (const sel of cartSelectors) {
        try {
          const count = await page.locator(sel).count();
          for (let i=0; i<count; i++) {
            const el = page.locator(sel).nth(i);
            if (!await el.isVisible()) continue;

            await el.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
            try {
              await el.click({ timeout: 3000 });
            } catch (err) {
              console.log(`⚠️ Add to Cart click intercepted, attempting to handle popups...`);
              await handleAllPopups(page);
              await page.waitForTimeout(300);
              await el.click({ timeout: 2000 });
            }
            addedToCart = true;
            console.log(`✅ Add to Cart clicked: ${sel}`);
            break;
          }
          if (addedToCart) break;
        } catch {}
      }

      if (!addedToCart) {
        console.log('⚠️ Add to Cart button not found or disabled. Attempting to select an available variant...');
        
        const variantSelectors = [
          '.product-form fieldset label:not(.disabled):not(.soldout):not(.out-of-stock)',
          '.product-form__input input[type="radio"] + label:not(.disabled):not(.soldout)',
          '.variant-input label:not(.disabled):not(.soldout)',
          '.swatch-element label:not(.disabled):not(.soldout)',
          '.product-form label[for^="Option-"]:not(.disabled)',
          '.swatch label:not(.disabled)',
          '.variant-wrapper label:not(.disabled)',
          // Fallbacks if no structural parents
          'label:not(.disabled):not(.soldout):not(.out-of-stock)'
        ];

        let variantSelected = false;
        const clickedYLevels: number[] = [];
        
        for (const vSel of variantSelectors) {
          try {
            const vCount = await page.locator(vSel).count();
            if (vCount === 0) continue;
            
            for (let v=0; v<vCount; v++) {
              const vEl = page.locator(vSel).nth(v);
              
              if (!await vEl.isVisible().catch(()=>false)) continue;

              const klass = (await vEl.getAttribute('class') || '').toLowerCase();
              if (klass.includes('disabled') || klass.includes('soldout') || klass.includes('out-of-stock')) continue;
              if (klass.includes('active') || klass.includes('selected') || klass.includes('checked')) continue;
              
              // Skip if the associated radio is already checked
              const isChecked = await vEl.evaluate(node => {
                const prev = node.previousElementSibling;
                if (prev && prev.tagName === 'INPUT' && (prev as HTMLInputElement).checked) return true;
                const child = node.querySelector('input');
                if (child && child.checked) return true;
                return false;
              }).catch(() => false);
              
              if (isChecked) continue;

              const box = await vEl.boundingBox();
              if (!box) continue;
              
              // If we already clicked a variant on this horizontal row (e.g. Size vs Color tiers), skip
              const sameLevel = clickedYLevels.some(y => Math.abs(y - box.y) < 30);
              if (sameLevel) continue;
              
              await vEl.click({ timeout: 2000 });
              clickedYLevels.push(box.y);
              variantSelected = true;
              console.log(`✅ Selected available variant tier: ${vSel} (nth: ${v})`);
              await page.waitForTimeout(300); // Allow frontend framework reaction
            }
            if (variantSelected) break; // We found the correct structural selector rule and processed it
          } catch {}
        }

        if (variantSelected) {
          // Retry adding to cart
          await page.waitForTimeout(500); // Allow react hydration
          for (const sel of cartSelectors) {
            try {
              const count = await page.locator(sel).count();
              for (let i=0; i<count; i++) {
                const el = page.locator(sel).nth(i);
                if (!await el.isVisible()) continue;

                await el.scrollIntoViewIfNeeded();
                await page.waitForTimeout(200);
                try {
                  await el.click({ timeout: 3000 });
                } catch (err) {
                  await handleAllPopups(page);
                  await page.waitForTimeout(300);
                  await el.click({ timeout: 2000 });
                }
                addedToCart = true;
                console.log(`✅ Add to Cart clicked (after variant selection): ${sel}`);
                break;
              }
              if (addedToCart) break;
            } catch {}
          }
        }
      }

      if (!addedToCart) {
        steps.push({ step: 'Add to Cart', status: 'fail',
          error: 'Add to Cart button not found' });
        expect(false, 'Add to Cart failed').toBe(true);
      } else {
        steps.push({ step: 'Add to Cart', status: 'pass' });
        console.log(`[${new Date().toISOString()}] ✅ Step 4: Added to cart`);
      }

      console.log('Waiting for cart drawer...');
      await page.waitForTimeout(500);

      // ── Step 5: Cart Drawer OR Cart Page Checkout ────
      const checkedOut = await handleCartDrawerCheckout(page, storeUrl);

      if (!checkedOut) {
        steps.push({ step: 'Checkout', status: 'fail',
          error: 'Checkout button not found in drawer or cart page' });
        expect(false, 'Checkout failed').toBe(true);
      } else {
        steps.push({ step: 'Cart / Checkout', status: 'pass' });
        console.log(`[${new Date().toISOString()}] ✅ Step 5: Checkout clicked successfully`);
      }

      // ── Step 6: Verify checkout URL ──────────────────
      try {
        let checkoutType = 'page';
        
        await Promise.any([
          page.waitForURL(/checkout|checkouts|razorpay|simpl|gokwik|cashfree|paytm|secure|payu|ccavenue|billdesk|cred/, { timeout: 30000 }),
          page.waitForSelector(
            '.razorpay-checkout-frame, iframe[src*="razorpay"], iframe[src*="checkout"], #simpl-checkout, iframe[src*="gokwik"], [id*="gokwik"], [class*="gokwik"], [id*="simpl"], [id*="razorpay"], [class*="razorpay"], iframe[src*="cashfree"], iframe[name*="payu"], #gokwik-iframe, iframe[title*="checkout" i], iframe[title*="payment" i], div[role="dialog"]', 
            { state: 'attached', timeout: 30000 }
          ).then(() => { checkoutType = 'popup'; })
        ]);

        steps.push({ step: 'Verify Checkout', status: 'pass' });
        console.log(`[${new Date().toISOString()}] ✅ Step 6: Checkout ${checkoutType} fully loaded`);
        
        // Visual buffer taaki screen user ko 5 seconds tak dikhai de test pass hone ke baad
        await page.waitForTimeout(5000);
        
        // Forcefully sever the entire Browser Context instance instantly.
        await page.context().close();
      } catch (e) {
        steps.push({ step: 'Verify Checkout', status: 'fail',
          error: 'Checkout page or Razorpay overlay did not appear' });
        throw e;
      }

    });
  }
}

// ══════════════════════════════════════════════════
//  SMART CART DRAWER + CHECKOUT HANDLER
// ══════════════════════════════════════════════════
async function handleCartDrawerCheckout(
  page: Page,
  storeUrl: string
): Promise<boolean> {

  await page.waitForTimeout(2000);

  // ── Drawer detect karo ───────────────────────────
  const drawerSelectors = [
    '.cart-drawer',
    '.cart-drawer__inner',
    '#cart-drawer',
    '[data-cart-drawer]',
    '#CartDrawer',
    '.js-drawer-open',
    '[class*="cart-drawer"]',
    '.drawer',
    '[class*="drawer"]',
  ];

  let drawerFound    = false;
  let drawerSelector = '';

  for (const sel of drawerSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        drawerFound    = true;
        drawerSelector = sel;
        console.log(`✅ Cart drawer found: ${sel}`);
        break;
      }
    } catch {}
  }

  if (drawerFound) {

    // Extra wait — drawer fully load hone do
    await page.waitForTimeout(2000);

    // Drawer ke andar scroll karo
    try {
      await page.evaluate((sel) => {
        const d =
          document.querySelector(sel) ||
          document.querySelector('.cart-drawer') ||
          document.querySelector('[class*="cart-drawer"]');
        if (d) d.scrollTop = d.scrollHeight;
      }, drawerSelector);
      await page.waitForTimeout(1000);
      console.log('Scrolled inside drawer');
    } catch {}



    // ── Method 2: Playwright selectors ──────────────
    const drawerCheckoutSelectors = [
      'magic-checkout-btn',
      '.magic-checkout-btn',
      '.rzp-checkout-btn',
      'a[href="/checkout"]',
      'a[href*="/checkout"]',
      'a[href*="checkouts"]',
      '[name="checkout"]',
      '.cart__checkout',
      'button.cart__checkout-button',
      'button:has-text("Check out")',
      'button:has-text("Checkout")',
      'button:has-text("CHECKOUT")',
      'a:has-text("Check out")',
      'a:has-text("Checkout")',
      'a:has-text("CHECKOUT")',
      `.cart-drawer a[href*="checkout"]`,
      `.cart-drawer button`,
      `.cart-drawer__footer a`,
      `.cart-drawer__footer button`,
      `${drawerSelector} a[href*="checkout"]`,
      `${drawerSelector} button:last-of-type`,
      // Add 3-attempt polling loop to wait for complex third-party lazy-loaded Web Components (Gokwik, Razorpay)
      '#gokwik-checkout',
      '#simpl-checkout',
      '#razorpay-checkout',
      '.gokwik-checkout-button',
      '.simpl-checkout-button',
      '.razorpay-checkout-button',
    ];

    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const rawSel of drawerCheckoutSelectors) {
        // Enforce strict DOM bounding: If a drawer was isolated, only search INSIDE that exact drawer node.
        const sel = (drawerFound && drawerSelector && !rawSel.includes(drawerSelector) && !rawSel.includes('.drawer') && !rawSel.includes('#cart')) 
          ? `${drawerSelector} ${rawSel}` 
          : rawSel;

        try {
          const count = await page.locator(sel).count();
          if (count === 0) continue;

          for (let i = 0; i < count; i++) {
            const el = page.locator(sel).nth(i);
            const isVisible = await el.isVisible().catch(() => false);
            if (!isVisible) continue;

            const href = await el.getAttribute('href').catch(() => '') || '';
            const text = (await el.textContent() || '').trim().toLowerCase();
            const klass = (await el.getAttribute('class') || '').toLowerCase();
            const name = (await el.getAttribute('name') || '').toLowerCase();
            const id = (await el.getAttribute('id') || '').toLowerCase();

            // If selector is explicitly a checkout identifier, we trust it. Otherwise, we enforce strict text/attribute bounds.
            const isExplicitSelector = sel.includes('checkout') || sel.includes('rzp') || sel.includes('magic') || sel.includes('gokwik') || sel.includes('simpl');
            const hasCheckoutKeywords = 
              href.includes('checkout') || 
              text.includes('checkout') || text.includes('check out') || text.includes('pay') || text.includes('place order') ||
              klass.includes('checkout') || name.includes('checkout') || id.includes('checkout');
            
            if (!isExplicitSelector && !hasCheckoutKeywords) {
              continue;
            }

            await el.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(200);

            await el.evaluate((node: any) => {
              node.removeAttribute('disabled');
              node.disabled = false;
              node.style.pointerEvents = 'auto';
            }).catch(() => {});

            try {
              await el.click({ timeout: 3000 });
            } catch(err) {
              console.log(`⚠️ Drawer Checkout click intercepted, attempting to handle popups...`);
              await handleAllPopups(page);
              await page.waitForTimeout(300);
              try {
                await el.click({ timeout: 2000 });
              } catch (err2) {
                console.log(`⚠️ Second click failed for nth(${i}). Skipping to next...`);
                continue;
              }
            }

            console.log(`✅ Drawer checkout clicked: "${text || href}"`);
            return true;
          }
        } catch {}
      } // End of sel loop
      
      console.log(`⚠️ Gateway hydration pending on attempt ${attempt}/3. Waiting 3000ms...`);
      await page.waitForTimeout(3000);
    } // End of attempt loop

    // ── Method 3: Force click ────────────────────────
    console.log('Trying force clicks...');

    const forceSelectors = [
      'a[href*="checkout"]', 
      '[name="checkout"]', 
      'button:has-text("Checkout")', 
      'button:has-text("Check out")', 
      'button:has-text("CHECKOUT")',
      '.cart__checkout-button',
      '.cart__checkout',
      '.magic-checkout-btn',
      '#gokwik-checkout'
    ];
    for (const rawSel of forceSelectors) {
      const sel = (drawerFound && drawerSelector && !rawSel.includes(drawerSelector) && !rawSel.includes('.drawer') && !rawSel.includes('#cart')) 
        ? `${drawerSelector} ${rawSel}` 
        : rawSel;

      try {
        const count = await page.locator(sel).count();
        if (count > 0) {
          const el = page.locator(sel).first();
          await el.click({ force: true, timeout: 3000 });
          console.log(`✅ Force click: ${sel}`);
          return true;
        }
      } catch {}
    }
  }

  return false;
}

// ══════════════════════════════════════════════════
//  POPUP HANDLER
// ══════════════════════════════════════════════════
async function handleAllPopups(page: Page) {

  // CRITICAL: Allow third-party iframes (React/Vue/Angular overlays) a brief window to complete their
  // internal network hydration and mount their inner shadow-DOM nodes before we sweep them instantly.
  await page.waitForTimeout(1500);

  const cookieSelectors = [
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("I Accept")',
    'button:has-text("Agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    '.cookie-accept',
    '#cookie-accept',
  ];

  // Helper to concurrently check visibility of all selectors without IPC waterfall delays
  const checkConcurrently = async (selectors: string[], frameObj: any) => {
    try {
      // Execute all selector queries locally within the Chromium frame context in ONE single microsecond payload
      const didClick = await frameObj.evaluate((sels: string[]) => {
        
        // Helper to check standard visibility bounds natively
        const isClickable = (el: HTMLElement) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        };

        for (const sel of sels) {
          try {
            // Handle Playwright custom pseudo-selectors: 'button:has-text("No thanks")' or 'text="No thanks"'
            if (sel.includes(':has-text') || sel.startsWith('text=')) {
              let textTarget = '';
              let tagTarget = 'button';
              
              if (sel.startsWith('text=')) {
                textTarget = sel.replace('text=', '').replace(/"/g, '').replace(/'/g, '').trim().toLowerCase();
                tagTarget = '*'; // Any tag
              } else {
                const parts = sel.split(':has-text(');
                tagTarget = parts[0] || '*';
                textTarget = parts[1].replace(')', '').replace(/"/g, '').replace(/'/g, '').trim().toLowerCase();
              }

              // Convert to Array and reverse so we parse innermost matching leaf nodes first,
              // preventing us from accidentally clicking the root <html> or <body> element!
              const elements = Array.from(document.querySelectorAll(tagTarget)).reverse();
              for (const el of elements) {
                const htmlEl = el as HTMLElement;
                // innerText strictly parses rendered text (ignoring hidden scripts)
                if (htmlEl.innerText && htmlEl.innerText.toLowerCase().includes(textTarget)) {
                  if (isClickable(htmlEl)) {
                    htmlEl.click();
                    return true;
                  }
                }
              }
              continue; // Move to next selector if no valid text matched
            }

            // Handle Standard CSS Locators natively
            const els = document.querySelectorAll(sel);
            for (let i = 0; i < els.length; i++) {
              if (isClickable(els[i] as HTMLElement)) {
                (els[i] as HTMLElement).click();
                return true;
              }
            }
          } catch (e) {}
        }
        return false;
      }, selectors).catch(() => false);

      if (didClick) {
        await page.waitForTimeout(200);
        return true;
      }
    } catch {}
    return false;
  };

  const discountSelectors = [
    'button:has-text("No thanks")',
    'button:has-text("No, thanks")',
    'text="No thanks"',
    'text="No, thanks"',
    'button:has-text("Skip")',
    'button:has-text("Maybe later")',
    'button:has-text("Dismiss")',
    'button:has-text("Continue without discount")',
    '[data-popup-close]',
    '[data-modal-close]',
    '.popup-close',
    '.modal-close',
    'button:has-text("×")',
    'button:has-text("✕")',
    '.klaviyo-close-form',
    '.privy-dismiss-button',
    '.react-responsive-modal-close-icon',
    '.needsclick.kl-private-reset-css',
    '#gokwik-modal-close',
    '[aria-label="Dismiss"]',
    '[aria-label="survey close"]',
    '.close-icon',
    '[class*="close-icon"]',
    '[class*="CloseIcon"]',
    'button[aria-label="Close modal"]',
    'button[aria-label="Close dialog"]',
    'button[aria-label="Close popup"]',
  ];

  const iframeOnlySelectors = [
    '.close',
    'div.close',
    'button.close',
    'span.close',
    'a.close',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    'button:has-text("Close")'
  ];

  await checkConcurrently(cookieSelectors, page);
  await checkConcurrently(discountSelectors, page);

  const allIframeSelectors = [...discountSelectors, ...iframeOnlySelectors];
  console.log(`[${new Date().toISOString()}] [POPUP] Starting iframe sweep over ${page.frames().length} frames...`);
  for (const frame of page.frames()) {
    try {
      console.log(`[${new Date().toISOString()}] [POPUP] Checking frame: ${frame.url().substring(0, 50)}`);
      if (await checkConcurrently(allIframeSelectors, frame)) break;
    } catch (e) {}
  }
  console.log(`[${new Date().toISOString()}] [POPUP] Iframe sweep complete.`);

  const ageSelectors = [
    'button:has-text("Yes, I am")',
    'button:has-text("I am over 18")',
    'button:has-text("Enter")',
    '.age-verify-yes',
  ];
  await checkConcurrently(ageSelectors, page);

  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  } catch {}
}

// ══════════════════════════════════════════════════
//  SEARCH HELPER
// ══════════════════════════════════════════════════
async function trySearch(page: Page, product: string): Promise<boolean> {
  const triggers = [
    '[aria-label="Search"]',
    '[aria-label="search"]',
    'button.search-toggle',
    '[data-action="toggle-search"]',
    'input[type="search"]',
    'input[name="q"]',
    '[placeholder*="Search"]',
    '[placeholder*="search"]',
    '.search-bar__input'
  ];

  console.log(`[${new Date().toISOString()}] [SEARCH] Searching for triggers...`);
  for (const sel of triggers) {
    try {
      console.log(`[${new Date().toISOString()}] [SEARCH] Testing trigger: ${sel}`);
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 500 }).catch(() => false))) {
        continue; 
      }
      console.log(`[${new Date().toISOString()}] [SEARCH] Trigger ${sel} visible, clicking...`);
      await el.click({ timeout: 2000 });
      console.log(`[${new Date().toISOString()}] [SEARCH] Trigger ${sel} clicked successfully!`);
    } catch (err) {
      console.log(`[${new Date().toISOString()}] ⚠️ Search click intercepted on ${sel}, resolving modals...`);
      await handleAllPopups(page);
      console.log(`[${new Date().toISOString()}] [SEARCH] Retrying trigger ${sel}...`);
      try {
        await page.locator(sel).first().click({ timeout: 2000 });
      } catch (innerErr) {
        continue;
      }
    }

    const inputTargets = [
      sel, 
      'input[type="search"]',
      'input[name="q"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      'form[action="/search"] input[type="text"]'
    ];

    for (const target of inputTargets) {
      const box = page.locator(target).first();
      if (await box.isVisible({ timeout: 500 }).catch(() => false)) {
        if (await box.isEditable({ timeout: 500 }).catch(() => false)) {
          await box.fill(product, { timeout: 2000 }).catch(() => {});
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
          return true;
        }
      }
    }
  }
  return false;
}

// Save step results
process.on('exit', () => {
  if (Object.keys(stepResults).length > 0) {
    fs.writeFileSync(
      'step-results.json',
      JSON.stringify(stepResults, null, 2)
    );
  }
});