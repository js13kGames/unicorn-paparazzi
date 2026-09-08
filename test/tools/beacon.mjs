import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { shot, world, LURES } from './scene.mjs';
import { pathAt } from '../.mirror/terrain.mjs';
// place one attractor and one repellent up the track, as the game does
for (const [lead, strong] of [[190, true], [120, false]]) {
  const a = pathAt(world.path, lead), b = pathAt(world.path, lead + 4);
  const tx=b.x-a.x, tz=b.z-a.z, l=Math.hypot(tx,tz)||1;
  LURES.push({ x: a.x + (-tz/l)*20, z: a.z + (tx/l)*20, strong, until: 1e9 });
}
const cv = createCanvas(640, 360*2);
const ctx = cv.getContext('2d');
[0, 60].forEach((d, row) => {
  const r = shot(d, -0.02, 0, false);
  const img = ctx.createImageData(640, 360);
  for (let k=0;k<640*360;k++){ img.data[k*4]=r.px[k*3]; img.data[k*4+1]=r.px[k*3+1]; img.data[k*4+2]=r.px[k*3+2]; img.data[k*4+3]=255; }
  ctx.putImageData(img, 0, row*360);
});
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
console.log('  rendered: strong lure at 190 ahead, weak lure at 120');
