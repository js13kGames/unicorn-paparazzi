// Is the game actually playable at this density and subject floor? Count how
// often a unicorn is close enough to clear minCoverage from the moving cart.
import { buildWorld, pathAt } from '../.mirror/terrain.mjs';
import { spawn, updateHerd, packInstances } from '../.mirror/unicorn.mjs';
// The real CONFIG, read out of src/index.js rather than copied. Copies here had
// already drifted away from the game they claim to measure.
import { readFileSync } from 'fs';
const CONFIG = (0, eval)('(' + /export const CONFIG = (\{[\s\S]*?\n\});/.exec(
  readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8'))[1] + ')');
const cfg = CONFIG;
// A unicorn is ~2.2 units tall; on a 360px-high 60deg frame it spans 312*2.2/d px.
// Coverage is roughly (0.45*h)^2 / (W*H) for the blocky silhouette.
const W=640,H=360,f=(H/2)/Math.tan(Math.PI/6);
const covAt = (d, zoom) => { const h=f*zoom*2.2/d; return (0.45*h*h)/(W*H); };
const reach = (floor, zoom) => { let d=1; while (covAt(d,zoom) > floor) d+=0.5; return d; };

for (const floor of [0.002, 0.0015, 0.001]) {
  console.log('floor ' + (floor*100).toFixed(2) + '%  ->  usable range ' +
    reach(floor,1).toFixed(0) + ' units at 1x, ' + reach(floor,4).toFixed(0) + ' at 4x');
}
const R = reach(0.002,1);
for (const seed of [12345, 777, 42]) {
  const w = buildWorld(seed, cfg);
  const h = spawn(w, cfg, seed);
  for (let i=0;i<600;i++) updateHerd(h, w, cfg, 1/60);
  packInstances(h, w);
  let none=0, samples=0; const counts=[];
  for (let d=0; d<w.route.length; d+=4) {
    const p = pathAt(w.route, d);
    let n=0;
    for (let u=0;u<h.n;u++) if (Math.hypot(h.x[u]-p.x, h.z[u]-p.z) < R) n++;
    counts.push(n); samples++; if(!n) none++;
  }
  counts.sort((a,b)=>a-b);
  console.log('seed', String(seed).padStart(6),
    ' herd', String(h.n).padStart(4),
    ' within', R.toFixed(0)+'u of the cart: median', counts[counts.length>>1],
    ' max', counts[counts.length-1],
    ' | ' + (100*none/samples).toFixed(0) + '% of the lap has nothing in range');
}
