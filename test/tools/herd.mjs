import { buildWorld } from '../.mirror/terrain.mjs';
import { spawn, updateHerd, packInstances, buildModel, buildPoseTable, PARTS, POSE_ROWS, COLOR_NAMES, POSE_NAMES } from '../.mirror/unicorn.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35,
              trackRadiusFrac:.25, unicornDensity:.003, driftChance:.08,
              poseWeights:[.80,.10,.08,.02], weakRadius:26, strongRadius:70, };
const w = buildWorld(12345, cfg);
const h = spawn(w, cfg, 12345);
console.log('herd size', h.n);
const cc = {};
for (let i=0;i<h.n;i++) cc[COLOR_NAMES[h.color[i]]]=(cc[COLOR_NAMES[h.color[i]]]||0)+1;
console.log('colors', cc);
const m = buildModel();
console.log('model verts', m.count, 'boxes', m.count/36);
const pt = buildPoseTable();
console.log('pose table floats', pt.length, 'expected', POSE_ROWS*PARTS*16, 'finite', pt.every(Number.isFinite));
// simulate 60s
let t0=Date.now();
for (let f=0; f<3600; f++) updateHerd(h, w, cfg, 1/60);
packInstances(h, w);
console.log('60s sim ms', Date.now()-t0);
const pc = {}; for (let i=0;i<h.n;i++) pc[POSE_NAMES[h.pose[i]]]=(pc[POSE_NAMES[h.pose[i]]]||0)+1;
console.log('pose mix after sim', Object.entries(pc).map(([k,v])=>k+' '+(100*v/h.n).toFixed(1)+'%').join(' '));
// invariants
let bad=0, inWater=0, oob=0;
for (let i=0;i<h.n;i++){
  if (!Number.isFinite(h.x[i])||!Number.isFinite(h.z[i])) bad++;
  const gi=(h.z[i]|0)*w.N+(h.x[i]|0);
  if (w.elev[gi]<-0.001) inWater++;
  if (h.x[i]<0||h.z[i]<0||h.x[i]>=w.N||h.z[i]>=w.N) oob++;
}
console.log('non-finite', bad, 'in water', inWater, 'out of bounds', oob);
const inst = packInstances(h,w);
console.log('instance floats finite', inst.every(Number.isFinite), 'poseRow max', Math.max(...Array.from({length:h.n},(_,i)=>inst[i*8+6])), 'of', POSE_ROWS-1);
