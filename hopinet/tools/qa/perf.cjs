const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8102/index.html?debug';
  const bot = fs.readFileSync('/tmp/hopinet-test/core/bot.js', 'utf8');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 860 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(2500); await page.mouse.click(200, 400); await page.waitForTimeout(500);
  await page.evaluate(bot);
  const out = {};
  for (const q of ['high', 'low']) {
    await page.evaluate((q) => window.__hopinet.setQuality(q), q);
    for (const w of ['harbor', 'neon', 'coral', 'jungle', 'frost', 'dunes']) {
      const r = await page.evaluate(async (w) => {
        const g = window.__hopinet.game, PR = window.__hopinetPR; const P = PR.profile();
        P.houses[w] = 5; P.homeItems[w] = ['lights', 'garden', 'fountain', 'pool', 'gazebo', 'solar', 'supercar', 'helipad', 'yacht', 'statue']; P.unlockedWorlds = ['harbor', 'neon', 'coral', 'jungle', 'frost', 'dunes']; PR.setWorld(w);
        const t0 = performance.now(); window.__hopinet.syncLobby(); const lobbyBuild = performance.now() - t0;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const lobby = { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
        const t1 = performance.now(); window.__bot.start({ world: w }); const runBuild = performance.now() - t1;
        let maxCalls = 0, maxTris = 0, hitch = 0;
        for (let i = 0; i < 10; i++) {
          const a = performance.now(); window.__bot.step(90); const b = performance.now(); hitch = Math.max(hitch, (b - a) / 90);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          maxCalls = Math.max(maxCalls, g.renderer.info.render.calls); maxTris = Math.max(maxTris, g.renderer.info.render.triangles);
        }
        const mem = { geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures };
        window.__hopinet.game.run.state = 'over'; window.__hopinet.goLobby();
        return { lobbyBuildMs: Math.round(lobbyBuild), lobby, runBuildMs: Math.round(runBuild), runCalls: maxCalls, runTris: maxTris, stepMs: +hitch.toFixed(2), mem };
      }, w);
      out[q + ':' + w] = r;
    }
  }
  console.log(JSON.stringify(out, null, 0).replace(/},"/g, '},\n"'));
  console.log('errors', errors.join('|') || 'none');
  await browser.close();
})();
