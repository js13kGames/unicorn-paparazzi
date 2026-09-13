import { buildWorld, pathAt, HEIGHT } from '../.mirror/terrain.mjs';
const cfg = { mapSize: 500, plainStickiness: .75, trackRadiusFrac: .25 };
let t0 = Date.now();
const w = buildWorld(12345, cfg);
console.log('gen ms', Date.now() - t0);
console.log('verts', w.mesh.tally, 'MB pos', (w.mesh.pos.byteLength/1048576).toFixed(1), 'MB col', (w.mesh.col.byteLength/1048576).toFixed(1));
// elevation histogram
const h = {};
for (let i=0;i<w.elev.length;i++){ const q=Math.round(w.elev[i]); h[q]=(h[q]||0)+1; }
console.log('elev hist', Object.keys(h).map(Number).sort((a,b)=>a-b).map(k=>k+':'+(100*h[k]/w.elev.length).toFixed(1)+'%').join(' '));
console.log('track tiles', w.track.reduce((a,b)=>a+b,0));
console.log('path len', w.route.length.toFixed(1), 'lap secs @14u/s', (w.route.length/14).toFixed(0));
// track height continuity
let maxJump=0; for(let i=0;i<1024;i++){ maxJump=Math.max(maxJump, Math.abs(w.route.h[(i+1)%1024]-w.route.h[i])); }
console.log('max per-point height jump', maxJump.toFixed(4), '(x HEIGHT =', (maxJump*HEIGHT).toFixed(4), 'units)');
console.log('track h min/max', Math.min(...w.route.h).toFixed(2), Math.max(...w.route.h).toFixed(2));
// pathAt continuity: sample and check step distance is smooth
let prev=pathAt(w.route,0), md=0;
for(let d=1;d<w.route.length;d+=1){ const p=pathAt(w.route,d); md=Math.max(md, Math.hypot(p.x-prev.x,p.z-prev.z)); prev=p; }
console.log('max pathAt step for 1 unit of arc', md.toFixed(3));
const a=pathAt(w.route,0), b=pathAt(w.route,w.route.length);
console.log('loop closes:', Math.hypot(a.x-b.x,a.z-b.z).toFixed(5), 'dy', Math.abs(a.y-b.y).toFixed(5));
// determinism
const w2 = buildWorld(12345, cfg);
let same=true; for(let i=0;i<w.elev.length;i+=997) if(w.elev[i]!==w2.elev[i]) same=false;
console.log('deterministic:', same);
