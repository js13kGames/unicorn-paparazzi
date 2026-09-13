// End-to-end: render an ID pass through the software rasteriser exactly as the
// GPU would, then run the real tally + scorePhoto over it.
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { shot, world, herd } from './scene.mjs';
import { tally } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';
import { COLOR_NAMES } from '../.mirror/unicorn.mjs';

// The real CONFIG, read out of src/index.js the way economy.mjs does. The copy
// that used to live here had drifted until it was missing poseBonus outright,
// which threw the moment a shot was scored -- a tool nobody can run protects
// nothing.
import { readFileSync } from 'fs';
const cfg = (0, eval)('(' + /export const CONFIG = (\{[\s\S]*?\n\});/.exec(
  readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8'))[1] + ')');
const st = { rs: 0 };

// Aim each shot at the nearest unicorn, the way a player would.
import { pathAt } from '../.mirror/terrain.mjs';
const views = [];
for (let d = 40; d < world.route.length && views.length < 6; d += 37) {
  const p = pathAt(world.route, d);
  const a = pathAt(world.route, d), b = pathAt(world.route, d+4);
  const heading = Math.atan2(-(b.x-a.x), -(b.z-a.z));
  let best = null, bd = 1e9;
  for (let u=0;u<herd.n;u++) {
    const dd = Math.hypot(herd.x[u]-p.x, herd.z[u]-p.z);
    if (dd < bd && dd > 6) { bd = dd; best = u; }
  }
  if (!best || bd > 26) continue;
  const yaw = Math.atan2(-(herd.x[best]-p.x), -(herd.z[best]-p.z));
  views.push([d, -0.06, yaw - heading]);
}
const cv = createCanvas(640*2, 360*Math.ceil(views.length/2));
const ctx = cv.getContext('2d');

views.forEach((v, n) => {
  const color = shot(...v, false);
  const ids = shot(...v, true);
  const W = ids.W, H = ids.H;

  // readPixels is bottom-up; our rasteriser is top-down, so flip to match.
  const px = new Uint8Array(W*H*4);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const s0=(H-1-y)*W+x, dst=(y*W+x)*4;
    px[dst]=ids.px[s0*3]; px[dst+1]=ids.px[s0*3+1]; px[dst+3]=ids.parts[s0];
  }
  const scored = scorePhoto({ url:'', w:W, h:H, subjects: tally(px, W, H, herd) }, cfg, st);

  const img = ctx.createImageData(W,H);
  for(let k=0;k<W*H;k++){ img.data[k*4]=color.px[k*3]; img.data[k*4+1]=color.px[k*3+1]; img.data[k*4+2]=color.px[k*3+2]; img.data[k*4+3]=255; }
  ctx.putImageData(img, (n%2)*640, ((n/2)|0)*360);

  const base = scored.subjects.reduce((a, x) => a + x.subtotal, 0);
  console.log('--- shot ' + n + ' -> ' + scored.sum + ' points ' +
    '(base ' + Math.round(base) + ' x' + scored.multiplier + ')');
  for (const s of scored.subjects) {
    console.log('    ' + s.coat.padEnd(14) +
      (s.poseName || 'walking').padEnd(10) +
      (s.extent / cfg.resBonus[st.rs] * 100).toFixed(2).padStart(6) + '% ' +
      'size ' + s.extent.toFixed(1).padStart(5) +
      '  pose ' + String(s.stance).padStart(3) +
      (s.cropLoss > 0.5 ? '  crop -' + s.cropLoss.toFixed(0) : '') +
      (s.envLoss > 0.5 ? '  scenery -' + s.envLoss.toFixed(0) : '') +
      (s.occLoss > 0.5 ? '  herd -' + s.occLoss.toFixed(0) : '') +
      '' );
  }
  console.log('    framing ×' + scored.framing.toFixed(2) +
    (scored.bonuses.length ? '   bonuses: ' + scored.bonuses.map(b=>b.legend+' x'+b.factor).join(', ') : ''));
});
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
