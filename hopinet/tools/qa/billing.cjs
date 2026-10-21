const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = process.argv[2] || 'http://127.0.0.1:8101/index.html?debug';
const OUT = '/tmp/hopinet-test/core/ui/';
async function boot(browser, mock) {
  for (const c of browser.contexts()) await c.close();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, locale: 'ar' });
  if (mock) await ctx.addInitScript(mock);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(1000); await page.mouse.click(200, 400); await page.waitForTimeout(400);
  return { page, errors };
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const res = {};
  // A) Browser: no Google Play -> nothing purchasable, nothing granted.
  {
    const { page, errors } = await boot(browser, null);
    await page.evaluate(() => __hopinet.ui.action('open:shop:gems', null)); await page.waitForTimeout(1200);
    res.web = await page.evaluate(() => {
      const P = __hopinetPR.profile(), g0 = P.gems;
      const enabledBuy = document.querySelectorAll('[data-a^="buy:"]').length;
      __hopinet.ui.action('buy:gems_80', null);
      return { status: document.querySelector('.store-status')?.className, enabledBuyButtons: enabledBuy, gemsAfterTap: P.gems - g0 };
    });
    res.webErrors = errors;
  }
  const mockBase = (products, flavor = 'play') => `
    window.__calls = [];
    window.HopinetNative = {
      platform: () => 'android', flavor: () => '${flavor}', loadData: () => '', saveData: () => true, getInsets: () => '{"top":0,"bottom":0}',
      billingInit: (j) => { window.__calls.push('billingInit'); const ids = JSON.parse(j); setTimeout(() => {
        window.__hopinetBilling.onReady(true);
        const P = ${JSON.stringify(products)};
        for (const type of ['inapp','subs']) {
          const want = ids[type];
          const found = want.filter((id) => P[id]).map((id) => ({ productId: id, price: P[id], type, period: type === 'subs' ? 'P1M' : undefined }));
          const missing = want.filter((id) => !P[id]).map((id) => ({ productId: id, status: 3 }));
          window.__hopinetBilling.onProducts(JSON.stringify({ type, ok: true, error: '', products: found, missing }));
        }
      }, 50); },
      refreshProducts: () => window.__calls.push('refresh'),
      purchase: (id) => window.__calls.push('purchase:' + id),
      finishPurchase: (tok, consume) => window.__calls.push('finish:' + tok + ':' + consume),
      restorePurchases: () => window.__calls.push('restore'), vibrate: () => {}, openStorePage: () => {}, appReady: () => {},
    };`;
  // B) Android play edition, Google Play knows no products
  {
    const { page, errors } = await boot(browser, mockBase({}));
    await page.evaluate(() => __hopinet.ui.action('open:shop:gems', null)); await page.waitForTimeout(1200);
    res.playNoProducts = await page.evaluate(() => {
      const P = __hopinetPR.profile(), g0 = P.gems;
      const enabled = document.querySelectorAll('[data-a^="buy:"]').length;
      __hopinet.ui.action('buy:gems_80', null);
      return { status: document.querySelector('.store-status')?.innerText.slice(0, 90), enabledBuyButtons: enabled, gemsAfterTap: P.gems - g0, nativeCalls: window.__calls };
    });
    res.playNoProductsErrors = errors;
  }
  // C) some products
  {
    const { page, errors } = await boot(browser, mockBase({ gems_80: 'US$0.99', gems_450: '19,00 SAR', hopinet_club: 'US$3.99', starter_pack: 'US$2.99', gold_doubler: 'US$5.99' }));
    await page.evaluate(() => __hopinet.ui.action('open:shop:gems', null)); await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT + 'bill-some.png' });
    res.playSome = await page.evaluate(async () => {
      const P = __hopinetPR.profile(), g0 = P.gems;
      const buttons = [...document.querySelectorAll('[data-a^="buy:"]')].map((b) => b.dataset.a + '=' + b.textContent.trim());
      __hopinet.ui.action('buy:gems_80', null);
      const afterTap = P.gems - g0;
      const B = window.__hopinetBilling;
      B.onPurchase(JSON.stringify({ productId: 'gems_80', purchaseToken: 'tok1', state: 'purchased', quantity: 1, acknowledged: false, type: 'inapp', fresh: true }));
      B.onPurchase(JSON.stringify({ productId: 'gems_80', purchaseToken: 'tok1', state: 'purchased', quantity: 1, acknowledged: false, type: 'inapp', fresh: false }));
      B.onPurchase(JSON.stringify({ productId: 'gems_450', purchaseToken: 'tok2', state: 'pending', quantity: 1, acknowledged: false, type: 'inapp', fresh: true }));
      B.onPurchase(JSON.stringify({ productId: 'gold_doubler', purchaseToken: 'tok3', state: 'purchased', quantity: 1, acknowledged: false, type: 'inapp', fresh: true }));
      B.onPurchase(JSON.stringify({ productId: 'hopinet_club', purchaseToken: 'tok4', state: 'purchased', quantity: 1, acknowledged: false, type: 'subs', fresh: true }));
      await new Promise((r) => setTimeout(r, 100));
      return { buttons, gemsAfterTapOnly: afterTap, gemsAfterGooglePurchase: P.gems - g0, doubler: P.iap.doubler, club: __hopinetPR.clubActive(), nativeCalls: window.__calls };
    });
    res.playSomeErrors = errors;
  }
  // D) free edition: no store, no billingInit, nothing can be bought or granted
  {
    const { page, errors } = await boot(browser, mockBase({ gems_80: 'US$0.99' }, 'free'));
    await page.evaluate(() => __hopinet.ui.action('open:shop:gems', null)); await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT + 'bill-free.png' });
    res.free = await page.evaluate(() => {
      const P = __hopinetPR.profile(), g0 = P.gems;
      __hopinet.ui.action('buy:gems_80', null);
      try { window.__hopinetBilling.onPurchase(JSON.stringify({ productId: 'gems_80', purchaseToken: 'tokF', state: 'purchased', quantity: 1, acknowledged: false, type: 'inapp', fresh: true })); } catch (e) {}
      return { tabs: [...document.querySelectorAll('.tabs button')].length, buyButtons: document.querySelectorAll('[data-a^="buy:"]').length, billingInitCalled: window.__calls.includes('billingInit'), gemsGained: P.gems - g0, lobbyOffers: !!document.querySelector('#lobby [data-a="open:shop:offers"]') };
    });
    res.freeErrors = errors;
  }
  // E) hooks absent without ?debug
  {
    for (const c of browser.contexts()) await c.close();
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
    const page = await ctx.newPage();
    await page.goto(URL.replace('?debug', '')); await page.waitForTimeout(800);
    res.hooksWithoutDebug = await page.evaluate(() => ({ app: typeof window.__hopinet, pr: typeof window.__hopinetPR }));
  }
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})();
