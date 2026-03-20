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
        await page.waitForTimeout(2000);
        await handleAllPopups(page);
        steps.push({ step: 'Open Store', status: 'pass' });
        console.log('✅ Step 1: Store opened');
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
          await page.waitForTimeout(2000);
        }
        await handleAllPopups(page);
        steps.push({ step: 'Search Product', status: 'pass' });
        console.log(`✅ Step 2: Searched "${store.product}"`);
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
      ];

      let productOpened = false;
      for (const sel of productSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 4000 });
          const elements = await page.locator(sel).all();

          for (const el of elements) {
            const text      = (await el.textContent() || '').toLowerCase().trim();
            const ariaLabel = (await el.getAttribute('aria-label') || '').toLowerCase();
            const className = (await el.getAttribute('class') || '').toLowerCase();
            const href      = (await el.getAttribute('href') || '').toLowerCase();

            const isWishlist =
              text.includes('wishlist')      || text.includes('wish list') ||
              text.includes('compare')       || text.includes('favorite')  ||
              text.includes('heart')         ||
              ariaLabel.includes('wishlist') || ariaLabel.includes('save') ||
              ariaLabel.includes('favorite') ||
              className.includes('wishlist') || className.includes('wish') ||
              className.includes('hulk')     || className.includes('favorite');

            if (isWishlist) continue;
            if (href && !href.includes('/products/')) continue;
            if (!await el.isVisible()) continue;

            await el.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await el.click();
            productOpened = true;
            console.log(`✅ Product clicked: "${text || href}"`);
            break;
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

      await page.waitForTimeout(2000);
      await handleAllPopups(page);
      console.log('✅ Step 3: Product page opened');

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
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 4000 })) {
            await el.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await el.click();
            addedToCart = true;
            console.log(`✅ Add to Cart clicked: ${sel}`);
            break;
          }
        } catch {}
      }

      if (!addedToCart) {
        steps.push({ step: 'Add to Cart', status: 'fail',
          error: 'Add to Cart button not found' });
        expect(false, 'Add to Cart failed').toBe(true);
      } else {
        steps.push({ step: 'Add to Cart', status: 'pass' });
        console.log('✅ Step 4: Added to cart');
      }

      console.log('Waiting for cart drawer...');
      await page.waitForTimeout(3000);

      // ── Step 5: Cart Drawer OR Cart Page Checkout ────
      const checkedOut = await handleCartDrawerCheckout(page, storeUrl);

      if (!checkedOut) {
        steps.push({ step: 'Checkout', status: 'fail',
          error: 'Checkout button not found in drawer or cart page' });
        expect(false, 'Checkout failed').toBe(true);
      } else {
        steps.push({ step: 'Cart / Checkout', status: 'pass' });
        console.log('✅ Step 5: Checkout clicked successfully');
      }

      // ── Step 6: Verify checkout URL ──────────────────
      try {
        let checkoutType = '';
        try {
          // URLs ke change hone ka wait kar raha hai
          await page.waitForURL(/checkout|checkouts|razorpay|simpl|gokwik|cashfree|paytm|secure/, { timeout: 15000 });
          checkoutType = 'page';
        } catch {
          // Agar URL change nahi hui, toh zaroor koi modal/popup khula hoga (jaise Razorpay, Simpl waghera)
          await page.waitForSelector(
            '.razorpay-checkout-frame, iframe[src*="razorpay"], iframe[src*="checkout"], #simpl-checkout', 
            { state: 'visible', timeout: 5000 }
          );
          checkoutType = 'popup';
        }
        steps.push({ step: 'Verify Checkout', status: 'pass' });
        console.log(`✅ Step 6: Checkout ${checkoutType} fully loaded`);
        console.log('✅ TEST PASSED!');
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

    // ── Method 1: JS se drawer scan karo ────────────
    console.log('Scanning drawer for checkout via JS...');
    try {
      const clicked = await page.evaluate((sel) => {
        const drawer =
          document.querySelector(sel) ||
          document.querySelector('.cart-drawer') ||
          document.querySelector('[class*="cart-drawer"]');

        if (!drawer) return null;

        const elements = Array.from(drawer.querySelectorAll('a, button, magic-checkout-btn, .magic-checkout-btn, .rzp-checkout-btn'));
        for (const el of elements) {
          if ((el as HTMLElement).offsetParent === null) continue; // Skip display: none (like native buttons hidden by Razorpay)

          const href = (el as HTMLAnchorElement).href || '';
          const text = el.textContent?.trim().toLowerCase() || '';

          if (
            el.tagName.toLowerCase().includes('magic-checkout') ||
            el.className.includes('magic-checkout') ||
            href.includes('/checkout') ||
            href.includes('checkouts')  ||
            text.includes('checkout')   ||
            text.includes('check out')
          ) {
            (el as HTMLElement).click();
            return `${href} | ${text} | ${el.tagName}`;
          }
        }
        return null;
      }, drawerSelector);

      if (clicked) {
        console.log(`✅ JS checkout clicked: "${clicked}"`);
        await page.waitForTimeout(3000);
        return true;
      }
    } catch (e) {
      console.log('JS scan failed:', e);
    }

    // ── Method 2: Playwright selectors ──────────────
    const drawerCheckoutSelectors = [
      'magic-checkout-btn',
      '.magic-checkout-btn',
      '.rzp-checkout-btn',
      'a[href="/checkout"]',
      'a[href*="/checkout"]',
      'a[href*="checkouts"]',
      '[name="checkout"]',
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
    ];

    for (const sel of drawerCheckoutSelectors) {
      try {
        const el = page.locator(sel).first();
        const count = await el.count();
        if (count === 0) continue;

        const isVisible = await el.isVisible().catch(() => false);
        if (!isVisible) continue;

        const href = await el.getAttribute('href', { timeout: 1000 }).catch(() => '') || '';
        const text = (await el.textContent() || '').trim();

        if (href &&
            !href.includes('checkout') &&
            !text.toLowerCase().includes('checkout') &&
            !text.toLowerCase().includes('check out')) {
          continue;
        }

        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        await el.click();
        console.log(`✅ Drawer checkout clicked: "${text || href}"`);
        return true;
      } catch {}
    }

    // ── Method 3: Force click ────────────────────────
    console.log('Trying force clicks...');
    for (const sel of ['a[href*="checkout"]', '[name="checkout"]']) {
      try {
        await page.click(sel, { force: true, timeout: 3000 });
        console.log(`✅ Force click: ${sel}`);
        return true;
      } catch {}
    }

    // ── Debug: Saare checkout elements log karo ──────
    console.log('\n=== DEBUG: CHECKOUT ELEMENTS ON PAGE ===');
    try {
      const allCheckout = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a, button'))
          .filter(el => {
            const href = (el as HTMLAnchorElement).href || '';
            const text = el.textContent?.trim().toLowerCase() || '';
            return href.includes('checkout') ||
                   text.includes('checkout') ||
                   text.includes('check out');
          })
          .map(el => ({
            tag:     el.tagName,
            text:    el.textContent?.trim().substring(0, 50),
            href:    (el as HTMLAnchorElement).href,
            class:   el.className,
            id:      el.id,
            visible: (el as HTMLElement).offsetParent !== null,
          }));
      });
      console.log(JSON.stringify(allCheckout, null, 2));
    } catch {}
    console.log('=== END DEBUG ===\n');
  }

  // ── Agar drawer me click nahi hua, toh screen pe jo bhi visible hai (Popup/Page) wahan dhundo ───────────
  console.log('Checking current screen (Popup/Cart Page) for checkout buttons...');
  
  await handleAllPopups(page);

  const cartCheckoutSelectors = [
    'magic-checkout-btn',
    '.magic-checkout-btn',
    '.rzp-checkout-btn',
    'a[href="/checkout"]',
    'a[href*="/checkout"]',
    'button:has-text("Check out")',
    'button:has-text("Checkout")',
    'button:has-text("CHECKOUT")',
    '[name="checkout"]',
    '.cart__checkout',
  ];

  for (const sel of cartCheckoutSelectors) {
    try {
      const el = page.locator(sel).first();
      const count = await el.count();
      if (count === 0) continue;
      
      const isVisible = await el.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        await el.scrollIntoViewIfNeeded();
        await el.click();
        console.log(`✅ Cart checkout clicked: ${sel}`);
        return true;
      }
    } catch {}
  }

  return false;
}

// ══════════════════════════════════════════════════
//  POPUP HANDLER
// ══════════════════════════════════════════════════
async function handleAllPopups(page: Page) {

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

  for (const sel of cookieSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(500);
        break;
      }
    } catch {}
  }

  const discountSelectors = [
    'button:has-text("No thanks")',
    'button:has-text("No, thanks")',
    'button:has-text("Skip")',
    'button:has-text("Maybe later")',
    'button:has-text("Close")',
    'button:has-text("Dismiss")',
    'button:has-text("Continue without discount")',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '[data-popup-close]',
    '[data-modal-close]',
    '.popup-close',
    '.modal-close',
    'button:has-text("×")',
    'button:has-text("✕")',
    '.klaviyo-close-form',
    '.privy-dismiss-button',
  ];

  for (const sel of discountSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(500);
        break;
      }
    } catch {}
  }

  const ageSelectors = [
    'button:has-text("Yes, I am")',
    'button:has-text("I am over 18")',
    'button:has-text("Enter")',
    '.age-verify-yes',
  ];

  for (const sel of ageSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(500);
        break;
      }
    } catch {}
  }

  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch {}
}

// ══════════════════════════════════════════════════
//  SEARCH HELPER
// ══════════════════════════════════════════════════
async function trySearch(page: Page, product: string): Promise<boolean> {
  const triggers = [
    '[aria-label="Search"]',
    'button.search-toggle',
    '[data-action="toggle-search"]',
    'input[type="search"]',
    '[placeholder*="Search"]',
    '[placeholder*="search"]',
  ];

  for (const sel of triggers) {
    try {
      await page.click(sel, { timeout: 3000 });
      await page.fill('input[type="search"]', product);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      return true;
    } catch {}
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