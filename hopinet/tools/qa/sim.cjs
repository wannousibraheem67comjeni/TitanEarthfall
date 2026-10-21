// Deterministic autoplay bot for Hopinet: steps the engine directly (no rendering needed).
// usage: node sim.cjs <url> <runs> <seconds> [world] [stageId]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8101/index.html?debug';
  const runs = +(process.argv[3] || 3), seconds = +(process.argv[4] || 120);
  const world = process.argv[5] || '', stageId = process.argv[6] || '';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 860 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/sw\.js|404/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.mouse.click(200, 400);
  await page.waitForTimeout(500);
  for (let k = 0; k < runs; k++) {
    const res = await page.evaluate(({ seconds, world, stageId }) => {
      const app = __hopinet, g = app.game, PR = __hopinetPR;
      const P = PR.profile();
      P.tutorialDone = true;
      if (world) { P.unlockedWorlds = ['harbor', 'neon', 'coral', 'jungle', 'frost', 'dunes']; PR.setWorld(world); }
      if (stageId) { P.unlockedWorlds = ['harbor', 'neon', 'coral', 'jungle', 'frost', 'dunes']; for (const s of window.__stagesAll || []) P.stages[s] = 1; PR.selectStage(stageId); } else PR.selectStage(null);
      app.startRun();
      g.pause = () => {};
      const crashes = [], log = [];
      let steps = 0, revives = 0, lastBoss = null;
      const LX = [-2.4, 0, 2.4];
      const LEV = [3.4, 6.4, 9.6];
      const dt = 1 / 60;
      const T = () => g.track;
      const smash = (r) => (r.vehicle ? ({ car: ['low', 'cone', 'high', 'bomb'], boat: ['low', 'cone', 'high'], ship: ['low', 'cone', 'high', 'block', 'mover'], plane: [] }[r.vehicle.kind] || []) : []);
      function nextIn(l, from, to) {
        let best = null;
        for (const o of T().obstacles) if (o.lane === l && o.d1 > from && o.d0 < to && (!best || o.d0 < best.d0)) best = o;
        return best;
      }
      function laneCost(l, r) {
        const look = r.speed * 1.0 + 6;
        const o = nextIn(l, r.d - 0.5, r.d + look);
        let c = 0;
        const sm = smash(r);
        if (o && !sm.includes(o.family)) {
          const ahead = o.d0 - r.d;
          if (o.family === 'block' || o.family === 'mover') c = 100 - ahead;
          else if (o.family === 'truck') c = (o.ramp || r.y >= 2.3) ? 2 : 100 - ahead;
          else if (o.family === 'high' && o.water && r.zone === 'water') c = 3;
          else c = 3;
          if (o.water && (o.kind === 'rock' || o.kind === 'sharkfin') && !r.vehicle) c = o.kind === 'rock' ? 100 - ahead : 6;
        }
        if (l !== r.targetLane) {
          const side = T().obstacles.find((q) => q.lane === l && q.d0 < r.d + 1.2 && q.d1 > r.d - 0.5 && !sm.includes(q.family));
          if (side && !(r.y >= side.y1 - 0.3)) c += 200;
        }
        if (g.boss) { const emp = T().pickups.find((p) => p.type === 'emp' && p.d > r.d && Math.abs(p.x - LX[l]) < 0.1); if (emp) c -= 5; }
        const veh = T().pickups.find((p) => p.vehicle && p.d > r.d && p.d < r.d + 30 && Math.abs(p.x - LX[l]) < 0.1);
        if (veh && !r.vehicle && !r.flying) c -= 6;
        return c;
      }
      function skyCost(l, lv, r) {
        let c = 0;
        for (const o of T().sky) {
          if (o.d1 < r.d - 1 || o.d0 > r.d + r.speed * 1.1 + 8) continue;
          if (o.ring) { if (!o.used && Math.abs(o.x - LX[l]) < 0.1 && Math.abs(o.y - LEV[lv]) < 0.1) c -= 1.5; continue; }
          if (Math.abs(o.x - LX[l]) < o.hw + 1.4 && Math.abs(o.y - LEV[lv]) < o.hh + 1.4) c += 100 - Math.max(0, o.d0 - r.d);
        }
        return c;
      }
      while (steps < seconds * 60) {
        const r = g.run;
        if (r.state === 'won' || r.state === 'over') break;
        if (r.state === 'crashed') {
          const o = T().obstacles.filter((q) => Math.abs(q.d0 - r.d) < 4).map((q) => q.family + (q.water ? 'W' : '') + (q.ramp ? 'R' : '') + '@L' + q.lane + ' d0=' + q.d0.toFixed(1) + ' ' + q.kind).join(',');
          crashes.push({ d: Math.floor(r.d), cause: r.crashCause, zone: r.zone, lane: r.targetLane, x: +r.x.toFixed(2), y: +r.y.toFixed(2), near: o, boss: !!g.boss, veh: r.vehicle && r.vehicle.kind, tile: T().tileType(Math.floor(r.d / 30)), off: +(r.d % 30).toFixed(1) });
          r.revives = 0; g.revive(); revives++;
          if (crashes.length > 40) break;
        }
        if (r.flight === 'plane' && !r.landing) {
          const cl = r.targetLane, cv = r.planeLevel;
          let best = [cl, cv], bc = skyCost(cl, cv, r) - 0.01;
          for (let dl = -1; dl <= 1; dl++) for (let dv = -1; dv <= 1; dv++) {
            const l = cl + dl, v = cv + dv; if (l < 0 || l > 2 || v < 0 || v > 2 || (dl && dv)) continue;
            const c = skyCost(l, v, r) + (dl || dv ? 0.4 : 0);
            if (c < bc) { bc = c; best = [l, v]; }
          }
          if (best[0] !== cl && Math.abs(r.x - LX[cl]) < 0.5) g.input(best[0] > cl ? 'right' : 'left');
          if (best[1] !== cv) g.input(best[1] > cv ? 'up' : 'down');
        } else if (!r.flying) {
          const cur = r.targetLane;
          const costs = [0, 1, 2].map((l) => laneCost(l, r) + Math.abs(l - cur) * 0.5);
          let best = cur;
          for (const l of [cur - 1, cur + 1]) if (l >= 0 && l <= 2 && costs[l] < costs[best] - 1) best = l;
          if (best !== cur && Math.abs(r.x - LX[cur]) < 0.3) g.input(best > cur ? 'right' : 'left');
          const o = nextIn(r.targetLane, r.d - 0.3, r.d + 30);
          const sm = smash(r);
          if (o && !sm.includes(o.family) && Math.abs(r.x - LX[r.targetLane]) < 1.0 && !r.vehicle) {
            const ahead = o.d0 - r.d;
            if ((o.family === 'low' || o.family === 'cone' || o.family === 'bomb' || (o.water && o.kind === 'sharkfin')) && r.grounded && ahead > 0 && ahead < r.speed * 0.3 + 1.2) g.input('up');
            if (o.family === 'high' && !r.underwater && r.slideT <= 0.05 && ahead > -0.2 && ahead < r.speed * 0.2 + 1.0) g.input('down');
          }
          // broken bridge: jump just before the gap edge
          const ti = Math.floor(r.d / 30), off = r.d - ti * 30;
          if (T().tileType(ti) === 'gap' && !(r.vehicle && r.vehicle.kind === 'car') && r.grounded && off > 12 - r.speed * 0.28 && off < 12.6 && r.zone !== 'water') g.input('up');
        }
        g.updateRun(dt, dt);
        if (g.boss && g.boss.state !== lastBoss) { lastBoss = g.boss.state; log.push('boss:' + lastBoss + '@' + Math.floor(r.d) + ' hits=' + g.boss.hits); }
        if (!g.boss) lastBoss = null;
        if (r.vehicle && r.vehicle.kind !== (log._v || '')) { log._v = r.vehicle.kind; log.push('veh:' + r.vehicle.kind + '@' + Math.floor(r.d)); }
        steps++;
      }
      const r = g.run;
      const out = { state: r.state, dist: Math.floor(r.d), gold: r.gold, score: Math.floor(r.score), speed: +r.speed.toFixed(1), crashes: crashes.length, crashList: crashes.slice(0, 10), log: log.slice(0, 24), stats: r.stats };
      g.run.state = 'over';
      app.goLobby();
      return out;
    }, { seconds, world, stageId });
    console.log(JSON.stringify(res));
  }
  console.log('ERRORS:', errors.join('\n') || 'none');
  await browser.close();
})();
