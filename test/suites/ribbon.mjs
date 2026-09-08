// Dense check: sample the ribbon SURFACE (not just its vertices) against the
// terrain underneath, at 8x resolution along the path and across the width.
import { buildWorld, elevAt } from '../.mirror/terrain.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35, trackRadiusFrac:.25 };
const P = 1024, HALF = 1.5;
let fails = 0;
for (const seed of [12345,777,42,20260907,5,99,1,2,3,404,88888,20260101]) {
  const w = buildWorld(seed, cfg);
  const tm = w.trackMesh;
  // centre-band vertices carry the bed height per cross-section
  const bedBand = 2;
  const yOf = i => tm.pos[((bedBand*P + i)*2)*3 + 1];
  let worst = -1e9, bad = 0, total = 0;
  for (let i = 0; i < P; i++) {
    const j = (i+1)%P;
    for (let a = 0; a < 8; a++) {
      const t = a/8;
      const ry = yOf(i) + (yOf(j)-yOf(i))*t;
      for (let k = 0; k <= 12; k++) {
        const u = -HALF + 2*HALF*k/12;
        // interpolate the ribbon centreline position
        const vL = ((bedBand*P + i)*2)*3, vR = ((bedBand*P + j)*2)*3;
        const cx = tm.pos[vL] + (tm.pos[vR]-tm.pos[vL])*t;
        const cz = tm.pos[vL+2] + (tm.pos[vR+2]-tm.pos[vL+2])*t;
        // approximate cross direction from the band's own two edge verts
        const eL = ((bedBand*P + i)*2)*3, eR = ((bedBand*P + i)*2+1)*3;
        let dx = tm.pos[eR]-tm.pos[eL], dz = tm.pos[eR+2]-tm.pos[eL+2];
        const dl = Math.hypot(dx,dz)||1; dx/=dl; dz/=dl;
        const g = elevAt(w, cx + dx*u, cz + dz*u);
        total++;
        if (g - ry > worst) worst = g - ry;
        if (g > ry) bad++;
      }
    }
  }
  console.log('seed', String(seed).padStart(9), 'worst terrain-above-bed',
    worst.toFixed(3).padStart(7), 'units;', bad, '/', total, 'surface samples pierced');
  if (bad) fails++;
}
console.log(fails ? '\n' + fails + ' seed(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
