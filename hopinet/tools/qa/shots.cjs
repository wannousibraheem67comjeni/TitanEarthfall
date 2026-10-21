const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const OUT = '/tmp/hopinet-test/shots/';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8102/index.html?debug';
  const worlds = (process.argv[3] || 'harbor,neon,coral,jungle,frost,dunes').split(',');
  const what = (process.argv[4] || 'lobby,run,water,gap,plane,boss,back').split(',');
  const bot = fs.readFileSync('/tmp/hopinet-test/core/bot.js', 'utf8');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, locale: 'ar' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/sw\.js|404|GPU stall|swiftshader/i.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.mouse.click(200, 400);
  await page.waitForTimeout(800);
  await page.evaluate(bot);
  const snap = async (n) => { await page.waitForTimeout(350); await page.screenshot({ path: OUT + n + '.png' }); };
  for (const w of worlds) {
    if (what.includes('lobby')) {
      await page.evaluate((w) => { const PR = window.__hopinetPR, P = PR.profile(); P.unlockedWorlds = ['harbor', 'neon', 'coral', 'jungle', 'frost', 'dunes']; P.houses[w] = 5; P.homeItems[w] = ['lights', 'garden', 'fountain', 'pool', 'gazebo', 'solar', 'supercar', 'helipad', 'yacht', 'statue']; PR.setWorld(w); window.__hopinet.syncLobby(); }, w);
      await snap(w + '-lobby');
    }
    const need = ['run', 'water', 'gap', 'plane', 'boss', 'back'].some((x) => what.includes(x));
    if (!need) continue;
    await page.evaluate((w) => { window.__bot.start({ world: w }); window.__bot.step(120); }, w);
    if (what.includes('run')) await snap(w + '-run');
    if (what.includes('water')) { const r = await page.evaluate(() => window.__bot.until('water', 20000)); if (r.ok) { await page.evaluate(() => window.__bot.step(40)); await snap(w + '-water'); } else console.log(w, 'no water', JSON.stringify(r)); }
    if (what.includes('gap')) { const r = await page.evaluate(() => window.__bot.until('gap', 20000)); if (r.ok) await snap(w + '-gap'); else console.log(w, 'no gap', JSON.stringify(r)); }
    if (what.includes('plane')) { const r = await page.evaluate(() => window.__bot.until('plane', 30000)); if (r.ok) { await page.evaluate(() => window.__bot.step(90)); await snap(w + '-plane'); } else console.log(w, 'no plane', JSON.stringify(r)); }
    if (what.includes('back')) {
      await page.evaluate(() => { const g = window.__hopinet.game; g.__camSave = g._updateCamera; g._updateCamera = function () { const r = this.run; this.camera.position.set(r.x, r.y + 3.2, -r.d + 8); this.camera.lookAt(r.x, r.y + 2.2, -r.d + 60); }; });
      await page.evaluate(() => window.__bot.step(2)); await snap(w + '-back');
      await page.evaluate(() => { const g = window.__hopinet.game; g._updateCamera = g.__camSave; });
    }
    if (what.includes('boss')) { const r = await page.evaluate(() => { const g = window.__hopinet.game; g.run.bossNext = g.run.d + 5; return window.__bot.until('boss', 20000); }); if (r.ok) { await page.evaluate(() => window.__bot.step(60)); await snap(w + '-boss'); } else console.log(w, 'no boss', JSON.stringify(r)); }
    await page.evaluate(() => { window.__hopinet.game.run.state = 'over'; window.__hopinet.goLobby(); });
  }
  console.log('ERRORS:\n' + (errors.slice(0, 20).join('\n') || 'none'));
  await browser.close();
})();
