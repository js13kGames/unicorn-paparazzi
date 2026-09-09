import { shot, world, herd, LURES, settle, cfg } from './scene.mjs';
import { pathAt } from '../.mirror/terrain.mjs';
import { tally } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';
const scfg = { poseWeights:[.80,.10,.08,.02], resBonus:[1000,1500,3000,6000],
               minCoverage:0.002, cropK:2.5, envK:2.0, occK:0.9, baitPenalty:200 };
const CART = 8, LEAD = 190, OFF = 20;

let bestD = 0, bestN = 0, bestSgn = 1;
for (let d = 0; d < world.path.length; d += 6) {
  const la = pathAt(world.path, d+LEAD), lb = pathAt(world.path, d+LEAD+4);
  const tx = lb.x-la.x, tz = lb.z-la.z, l = Math.hypot(tx,tz)||1;
  for (const sgn of [-1, 1]) {
    const lx = la.x + (-tz/l)*OFF*sgn, lz = la.z + (tx/l)*OFF*sgn;
    const set = new Set();
    for (let u=0;u<herd.n;u++) if (Math.hypot(herd.x[u]-lx, herd.z[u]-lz) < cfg.strongRadius) set.add(herd.color[u]);
    if (set.size > bestN) { bestN = set.size; bestD = d; bestSgn = sgn; }
  }
}
const la = pathAt(world.path, bestD+LEAD), lb = pathAt(world.path, bestD+LEAD+4);
const tx = lb.x-la.x, tz = lb.z-la.z, ll = Math.hypot(tx,tz)||1;
const LX = la.x + (-tz/ll)*OFF*bestSgn, LZ = la.z + (tx/ll)*OFF*bestSgn;
LURES.push({ x: LX, z: LZ, strong: true, until: 1e9 });
console.log('  lure reaches ' + bestN + ' colours; sweeping shot time x zoom\n');
console.log('    t   dist   1x        2x        4x        8x       (subjects/colours)');

let t = 0, bestShot = null;
for (let target = 16; target <= 40; target += 2) {
  settle(Math.round((target-t)*60)); t = target;
  const d = bestD + CART*t;
  const p = pathAt(world.path, d), q = pathAt(world.path, d+4);
  const h2 = Math.atan2(-(q.x-p.x), -(q.z-p.z));
  const yaw = Math.atan2(-(LX-p.x), -(LZ-p.z));
  let line = '  ' + String(t).padStart(3) + 's' + Math.hypot(p.x-LX,p.z-LZ).toFixed(0).padStart(7);
  for (const z of [1,2,4,8]) {
    const ids = shot(d, -0.05, yaw-h2, true, z);
    const W=ids.W, H=ids.H, px=new Uint8Array(W*H*4);
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const s=((H-1-y)*W+x)*3,o=(y*W+x)*4; px[o]=ids.px[s]; px[o+1]=ids.px[s+1]; }
    const sc = scorePhoto({url:'',w:W,h:H,subjects:tally(px,W,H,herd)}, scfg, {res:0});
    const cols = new Set(sc.subjects.map(s=>s.colourIndex)).size;
    line += (sc.subjects.length + '/' + cols).padStart(10);
    if (!bestShot || cols > bestShot.cols || (cols === bestShot.cols && sc.total > bestShot.total))
      bestShot = { cols, total: sc.total, t, z, n: sc.subjects.length };
  }
  console.log(line);
}
console.log('\n  best: ' + bestShot.cols + ' colours, ' + bestShot.n + ' subjects, ' +
  bestShot.total + ' points  (t=' + bestShot.t + 's, ' + bestShot.z + 'x zoom)');
