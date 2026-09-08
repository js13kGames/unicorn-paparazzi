// Average height profile across the track, restricted to places where the track
// crosses open sea. Shows how far the embankment reaches out into the water.
import { buildWorld, pathAt, elevAt, WATER_Y } from '../.mirror/terrain.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35, trackRadiusFrac:.25 };
const w = buildWorld(12345, cfg);
const N = w.N;
const isSea = (gx,gz) => w.elev[Math.min(N-1,Math.max(0,gz))*N + Math.min(N-1,Math.max(0,gx))] < 0;
const sum = {}, cnt = {};
for (let d = 0; d < w.path.length; d += 2) {
  const a = pathAt(w.path,d), b = pathAt(w.path,d+4);
  const tx=b.x-a.x, tz=b.z-a.z, l=Math.hypot(tx,tz)||1, rx=-tz/l, rz=tx/l;
  // only cross-sections where the sea is on both sides well away from the rails
  if (!isSea(Math.round(a.x+rx*9), Math.round(a.z+rz*9))) continue;
  if (!isSea(Math.round(a.x-rx*9), Math.round(a.z-rz*9))) continue;
  for (let u=-10; u<=10; u+=1) {
    const y = elevAt(w, a.x+rx*u, a.z+rz*u);
    sum[u]=(sum[u]||0)+y; cnt[u]=(cnt[u]||0)+1;
  }
}
console.log('  cross-sections sampled: ' + (cnt[0]||0) + '   water line ' + WATER_Y.toFixed(2) + '\n');
console.log('   u   mean height   vs water');
for (let u=-10; u<=10; u++) {
  if (!cnt[u]) continue;
  const m = sum[u]/cnt[u];
  const bar = m > WATER_Y ? '#'.repeat(Math.min(30, Math.round((m-WATER_Y)*6))) : '';
  console.log('  ' + String(u).padStart(3) + m.toFixed(2).padStart(13) + '   ' +
    (m > WATER_Y ? 'ABOVE ' : 'below ') + bar);
}
