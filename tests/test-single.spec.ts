import { test, Page } from '@playwright/test';

const STORE = {
  url:     'https://neweracap.in',
  product: 'New York Yankees MLB Recycled Midi Black 9FORTY Cap',
};

test('Checkout Debug', async ({ page }) => {

  // Step 1: Seedha product page pe jao
  await page.goto(
    'https://neweracap.in/products/new-york-yankees-mlb-recycled-midi-black-9forty-cap-60771854',
    { waitUntil: 'domcontentloaded' }
  );
  await page.waitForTimeout(2000);
  console.log('✅ Product page opened');

  // Step 2: Add to Cart click karo
  const el = page.locator('button.button.w-full').first();
  if (await el.isVisible({ timeout: 5000 })) {
    await el.scrollIntoViewIfNeeded();
    await el.click();
    console.log('✅ Add to Cart clicked');
  } else {
    console.log('❌ Add to Cart not found');
    return;
  }

  // Step 3: Drawer aane ka wait
  await page.waitForTimeout(3000);
  console.log('Current URL after Add to Cart:', page.url());

  // Step 4: Saare visible buttons + links log karo
  console.log('\n═══ ALL VISIBLE BUTTONS + LINKS ON PAGE ═══');
  const allEls = await page.locator('button, a').all();
  for (const el of allEls) {
    try {
      const isVisible = await el.isVisible();
      if (!isVisible) continue;

      const text      = (await el.textContent() || '').trim();
      const href      = await el.getAttribute('href') || '';
      const className = await el.getAttribute('class') || '';
      const id        = await el.getAttribute('id') || '';
      const name      = await el.getAttribute('name') || '';

      console.log(`
  Text:  "${text}"
  Href:  "${href}"
  Class: "${className}"
  ID:    "${id}"
  Name:  "${name}"
  ─────────────────`);
    } catch {}
  }
  console.log('═══ END ═══\n');

  // Step 5: /cart page pe jao aur wahan bhi dekho
  console.log('\nGoing to /cart page...');
  await page.goto('https://neweracap.in/cart');
  await page.waitForTimeout(2000);

  console.log('\n═══ ALL VISIBLE BUTTONS + LINKS ON CART PAGE ═══');
  const cartEls = await page.locator('button, a').all();
  for (const el of cartEls) {
    try {
      const isVisible = await el.isVisible();
      if (!isVisible) continue;

      const text      = (await el.textContent() || '').trim();
      const href      = await el.getAttribute('href') || '';
      const className = await el.getAttribute('class') || '';
      const id        = await el.getAttribute('id') || '';
      const name      = await el.getAttribute('name') || '';

      console.log(`
  Text:  "${text}"
  Href:  "${href}"
  Class: "${className}"
  ID:    "${id}"
  Name:  "${name}"
  ─────────────────`);
    } catch {}
  }
  console.log('═══ END CART PAGE ═══\n');

});