import { createCanvas } from 'canvas';
import { buildWorld } from '../.mirror/terrain.mjs';
const cfg = { mapSize: 500, plainStickiness: .75, trackRadiusFrac: .25 };
const seeds = [12345, 777, 20260907, 42];
const N = 500, PAD = 6;
const cv = createCanvas(N*2 + PAD*3, N*2 + PAD*3);
const ctx = cv.getContext('2d');
ctx.fillStyle = '#000'; ctx.fillRect(0,0,cv.width,cv.height);
seeds.forEach((seed, si) => {
  const w = buildWorld(seed, cfg);
  const ox = PAD + (si%2)*(N+PAD), oy = PAD + ((si/2)|0)*(N+PAD);
  const img = ctx.createImageData(N, N);
  const hist = {};
  for (let z=0; z<N; z++) for (let x=0; x<N; x++) {
    const i = z*N+x, q = Math.round(w.elev[i]);
    hist[q]=(hist[q]||0)+1;
    let r,g,b;
    if (w.track[i]) { r=255;g=0;b=255; }
    else if (q<0){const d=Math.min(1,-q/4); r=26+24*(1-d); g=64+56*(1-d); b=132+74*(1-d);}
    else if (q===0){r=238;g=224;b=186;}
    else if (q===1){r=214;g=196;b=72;}
    else if (q<=4){const t=(q-2)/2; r=62-22*t; g=142-44*t; b=62-20*t;}
    else if (w.volcanic[i]){const t=Math.min(1,(q-5)/5); r=198+44*t; g=112-92*t; b=42-26*t;}
    else {const t=Math.min(1,(q-5)/5); r=128+66*t; g=104+76*t; b=168+72*t;}
    const o=i*4; img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=255;
  }
  ctx.putImageData(img, ox, oy);
  const hl = ((hist[5]||0)+(hist[6]||0)+(hist[7]||0)+(hist[8]||0)+(hist[9]||0)+(hist[10]||0))/(N*N);
  console.log('seed', seed, 'verts', (w.mesh.tally/1e6).toFixed(2)+'M', 'highland', (hl*100).toFixed(1)+'%', 'lap', w.route.length.toFixed(0));
});
import { writeFileSync } from 'fs';
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
