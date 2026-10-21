const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = '/tmp/hopinet-test/core/ui/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8101/index.html?debug';
  const lang = process.argv[3] || 'ar';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, locale: lang === 'ar' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  await page.goto(url);
  await page.waitForTimeout(1800);
  await page.mouse.click(200, 400);
  await page.waitForTimeout(800);
  const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: `${OUT}${lang}-${name}.png` }); };
  const act = (a) => page.evaluate((a) => window.__hopinet.ui.action(a, null), a);
  const closeAll = () => page.evaluate(() => window.__hopinet.ui.closeAllModals());
  await page.evaluate(() => { const PR = window.__hopinetPR; const P = PR.profile(); P.gold = 40000; P.gems = 600; P.batteries = 9; P.houses.harbor = 3; PR.changed(); });
  await shot('lobby');
  for (const [name, a] of [['map', 'open:map'], ['upgrades', 'open:upgrades'], ['shop-gems', 'open:shop:gems'], ['shop-items', 'open:shop:items'], ['vaults', 'open:vaults'], ['daily', 'open:daily'], ['missions', 'open:missions'], ['wheel', 'open:wheel'], ['settings', 'open:settings']]) {
    await act(a); await shot(name); await closeAll();
  }
  await act('sheet:chars'); await shot('chars'); await act('char:view:kiko'); await shot('chars-kiko'); await act('sheet:close');
  await act('sheet:build'); await shot('build'); await act('buildtab:luxury'); await shot('luxury'); await act('luxbuy:lights'); await act('luxbuy:fountain'); await shot('luxury2'); await act('sheet:close');
  // map: select a stage, unlock several, check stage grid
  await page.evaluate(() => { const PR = window.__hopinetPR; const P = PR.profile(); P.stages['harbor-1'] = 3; P.stages['harbor-2'] = 2; PR.changed(); });
  await act('open:map'); await act('map:world:neon'); await shot('map-neon'); await act('map:world:harbor'); await shot('map-harbor'); await closeAll();
  // in-run HUD + revive + results
  await page.evaluate(() => { const PR = window.__hopinetPR; PR.profile().tutorialDone = true; PR.selectStage('harbor-3'); });
  await act('play'); await page.waitForTimeout(1500); await shot('hud-stage');
  await page.evaluate(() => { const g = window.__hopinet.game; g.run.invuln = 0; g.run.gold = 12; g._hit(g.run, { family: 'low', x: g.run.x, d0: g.run.d }); });
  await page.waitForFunction(() => window.__hopinet.ui.hasModal("revive"), null, { timeout: 20000 }); await page.waitForTimeout(500); await shot("revive");
  await page.evaluate(() => window.__hopinet.ui.resolveRevive('skip'));
  await page.waitForTimeout(800); await shot('results');
  await page.evaluate(() => window.__hopinet.ui.action('results:home', null));
  await page.waitForTimeout(600);
  console.log('ERRORS:\n' + errors.filter((e) => !/404|sw\.js/.test(e)).slice(0, 30).join('\n'));
  await browser.close();
})();
