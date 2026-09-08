// The win condition against the real clock: the cart keeps moving after the
// throw, the lure burns out on schedule, and the photo is taken from wherever
// the cart actually is at that moment.
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { shot, world, herd, LURES, settle, cfg } from './scene.mjs';
import { pathAt } from '../.mirror/terrain.mjs';
import { tally } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';

const CART = 8, LIFE = 45;
const scfg = { poseWeights:[.80,.10,.08,.02], resFactor:[720/4320,1080/4320,2160/4320,1],
               minCoverage:0.002, cropK:2.5, envK:2.0, occK:0.9, baitPenalty:200 };

let bestD = 0, bestA = 0, bestN = 0;
for (let d = 0; d < world.path.length; d += 6) {
  const la2 = pathAt(world.path, d + 190), lb2 = pathAt(world.path, d + 194);
  const tx2 = lb2.x-la2.x, tz2 = lb2.z-la2.z, l2 = Math.hypot(tx2,tz2)||1;
  for (let a = 0; a < 2; a++) {
    const sgn = a ? 1 : -1;
    const lx = la2.x + (-tz2/l2)*20*sgn, lz = la2.z + (tx2/l2)*20*sgn;
    const set = new Set();
    for (let u = 0; u < herd.n; u++)
      if (Math.hypot(herd.x[u]-lx, herd.z[u]-lz) < cfg.strongRadius) set.add(herd.color[u]);
    if (set.size > bestN) { bestN = set.size; bestD = d; bestA = 0; }
  }
}
const p0 = pathAt(world.path, bestD), q0 = pathAt(world.path, bestD + 4);
const heading = Math.atan2(-(q0.x-p0.x), -(q0.z-p0.z));
const th = heading + bestA;
// thrown 190 units up the track, 20 to the side -- as the game now does
const LEAD = 190, OFF = 20;
const la = pathAt(world.path, bestD + LEAD), lb = pathAt(world.path, bestD + LEAD + 4);
const ltx = lb.x-la.x, ltz = lb.z-la.z, ll = Math.hypot(ltx,ltz)||1;
const LX = la.x + (-ltz/ll)*OFF, LZ = la.z + (ltx/ll)*OFF;
LURES.push({ x: LX, z: LZ, strong: true, until: 1e9 });
console.log('  throw at lap distance ' + bestD.toFixed(0) + '; ' + bestN + ' colours in reach\n');
console.log('   t   cart moved   dist to lure   near lure   subjects  colours    score   bonuses');

const ZOOM = +(process.env.ZOOM || 1);
console.log('  (zoom ' + ZOOM + 'x)');
const cv = createCanvas(640, 360*3);
const ctx = cv.getContext('2d');
let t = 0, row = 0;
for (const target of (process.env.TIMES||'18,24,30').split(',').map(Number)) {
  settle(Math.round((target - t) * 60)); t = target;
  const d = bestD + CART * t;
  const p = pathAt(world.path, d);
  const dist = Math.hypot(p.x - LX, p.z - LZ);
  // aim at the lure from wherever the cart now is
  const q = pathAt(world.path, d + 4);
  const h2 = Math.atan2(-(q.x-p.x), -(q.z-p.z));
  const yaw = Math.atan2(-(LX-p.x), -(LZ-p.z));
  const colour = shot(d, -0.05, yaw - h2, false, ZOOM);
  const ids = shot(d, -0.05, yaw - h2, true, ZOOM);
  const W = ids.W, H = ids.H;
  const px = new Uint8Array(W*H*4);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const s=((H-1-y)*W+x)*3, o=(y*W+x)*4; px[o]=ids.px[s]; px[o+1]=ids.px[s+1];
  }
  const sc = scorePhoto({ url:'', w:W, h:H, subjects: tally(px, W, H, herd) }, scfg, { res:0 });
  const cols = new Set(sc.subjects.map(s=>s.colourIndex));
  let near = 0;
  for (let u=0;u<herd.n;u++) if (Math.hypot(herd.x[u]-LX, herd.z[u]-LZ) < 12) near++;
  console.log('  ' + String(t).padStart(2) + 's' + (CART*t).toFixed(0).padStart(12) +
    dist.toFixed(0).padStart(15) + String(near).padStart(12) + String(sc.subjects.length).padStart(11) +
    String(cols.size).padStart(9) + String(sc.total).padStart(9) + '   ' +
    (sc.bonuses.map(b=>b.label).join(', ') || '-'));
  const img = ctx.createImageData(W,H);
  for(let k=0;k<W*H;k++){ img.data[k*4]=colour.px[k*3]; img.data[k*4+1]=colour.px[k*3+1]; img.data[k*4+2]=colour.px[k*3+2]; img.data[k*4+3]=255; }
  ctx.putImageData(img, 0, row++*360);
}
console.log('\n  lure burns out at t=' + LIFE + 's');
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
