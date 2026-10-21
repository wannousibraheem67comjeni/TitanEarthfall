// Injected into the page: autoplay bot + helpers. window.__bot
(function () {
  const LX = [-2.4, 0, 2.4], LEV = [3.4, 6.4, 9.6];
  const smashOf = (r) => (r.vehicle ? ({ car: ['low', 'cone', 'high', 'bomb'], boat: ['low', 'cone', 'high'], ship: ['low', 'cone', 'high', 'block', 'mover'], plane: [] }[r.vehicle.kind] || []) : []);
  function control(g) {
    const r = g.run, T = g.track;
    const nextIn = (l, from, to) => { let best = null; for (const o of T.obstacles) if (o.lane === l && o.d1 > from && o.d0 < to && (!best || o.d0 < best.d0)) best = o; return best; };
    const sm = smashOf(r);
    const laneCost = (l) => {
      const look = r.speed * 1.0 + 6; const o = nextIn(l, r.d - 0.5, r.d + look); let c = 0;
      if (o && !sm.includes(o.family)) {
        const ahead = o.d0 - r.d;
        if (o.family === 'block' || o.family === 'mover') c = 100 - ahead;
        else if (o.family === 'truck') c = (o.ramp || r.y >= 2.3) ? 2 : 100 - ahead;
        else c = 3;
        if (o.water && (o.kind === 'rock' || o.kind === 'sharkfin') && !r.vehicle) c = o.kind === 'rock' ? 100 - ahead : 6;
      }
      if (l !== r.targetLane) { const side = T.obstacles.find((q) => q.lane === l && q.d0 < r.d + 1.2 && q.d1 > r.d - 0.5 && !sm.includes(q.family)); if (side && !(r.y >= side.y1 - 0.3)) c += 200; }
      if (g.boss) { const emp = T.pickups.find((p) => p.type === 'emp' && p.d > r.d && Math.abs(p.x - LX[l]) < 0.1); if (emp) c -= 5; }
      const veh = T.pickups.find((p) => p.vehicle && p.d > r.d && p.d < r.d + 30 && Math.abs(p.x - LX[l]) < 0.1);
      if (veh && !r.vehicle && !r.flying) c -= 6;
      return c;
    };
    const skyCost = (l, lv) => { let c = 0; for (const o of T.sky) { if (o.d1 < r.d - 1 || o.d0 > r.d + r.speed * 1.1 + 8) continue; if (o.ring) { if (!o.used && Math.abs(o.x - LX[l]) < 0.1 && Math.abs(o.y - LEV[lv]) < 0.1) c -= 1.5; continue; } if (Math.abs(o.x - LX[l]) < o.hw + 1.4 && Math.abs(o.y - LEV[lv]) < o.hh + 1.4) c += 100 - Math.max(0, o.d0 - r.d); } return c; };
    if (r.flight === 'plane' && !r.landing) {
      const cl = r.targetLane, cv = r.planeLevel; let best = [cl, cv], bc = skyCost(cl, cv) - 0.01;
      for (let dl = -1; dl <= 1; dl++) for (let dv = -1; dv <= 1; dv++) { const l = cl + dl, v = cv + dv; if (l < 0 || l > 2 || v < 0 || v > 2 || (dl && dv)) continue; const c = skyCost(l, v) + (dl || dv ? 0.4 : 0); if (c < bc) { bc = c; best = [l, v]; } }
      if (best[0] !== cl && Math.abs(r.x - LX[cl]) < 0.5) g.input(best[0] > cl ? 'right' : 'left');
      if (best[1] !== cv) g.input(best[1] > cv ? 'up' : 'down');
    } else if (!r.flying) {
      const cur = r.targetLane; const costs = [0, 1, 2].map((l) => laneCost(l) + Math.abs(l - cur) * 0.5); let best = cur;
      for (const l of [cur - 1, cur + 1]) if (l >= 0 && l <= 2 && costs[l] < costs[best] - 1) best = l;
      if (best !== cur && Math.abs(r.x - LX[cur]) < 0.3) g.input(best > cur ? 'right' : 'left');
      const o = nextIn(r.targetLane, r.d - 0.3, r.d + 30);
      if (o && !sm.includes(o.family) && Math.abs(r.x - LX[r.targetLane]) < 1.0 && !r.vehicle) {
        const ahead = o.d0 - r.d;
        if ((o.family === 'low' || o.family === 'cone' || o.family === 'bomb' || (o.water && o.kind === 'sharkfin')) && r.grounded && ahead > 0 && ahead < r.speed * 0.3 + 1.2) g.input('up');
        if (o.family === 'high' && !r.underwater && r.slideT <= 0.05 && ahead > -0.2 && ahead < r.speed * 0.2 + 1.0) g.input('down');
      }
      const ti = Math.floor(r.d / 30), off = r.d - ti * 30;
      if (T.tileType(ti) === 'gap' && !(r.vehicle && r.vehicle.kind === 'car') && r.grounded && off > 12 - r.speed * 0.28 && off < 12.6 && r.zone !== 'water') g.input('up');
    }
  }
  const PRED = {
    water: (g) => g.run.zone === 'water' && !g.run.vehicle && !g.run.flying && g.run.grounded,
    dive: (g) => g.run.underwater,
    plane: (g) => g.run.flight === 'plane' && !g.run.landing && g.run.d > 0,
    boat: (g) => g.run.vehicle && g.run.vehicle.kind === 'boat',
    ship: (g) => g.run.vehicle && g.run.vehicle.kind === 'ship',
    car: (g) => g.run.vehicle && g.run.vehicle.kind === 'car',
    jet: (g) => g.run.flight === 'jet',
    boss: (g) => g.boss && g.boss.state === 'fight',
    air: (g) => !g.run.grounded && !g.run.flying && g.run.y > 1.2,
    gap: (g) => { const r = g.run; const ti = Math.floor(r.d / 30); return g.track.tileType(ti) === 'gap' && r.d - ti * 30 > 5 && r.d - ti * 30 < 11; },
    helmet: (g) => g.run.pu.shield > 0,
    magnet: (g) => g.run.pu.magnet > 0,
    bombmag: (g) => g.run.pu.bombmag > 0,
    win: (g) => g.run.state === 'won',
  };
  window.__bot = {
    g: () => window.__hopinet.game,
    start(o) {
      const app = window.__hopinet, PR = window.__hopinetPR, P = PR.profile();
      P.tutorialDone = true; P.unlockedWorlds = ['harbor', 'neon', 'coral', 'jungle', 'frost', 'dunes'];
      if (o && o.world) PR.setWorld(o.world);
      PR.selectStage(o && o.stage ? o.stage : null);
      app.startRun();
      const g = app.game; g.pause = () => {};
      g.run.state = 'running'; g.run.introT = 0;
      return true;
    },
    step(n) { const g = this.g(); const dt = 1 / 60; let s = 0; for (; s < n; s++) { if (g.run.state === 'crashed') { g.run.revives = 0; g.revive(); } control(g); g.updateRun(dt, dt); if (g.run.state === 'won' || g.run.state === 'over') break; } return { d: Math.floor(g.run.d), state: g.run.state }; },
    until(name, max) { const g = this.g(); const dt = 1 / 60; const f = PRED[name]; let s = 0; for (; s < max; s++) { if (g.run.state === 'crashed') { g.run.revives = 0; g.revive(); } control(g); g.updateRun(dt, dt); if (f(g)) return { ok: true, steps: s, d: Math.floor(g.run.d), zone: g.run.zone }; if (g.run.state === 'over') break; } return { ok: false, steps: s, d: Math.floor(g.run.d) }; },
    hold(name) { return !!PRED[name](this.g()); },
  };
})();
