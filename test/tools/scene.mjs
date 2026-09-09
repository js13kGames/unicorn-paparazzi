// Software rasteriser for the whole scene, fed by the real buildWorld/spawn
// output and mirroring the GLSL in render.js. Lets the look be judged without a
// GPU: same normals, same fog, same palette.
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { buildWorld, pathAt, elevAt, HEIGHT, WATER_Y } from '../.mirror/terrain.mjs';
import { spawn, updateHerd, packInstances, buildModel, buildPoseTable, COLORS, PARTS } from '../.mirror/unicorn.mjs';

const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:+(process.env.SMOOTH||3),
              terrainDetail:+(process.env.DETAIL===undefined?0.35:process.env.DETAIL), trackRadiusFrac:.25, unicornDensity:+(process.env.DENSITY||0.003), adultChance:.75, driftChance:.08,
              poseWeights:[.80,.10,.08,.02], };
const SEED = +(process.env.SEED || 12345);
const world = buildWorld(SEED, cfg);
const herd = spawn(world, cfg, SEED);
export function settle(n){ for (let f=0; f<n; f++) updateHerd(herd, world, cfg, 1/60); packInstances(herd, world); }
settle(600);
packInstances(herd, world);

const model = buildModel(), poseTab = buildPoseTable();
const SKY = [0.62, 0.78, 0.95], FOG = 190;
const W = 640, H = 360, FOVY = Math.PI/3;
let f = (H/2) / Math.tan(FOVY/2);

export function shot(dist, pitch, yawOff, idMode, zoom) {
  f = (H/2) / Math.tan(FOVY/(2*(zoom||1)));
  const p = pathAt(world.path, dist);
  const a = pathAt(world.path, dist), b = pathAt(world.path, dist+4);
  const yaw = Math.atan2(-(b.x-a.x), -(b.z-a.z)) + yawOff;
  const eye = [p.x, elevAt(world, p.x, p.z) + 2.4, p.z];
  const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
  const R=[cy,0,-sy], U=[sp*sy,cp,sp*cy], B=[sy*cp,-sp,cy*cp];
  const zbuf = new Float32Array(W*H).fill(1e9);
  const px = new Uint8ClampedArray(W*H*3);
  for (let i=0;i<W*H;i++){ if(!idMode){px[i*3]=SKY[0]*255; px[i*3+1]=SKY[1]*255; px[i*3+2]=SKY[2]*255;} }

  const proj = (x,y,z) => {
    const dx=x-eye[0], dy=y-eye[1], dz=z-eye[2];
    const xc=dx*R[0]+dy*R[1]+dz*R[2], yc=dx*U[0]+dy*U[1]+dz*U[2], zc=dx*B[0]+dy*B[1]+dz*B[2];
    const d=-zc;
    return [W/2 + xc*f/d, H/2 - yc*f/d, d, Math.hypot(dx,dy,dz)];
  };
  const sun=[0.42,0.82,0.32], sl=Math.hypot(...sun);
  const lit=(nx,ny,nz)=>{ const l=Math.hypot(nx,ny,nz)||1; return 0.42+0.58*Math.max(0,(nx*sun[0]+ny*sun[1]+nz*sun[2])/l/sl); };

  // c0/c1/c2 are per-vertex lit RGB; interpolating them approximates what the
  // GPU does when it interpolates normal + colour and lights per fragment.
  function tri(p0,p1,p2, c0,c1,c2, dist0,dist1,dist2, alpha) {
    if (p0[2]<=0.2||p1[2]<=0.2||p2[2]<=0.2) return;
    const minx=Math.max(0,Math.floor(Math.min(p0[0],p1[0],p2[0])));
    const maxx=Math.min(W-1,Math.ceil(Math.max(p0[0],p1[0],p2[0])));
    const miny=Math.max(0,Math.floor(Math.min(p0[1],p1[1],p2[1])));
    const maxy=Math.min(H-1,Math.ceil(Math.max(p0[1],p1[1],p2[1])));
    if (maxx<minx||maxy<miny) return;
    const d=(p1[1]-p2[1])*(p0[0]-p2[0])+(p2[0]-p1[0])*(p0[1]-p2[1]);
    if (Math.abs(d)<1e-9) return;
    for(let y=miny;y<=maxy;y++) for(let x=minx;x<=maxx;x++){
      const l0=((p1[1]-p2[1])*(x-p2[0])+(p2[0]-p1[0])*(y-p2[1]))/d;
      const l1=((p2[1]-p0[1])*(x-p2[0])+(p0[0]-p2[0])*(y-p2[1]))/d;
      const l2=1-l0-l1;
      if(l0<0||l1<0||l2<0) continue;
      const zz=l0*p0[2]+l1*p1[2]+l2*p2[2];
      const k=y*W+x;
      if(zz>=zbuf[k]) continue;
      const dd=l0*dist0+l1*dist1+l2*dist2;
      let fo=idMode?0:Math.min(1,dd/FOG); fo*=fo;
      const r=l0*c0[0]+l1*c1[0]+l2*c2[0];
      const g=l0*c0[1]+l1*c1[1]+l2*c2[1];
      const b=l0*c0[2]+l1*c1[2]+l2*c2[2];
      const rr=r*(1-fo)+SKY[0]*255*fo, gg=g*(1-fo)+SKY[1]*255*fo, bb=b*(1-fo)+SKY[2]*255*fo;
      if (alpha===undefined) { zbuf[k]=zz; px[k*3]=rr; px[k*3+1]=gg; px[k*3+2]=bb; }
      else { px[k*3]=px[k*3]*(1-alpha)+rr*alpha; px[k*3+1]=px[k*3+1]*(1-alpha)+gg*alpha; px[k*3+2]=px[k*3+2]*(1-alpha)+bb*alpha; }
    }
  }

  // --- terrain (indexed, per-vertex normal + colour, exactly as uploaded) ---
  const m = world.mesh, S = m.S;
  const V = S*S;
  const sp2 = new Float32Array(V*4);
  const vis = new Uint8Array(V);
  for (let i=0;i<V;i++){
    const gx=m.pos[i*3], gz=m.pos[i*3+2];
    if (Math.abs(gx-eye[0])>FOG+6 || Math.abs(gz-eye[2])>FOG+6) continue;
    const q=proj(gx, m.pos[i*3+1], gz);
    sp2[i*4]=q[0]; sp2[i*4+1]=q[1]; sp2[i*4+2]=q[2]; sp2[i*4+3]=q[3];
    vis[i]=q[2]>0.2?1:0;
  }
  const vcol = new Float32Array(V*3);
  const vdone = new Uint8Array(V);
  const litCol = (i) => {
    if (!vdone[i]) {
      const l = lit(m.nrm[i*4]/127, m.nrm[i*4+1]/127, m.nrm[i*4+2]/127);
      if (idMode) { vcol[i*3]=255; vcol[i*3+1]=255; vcol[i*3+2]=Math.min(255, sp2[i*4+3]/256*255); }
      else { vcol[i*3]=m.col[i*4]*l; vcol[i*3+1]=m.col[i*4+1]*l; vcol[i*3+2]=m.col[i*4+2]*l; }
      vdone[i]=1;
    }
    return vcol.subarray(i*3, i*3+3);
  };
  for (let t=0;t<m.idx.length;t+=3){
    const a=m.idx[t],b2=m.idx[t+1],c=m.idx[t+2];
    if(!vis[a]||!vis[b2]||!vis[c]) continue;
    tri([sp2[a*4],sp2[a*4+1],sp2[a*4+2]],[sp2[b2*4],sp2[b2*4+1],sp2[b2*4+2]],[sp2[c*4],sp2[c*4+1],sp2[c*4+2]],
        litCol(a), litCol(b2), litCol(c),
        sp2[a*4+3],sp2[b2*4+3],sp2[c*4+3]);
  }

  // --- track ribbon ---
  {
    const tm = world.trackMesh, TV = tm.pos.length/3;
    const tsp = new Float32Array(TV*4); const tvis = new Uint8Array(TV);
    for (let i=0;i<TV;i++){
      const gx=tm.pos[i*3], gz=tm.pos[i*3+2];
      if (Math.abs(gx-eye[0])>FOG+6 || Math.abs(gz-eye[2])>FOG+6) continue;
      const q=proj(gx, tm.pos[i*3+1], gz);
      tsp[i*4]=q[0]; tsp[i*4+1]=q[1]; tsp[i*4+2]=q[2]; tsp[i*4+3]=q[3];
      tvis[i]=q[2]>0.2?1:0;
    }
    const tc=[];
    for(let i=0;i<TV;i++){
      const l=lit(tm.nrm[i*4]/127,tm.nrm[i*4+1]/127,tm.nrm[i*4+2]/127);
      tc.push(idMode ? [255,255,Math.min(255,tsp[i*4+3]/256*255)] : [tm.col[i*4]*l, tm.col[i*4+1]*l, tm.col[i*4+2]*l]);
    }
    for(let t=0;t<tm.idx.length;t+=3){
      const a=tm.idx[t],b2=tm.idx[t+1],c=tm.idx[t+2];
      if(!tvis[a]||!tvis[b2]||!tvis[c]) continue;
      tri([tsp[a*4],tsp[a*4+1],tsp[a*4+2]],[tsp[b2*4],tsp[b2*4+1],tsp[b2*4+2]],[tsp[c*4],tsp[c*4+1],tsp[c*4+2]],
          tc[a],tc[b2],tc[c], tsp[a*4+3],tsp[b2*4+3],tsp[c*4+3]);
    }
  }


  // --- unicorns ---
  const inst = herd.instances;
  const mulv=(mm,x,y,z)=>[mm[0]*x+mm[4]*y+mm[8]*z+mm[12], mm[1]*x+mm[5]*y+mm[9]*z+mm[13], mm[2]*x+mm[6]*y+mm[10]*z+mm[14]];
  let drawn=0;
  for(let u=0;u<herd.n;u++){
    const ox=inst[u*8], oy=inst[u*8+1], oz=inst[u*8+2], uyaw=inst[u*8+3];
    if (Math.hypot(ox-eye[0], oz-eye[2]) > FOG) continue;
    const sc=inst[u*8+4], ci=inst[u*8+5]|0, row=inst[u*8+6]|0;
    drawn++;
    const pal=COLORS[ci];
    const mane=pal.map(v=>v+(1-v)*0.45);
    const vs=[];
    for(let v=0;v<model.count;v++){
      const part=model.attr[v*2];
      const mm=poseTab.subarray((row*PARTS+part)*16,(row*PARTS+part)*16+16);
      let [x,y,z]=mulv(mm, model.pos[v*3],model.pos[v*3+1],model.pos[v*3+2]);
      x*=sc;y*=sc;z*=sc;
      const s3=Math.sin(uyaw), c3=Math.cos(uyaw);
      vs.push([x*c3+z*s3+ox, y+oy, -x*s3+z*c3+oz]);
    }
    for(let t=0;t<vs.length;t+=3){
      const A=vs[t],B2=vs[t+1],C=vs[t+2];
      const nx=(B2[1]-A[1])*(C[2]-A[2])-(B2[2]-A[2])*(C[1]-A[1]);
      const ny=(B2[2]-A[2])*(C[0]-A[0])-(B2[0]-A[0])*(C[2]-A[2]);
      const nz=(B2[0]-A[0])*(C[1]-A[1])-(B2[1]-A[1])*(C[0]-A[0]);
      const role=model.attr[t*2+1];
      const base = role===0?pal : role===1?mane : role===2?[.98,.94,.78] : pal.map(v=>v*0.42);
      const l=lit(nx,ny,nz);
      const P0=proj(...A),P1=proj(...B2),P2=proj(...C);
      const id=u+1;
      const fc = idMode ? [id&255, (id>>8)&255, Math.min(255, P0[3]/256*255)] : [base[0]*255*l, base[1]*255*l, base[2]*255*l];
      tri(P0,P1,P2, fc, fc, fc, P0[3],P1[3],P2[3]);
    }
  }

  // --- sea ---
  const N=world.N, wy=WATER_Y;
  const wq=[[0,wy,N],[N,wy,N],[N,wy,0],[0,wy,0]].map(v=>proj(...v));
  const wl=lit(0,1,0), wc=idMode?[255,255,0]:[46*wl,108*wl,190*wl];
  tri(wq[0],wq[1],wq[2], wc,wc,wc, wq[0][3],wq[1][3],wq[2][3], 165/255);
  tri(wq[0],wq[2],wq[3], wc,wc,wc, wq[0][3],wq[2][3],wq[3][3], 165/255);

  return { px, drawn, W, H };
}

export { world, herd, W, H, cfg };
const shots = process.env.SHOTS ? JSON.parse(process.env.SHOTS) : [[0,-0.06,0],[200,-0.10,0.9],[400,-0.05,-1.2],[620,-0.14,2.4]];
const cv = createCanvas(W*2, H*Math.ceil(shots.length/2));
const ctx = cv.getContext('2d');
if (process.argv[1].endsWith('scene.mjs'))
shots.forEach(([d,pi,yo], i) => {
  const t0=Date.now();
  const { px, drawn } = shot(d, pi, yo);
  const img = ctx.createImageData(W,H);
  for(let k=0;k<W*H;k++){ img.data[k*4]=px[k*3]; img.data[k*4+1]=px[k*3+1]; img.data[k*4+2]=px[k*3+2]; img.data[k*4+3]=255; }
  ctx.putImageData(img, (i%2)*W, ((i/2)|0)*H);
  console.log('shot', i, Date.now()-t0+'ms', drawn, 'unicorns in range');
});
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
