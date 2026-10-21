const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = '/tmp/hopinet-test/core/veh/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8101/index.html?debug';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 860 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/sw\.js|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.mouse.click(200, 400);
  await page.waitForTimeout(500);
  await page.evaluate(() => { const PR = window.__hopinetPR; PR.profile().tutorialDone = true; PR.selectStage(null); window.__hopinet.startRun(); const g = window.__hopinet.game; g.run.state = 'running'; g.track.spawnPaused = true; });
  for (const kind of ['car', 'boat', 'ship', 'plane']) {
    await page.evaluate((kind) => {
      const g = window.__hopinet.game;
      if (g.run.vehicle) g._dismount('time');
      g.run.invuln = 99;
      g._mount(kind);
    }, kind);
    // let the game run some frames
    for (let i = 0; i < 30; i++) await page.evaluate(() => { const g = window.__hopinet.game; g.updateRun(1 / 30, 1 / 30); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + kind + '.png' });
  }
  console.log('ERRORS:', errors.join('\n') || 'none');
  await browser.close();
})();
