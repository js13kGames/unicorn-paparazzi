// End-to-end: render an ID pass through the software rasteriser exactly as the
// GPU would, then run the real tally + scorePhoto over it.
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { shot, world, herd } from './scene.mjs';
import { tally } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';
import { COLOR_NAMES } from '../.mirror/unicorn.mjs';

const cfg = { poseWeights:[.80,.10,.08,.02], resBonus:[1000,1500,3000,6000], minCoverage:0.002, resNames:['low','med','high','ultra'], cropK:2.5, envK:2.0, occK:0.9 };
const st = { res: 0 };

// Aim each shot at the nearest unicorn, the way a player would.
import { pathAt } from '../.mirror/terrain.mjs';
const views = [];
for (let d = 40; d < world.path.length && views.length < 6; d += 37) {
  const p = pathAt(world.path, d);
  const a = pathAt(world.path, d), b = pathAt(world.path, d+4);
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
    const src=((H-1-y)*W+x)*3, dst=(y*W+x)*4;
    px[dst]=ids.px[src]; px[dst+1]=ids.px[src+1];
  }
  const scored = scorePhoto({ url:'', w:W, h:H, subjects: tally(px, W, H, herd) }, cfg, st);

  const img = ctx.createImageData(W,H);
  for(let k=0;k<W*H;k++){ img.data[k*4]=color.px[k*3]; img.data[k*4+1]=color.px[k*3+1]; img.data[k*4+2]=color.px[k*3+2]; img.data[k*4+3]=255; }
  ctx.putImageData(img, (n%2)*640, ((n/2)|0)*360);

  console.log('--- shot ' + n + ' -> ' + scored.total + ' points ' +
    '(base ' + Math.round(scored.base) + ' x' + scored.multiplier + ')');
  for (const s of scored.subjects) {
    console.log('    ' + s.color.padEnd(14) +
      s.poseName.padEnd(10) +
      (s.coverage*100).toFixed(2).padStart(6) + '% ' +
      'size ' + s.size.toFixed(1).padStart(5) +
      '  pose ' + String(s.pose).padStart(3) +
      (s.cropLoss > 0.5 ? '  crop -' + s.cropLoss.toFixed(0) : '') +
      (s.envLoss > 0.5 ? '  scenery -' + s.envLoss.toFixed(0) : '') +
      (s.occLoss > 0.5 ? '  herd -' + s.occLoss.toFixed(0) : '') +
      '' );
  }
  console.log('    composition ' + scored.composition +
    (scored.bonuses.length ? '   bonuses: ' + scored.bonuses.map(b=>b.label+' x'+b.factor).join(', ') : ''));
});
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
