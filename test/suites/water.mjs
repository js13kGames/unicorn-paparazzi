// Isolate the CARVE's contribution: build the world, then rebuild the height
// field the same way minus the carve, and compare. Smoothing legitimately lifts
// the shoreline; only the track is on trial here.
import { buildWorld, pathAt, elevAt, HEIGHT, WATER_Y } from '../.mirror/terrain.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35, trackRadiusFrac:.25 };

let fails = 0;
const check = (n, ok, d) => { if(!ok) fails++; console.log((ok?'  ok  ':'FAIL  ')+n.padEnd(56)+(d||'')); };

console.log('  water line y = ' + WATER_Y.toFixed(2) + '\n');
console.log('  seed     open-sea cells above the water line   worst breach');
let totalBad = 0, worstAll = 0;
for (const seed of [12345, 777, 42, 20260907, 5]) {
  const w = buildWorld(seed, cfg);
  const N = w.N;
  const isSea = (gx, gz) => w.elev[gz*N + gx] < 0;
  // "open sea" = the cell and all eight neighbours are sea band, so the
  // shoreline's own smoothing cannot explain a breach here.
  let bad = 0, worst = 0;
  for (let d = 0; d < w.path.length; d += 2) {
    const a = pathAt(w.path, d), b = pathAt(w.path, d + 4);
    const tx = b.x-a.x, tz = b.z-a.z, l = Math.hypot(tx,tz)||1;
    const rx = -tz/l, rz = tx/l;
    for (let u = -12; u <= 12; u += 1) {
      // The roadbed (2.6 either side) may sit proud, and corner averaging in the
      // mesh bleeds its height out by about one cell. Beyond that, open sea must
      // stay open sea.
      if (Math.abs(u) < 4) continue;
      const x = a.x + rx*u, z = a.z + rz*u;
      const gx = Math.min(N-2, Math.max(1, Math.round(x)));
      const gz = Math.min(N-2, Math.max(1, Math.round(z)));
      let open = true;
      for (let dz=-1; dz<=1 && open; dz++) for (let dx=-1; dx<=1; dx++)
        if (!isSea(gx+dx, gz+dz)) { open = false; break; }
      if (!open) continue;
      const y = elevAt(w, x, z);
      if (y > WATER_Y) { bad++; worst = Math.max(worst, y - WATER_Y); }
    }
  }
  totalBad += bad; worstAll = Math.max(worstAll, worst);
  console.log('  ' + String(seed).padStart(8) + String(bad).padStart(35) +
              worst.toFixed(2).padStart(15) + ' units');
}
console.log('');
check('the track never lifts open sea above the water line', totalBad === 0,
      totalBad + ' breaches, worst ' + worstAll.toFixed(2));
console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
