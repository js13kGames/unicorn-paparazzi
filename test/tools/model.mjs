// Software rasteriser mirroring HERD_VS/HERD_FS, so the model, skeleton
// hierarchy and pose angles can be eyeballed without a GPU.
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { buildModel, buildPoseTable, COLORS, PARTS, POSE_FRAMES, POSE_NAMES } from '../.mirror/unicorn.mjs';

const model = buildModel(), poses = buildPoseTable();
const W = 300, H = 300;

const mulv = (m,x,y,z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];

function render(ctx, ox, oy, row, ci, scale, yaw) {
  const zbuf = new Float32Array(W*H).fill(1e9);
  const img = ctx.createImageData(W, H);
  for (let i=0;i<W*H;i++){ img.data[i*4]=236; img.data[i*4+1]=240; img.data[i*4+2]=246; img.data[i*4+3]=255; }
  const tri = [];
  for (let v = 0; v < model.tally; v++) {
    const part = model.attr[v*2], role = model.attr[v*2+1];
    const m = poses.subarray((row*PARTS+part)*16, (row*PARTS+part)*16+16);
    let [x,y,z] = mulv(m, model.pos[v*3], model.pos[v*3+1], model.pos[v*3+2]);
    x*=scale; y*=scale; z*=scale;
    const s=Math.sin(yaw), c=Math.cos(yaw);
    tri.push([x*c+z*s, y, -x*s+z*c, role]);
  }
  const cx=0, cy=1.15, cz=-4.6, f=280;
  const pal = COLORS[ci], mane = COLORS[(ci+1)%6];
  for (let t = 0; t < tri.length; t += 3) {
    const p = [0,1,2].map(k => { const v=tri[t+k]; const dz=v[2]-cz; return [ (v[0]-cx)*f/dz + W/2, -(v[1]-cy)*f/dz + H/2, dz ]; });
    if (p.some(q=>q[2]<=0.1)) continue;
    const a=tri[t], b=tri[t+1], c3=tri[t+2];
    const nx=(b[1]-a[1])*(c3[2]-a[2])-(b[2]-a[2])*(c3[1]-a[1]);
    const ny=(b[2]-a[2])*(c3[0]-a[0])-(b[0]-a[0])*(c3[2]-a[2]);
    const nz=(b[0]-a[0])*(c3[1]-a[1])-(b[1]-a[1])*(c3[0]-a[0]);
    const nl=Math.hypot(nx,ny,nz)||1;
    const lt=0.42+0.58*Math.max(0,(nx*0.42+ny*0.82+nz*0.32)/nl/0.966);
    const role=a[3];
    const base = role===0?pal : role===1?mane : role===2?[.98,.94,.78] : pal.map(v=>v*0.42);
    const r=base[0]*255*lt, g=base[1]*255*lt, bl=base[2]*255*lt;
    const minx=Math.max(0,Math.floor(Math.min(p[0][0],p[1][0],p[2][0])));
    const maxx=Math.min(W-1,Math.ceil(Math.max(p[0][0],p[1][0],p[2][0])));
    const miny=Math.max(0,Math.floor(Math.min(p[0][1],p[1][1],p[2][1])));
    const maxy=Math.min(H-1,Math.ceil(Math.max(p[0][1],p[1][1],p[2][1])));
    const d=(p[1][1]-p[2][1])*(p[0][0]-p[2][0])+(p[2][0]-p[1][0])*(p[0][1]-p[2][1]);
    if (Math.abs(d)<1e-9) continue;
    for(let py=miny;py<=maxy;py++) for(let px=minx;px<=maxx;px++){
      const l0=((p[1][1]-p[2][1])*(px-p[2][0])+(p[2][0]-p[1][0])*(py-p[2][1]))/d;
      const l1=((p[2][1]-p[0][1])*(px-p[2][0])+(p[0][0]-p[2][0])*(py-p[2][1]))/d;
      const l2=1-l0-l1;
      if(l0<0||l1<0||l2<0) continue;
      const zz=l0*p[0][2]+l1*p[1][2]+l2*p[2][2];
      const k=py*W+px;
      if(zz>=zbuf[k]) continue;
      zbuf[k]=zz; const o=k*4;
      img.data[o]=r; img.data[o+1]=g; img.data[o+2]=bl;
    }
  }
  ctx.putImageData(img, ox, oy);
}

const cv = createCanvas(W*4, H*2 + 44);
const ctx = cv.getContext('2d');
ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
ctx.font='14px sans-serif';
POSE_NAMES.forEach((name, i) => {
  render(ctx, i*W, 0, i*POSE_FRAMES + 4, i, 1, 0.6);
  ctx.fillStyle='#000'; ctx.fillText(name, i*W+8, H+16);
});
POSE_NAMES.forEach((name, i) => {
  render(ctx, i*W, H+22, i*POSE_FRAMES + 4, 4, 1, Math.PI/2);
  ctx.fillStyle='#000'; ctx.fillText(name + ' (side)', i*W+8, H*2+38);
});
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
