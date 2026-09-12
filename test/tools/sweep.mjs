import { buildWorld, pathAt } from '../.mirror/terrain.mjs';
import { spawn } from '../.mirror/unicorn.mjs';
// The real CONFIG, read out of src/index.js rather than copied. Copies here had
// already drifted away from the game they claim to measure.
import { readFileSync } from 'fs';
const CONFIG = (0, eval)('(' + /export const CONFIG = (\{[\s\S]*?\n\});/.exec(
  readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8'))[1] + ')');
const base = CONFIG;
const SEEDS = [12345,777,42,20260907,5,99,1,2,3,404];

function evaluate(drift, radius) {
  let viableSpots = 0, spots = 0, mapsOk = 0, meanCount = 0;
  for (const seed of SEEDS) {
    const cfg = { ...base, driftChance: drift };
    const w = buildWorld(seed, cfg);
    const h = spawn(w, cfg, seed);
    let ok = 0;
    for (let d = 0; d < w.path.length; d += 6) {
      const p = pathAt(w.path, d), q = pathAt(w.path, d + 4);
      const yaw = Math.atan2(-(q.x-p.x), -(q.z-p.z));
      for (let a = 0; a < 6; a++) {
        const th = yaw + (a * Math.PI) / 3;
        const lx = p.x - Math.sin(th) * 16, lz = p.z - Math.cos(th) * 16;
        const set = new Set(); let n = 0;
        for (let u = 0; u < h.n; u++)
          if (Math.hypot(h.x[u]-lx, h.z[u]-lz) < radius) { set.add(h.color[u]); n++; }
        spots++; meanCount += n;
        if (set.size >= 6) { viableSpots++; ok++; }
      }
    }
    if (ok) mapsOk++;
  }
  return { pct: 100*viableSpots/spots, mapsOk, avg: meanCount/spots };
}

console.log('  drift  radius   unicorns in range   spots with all 6   maps winnable');
for (const drift of [0.08, 0.15, 0.25]) {
  for (const radius of [26, 50, 70, 90]) {
    const r = evaluate(drift, radius);
    console.log('  ' + drift.toFixed(2).padStart(5) + String(radius).padStart(8) +
      r.avg.toFixed(1).padStart(20) + (r.pct.toFixed(1)+'%').padStart(19) +
      (r.mapsOk + '/' + SEEDS.length).padStart(16));
  }
}
