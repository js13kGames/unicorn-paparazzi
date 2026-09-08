// Can a player ever get all six colours into one frame? That is the win
// condition, so if the answer is no the game has no ending.
import { buildWorld, pathAt } from '../.mirror/terrain.mjs';
import { spawn, updateHerd } from '../.mirror/unicorn.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35,
              trackRadiusFrac:.25, unicornDensity:.003, adultChance:.75, driftChance:.08,
              poseWeights:[.80,.10,.08,.02], weakRadius:26, strongRadius:70, lureLife:22, lurePull:0.7, lureSpeed:4, lureGather:5 };

console.log('  distinct colours reachable by a STRONG lure thrown from the track');
console.log('  (16 units ahead of the cart, gathering everything within ' + cfg.strongRadius + ')\n');
console.log('  seed     best  spots with 6   spots with 5   spots with 4');
let winnable = 0, total = 0;
for (const seed of [12345,777,42,20260907,5,99,1,2,3,404]) {
  const w = buildWorld(seed, cfg);
  const h = spawn(w, cfg, seed);
  for (let i=0;i<600;i++) updateHerd(h, w, cfg, 1/60, []);
  let best = 0, c6 = 0, c5 = 0, c4 = 0;
  for (let d = 0; d < w.path.length; d += 3) {
    const p = pathAt(w.path, d), q = pathAt(w.path, d + 4);
    const yaw = Math.atan2(-(q.x-p.x), -(q.z-p.z));
    // the lure lands where the player is looking; sweep the whole horizon
    for (let a = 0; a < 8; a++) {
      const th = yaw + (a * Math.PI) / 4;
      const lx = p.x - Math.sin(th) * 16, lz = p.z - Math.cos(th) * 16;
      const set = new Set();
      for (let u = 0; u < h.n; u++) {
        if (Math.hypot(h.x[u]-lx, h.z[u]-lz) < cfg.strongRadius) set.add(h.color[u]);
      }
      if (set.size > best) best = set.size;
      if (set.size >= 6) c6++;
      if (set.size >= 5) c5++;
      if (set.size >= 4) c4++;
    }
  }
  total++;
  if (c6) winnable++;
  console.log('  ' + String(seed).padStart(8) + String(best).padStart(6) +
    String(c6).padStart(15) + String(c5).padStart(15) + String(c4).padStart(15));
}
console.log('\n  ' + winnable + ' of ' + total + ' maps have at least one spot where a rainbow');
console.log('  lure could gather all six colours.');
