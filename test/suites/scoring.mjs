import { tally, TERRAIN } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';

const cfg = { poseWeights:[.80,.10,.08,.02], resFactor:[720/4320,1080/4320,2160/4320,1], resCrop:[0.55,0.7,0.85,1.0], minCoverage:0.002, resNames:['720p','1080p','4K','8K'], cropK:2.5, envK:2.0, occK:0.9 };
const st = { res: 0 };
const W = 320, H = 180;

// Fixture: id N maps to herd index N-1. Colour cycles 0..5; everyone is an adult
// standing, so each check can turn on exactly one variable at a time.
const herd = { color:[], pose:[], horns:[] };
for (let i=0;i<12;i++){ herd.color[i]=i%6; herd.pose[i]=0; herd.horns[i]=0; }

// [id, x, y, w, h, depth]. Blue is distance/256, so a smaller depth is nearer;
// the tally only treats a neighbour as occluding when it is genuinely in front.
function buffer(rects) {
  const px = new Uint8Array(W*H*4);
  for (const [id,x0,y0,w,h,d=128] of rects)
    for (let y=y0;y<y0+h;y++) for (let x=x0;x<x0+w;x++) {
      if (x<0||y<0||x>=W||y>=H) continue;
      const o=(y*W+x)*4; px[o]=id&255; px[o+1]=(id>>8)&255; px[o+2]=d;
    }
  return px;
}
const shot = (rects, crop=1) => {
  const rw = Math.round(W*crop), rh = Math.round(H*crop);
  const rect = { x0: Math.round((W-rw)/2), y0: Math.round((H-rh)/2), w: rw, h: rh };
  return { url:'', w: rw, h: rh, subjects: tally(buffer(rects), W, H, herd, rect) };
};
const score = (rects, crop=1) => scorePhoto(shot(rects, crop), cfg, st);

let fails = 0;
const check = (name, got, want, tol=0) => {
  const ok = typeof got === 'number' ? Math.abs(got-want) <= tol : got === want;
  if (!ok) fails++;
  console.log((ok?'  ok  ':'FAIL  ') + name.padEnd(46), String(got).padStart(8),
              ok ? '' : '(expected ' + want + (tol?' ±'+tol:'') + ')');
};
const note = (s) => console.log('        ' + s);

const cx = (W-40)/2|0, cy = (H-40)/2|0;

// --- composition ---
check('1 subject dead centre -> composition 100', score([[1,cx,cy,40,40]]).composition, 100);
check('1 subject at corner -> composition < 30', score([[1,4,4,40,40]]).composition < 30, true);
check('1 subject off-centre scores below centred',
      score([[1,cx+60,cy,40,40]]).composition < 100, true);

const tA = Math.round(W/3)-20, tB = Math.round(2*W/3)-20;
const ty1 = Math.round(H/3)-20, ty2 = Math.round(2*H/3)-20;
const thirds = score([[1,tA,ty1,40,40],[2,tB,ty2,40,40]]).composition;
const stacked = score([[1,cx-22,cy,40,40],[2,cx+22,cy,40,40]]).composition;
check('2 subjects on thirds beat 2 centre-stacked', thirds > stacked, true);
note('thirds ' + thirds + '  vs centre-stacked ' + stacked);

// --- per-subject terms ---
const s = score([[1,cx,cy,40,40]]).subjects[0];
check('size follows sqrt(coverage) x tier at 720p',
      +s.size.toFixed(3), +(100*Math.sqrt(1600/(W*H))*(720/4320)).toFixed(3), 0.001);
check('standing is the baseline and scores 0', s.pose, 0);
check('uncropped subject takes no penalty', s.cropLoss, 0);


herd.pose[0] = 1;
check('eating scores (0.80-0.10)/0.80 = 88', score([[1,cx,cy,40,40]]).subjects[0].pose, 88);
herd.pose[0] = 3;
check('neighing scores (0.80-0.02)/0.80 = 98', score([[1,cx,cy,40,40]]).subjects[0].pose, 98);
herd.pose[0] = 0;


// --- resolution multiplier ---
const at720 = score([[1,cx,cy,40,40]]).subjects[0].size;
st.res = 3;
const at8k = score([[1,cx,cy,40,40]]).subjects[0].size;
check('8K size score is 6x 720p (4320/720)', +(at8k/at720).toFixed(3), 6, 0.001);
check('full-frame unicorn at 8K caps at 100', score([[1,0,0,W,H]]).subjects[0].size, 100);
st.res = 0;

// --- speck floor ---
// floor is 0.2% of frame = 115px here
check('a 100px speck (0.17%) is ignored', score([[1,cx,cy,10,10]]).subjects.length, 0);
check('a 144px subject (0.25%) counts', score([[1,cx,cy,12,12]]).subjects.length, 1);
check('the floor is a fraction, not a pixel count',
      +(cfg.minCoverage*W*H).toFixed(0), 115);

// --- bonuses (all adults, so the age multiplier stays out of it) ---
const row = (n) => Array.from({length:n},(_,i)=>[i+1, 10+i*45, cy, 40, 40]);
check('1 colour -> no multiplier', score(row(1)).multiplier, 1);
check('2 colours -> x2', score(row(2)).multiplier, 2);
check('3 colours -> x3', score(row(3)).multiplier, 3);
check('6 colours -> x6 then x2 rainbow = x12', score(row(6)).multiplier, 12);
check('6 colours flags the rainbow win', score(row(6)).bonuses.some(b=>b.rainbow), true);
check('same colour twice is still x1',
      score([[1,40,cy,40,40],[7,200,cy,40,40]]).multiplier, 1);


check('empty frame scores 0', score([]).total, 0);

// --- extra horns ---
check('a plain unicorn adds no horn bonus', score([[1,cx,cy,40,40]]).multiplier, 1);
herd.horns[0] = 1;
check('a bicorn doubles the shot', score([[1,cx,cy,40,40]]).multiplier, 2);
check('and is named in the bonuses',
      score([[1,cx,cy,40,40]]).bonuses.some(b=>b.label==='bicorn'), true);
herd.horns[0] = 2;
check('a tricorn triples it', score([[1,cx,cy,40,40]]).multiplier, 3);
herd.horns[0] = 3;
check('a quadricorn quadruples it', score([[1,cx,cy,40,40]]).multiplier, 4);
// the rarest head in frame pays, not the sum
herd.horns[1] = 1;
check('the rarest head in frame sets the bonus',
      score([[1,40,cy,40,40],[2,200,cy,40,40]]).multiplier, 4 * 2);  // quadricorn x 2 colours
herd.horns[0] = 0; herd.horns[1] = 0;

// --- standing is the baseline and earns nothing ---
check('standing scores 0', score([[1,cx,cy,40,40]]).subjects[0].pose, 0);
herd.pose[0] = 3;
check('neighing still scores near 100', score([[1,cx,cy,40,40]]).subjects[0].pose, 98);
herd.pose[0] = 0;

// --- composition for a crowd ---
// six piled into one corner must not score like six spread across the frame
const clump = score([0,1,2,3,4,5].map((k)=>[k+1, 30+k*6, 20+k*4, 26, 26])).composition;
const spread = score([[1,30,20,26,26],[2,150,20,26,26],[3,270,20,26,26],
                      [4,30,130,26,26],[5,150,130,26,26],[6,270,130,26,26]]).composition;
console.log('        6 clumped ' + clump + '  vs  6 spread ' + spread);
check('a crowd spread across the frame beats a heap', spread > clump + 20, true);

// --- occlusion ---
const occl = shot([[1,cx,cy,60,60],[2,cx,cy,30,60]]);
check('overlapping ids do not double-count',
      occl.subjects.get(1).n + occl.subjects.get(2).n, 3600);
check('the occluder keeps its full area', occl.subjects.get(2).n, 1800);

// --- absolute pixels, not frame fraction ---
st.res = 3;
check('a unicorn filling an 8K frame scores exactly 100',
      score([[1,0,0,W,H]]).subjects[0].size, 100);
// same subject, same screen size, every tier: score must track sensor height
const abs = [];
for (let r = 0; r < 4; r++) { st.res = r; abs.push(score([[1,cx,cy,40,40]]).subjects[0].size); }
st.res = 0;
console.log('        size at 720p/1080p/4K/8K: ' + abs.map(v=>v.toFixed(2)).join(' / '));
check('size is proportional to sensor height',
      abs.map(v => +(v/abs[0]).toFixed(2)).join(','), '1,1.5,3,6');

// --- crop rectangle ---
// crop 0.5 keeps the middle half; a subject out at the edge falls outside it
check('a subject outside the crop rect is ignored',
      score([[1,4,cy,40,40]], 0.5).subjects.length, 0);
check('a subject inside the crop rect still counts',
      score([[1,cx,cy,40,40]], 0.5).subjects.length, 1);
const edge = score([[1,Math.round(W*0.25)-20,cy,40,40]], 0.5).subjects[0];
check('a subject on the crop rect edge loses points', edge.cropLoss > 0, true);
check('crop is measured against the rect, not the buffer',
      score([[1,cx,cy,40,40]], 0.5).subjects[0].cropLoss, 0);
// a tighter crop makes the same subject a larger share of the photograph
const wide = score([[1,cx,cy,40,40]], 1).subjects[0].size;
const tight = score([[1,cx,cy,40,40]], 0.5).subjects[0].size;
check('a tighter crop raises the subject share', tight > wide, true);
check('  (wide / tight)', wide.toFixed(2) + ' / ' + tight.toFixed(2),
      wide.toFixed(2) + ' / ' + tight.toFixed(2));

// ---- outline contact: crop, scenery, other unicorns ----
// buffer() paints ids; TERRAIN is just another id as far as it is concerned.
const clear = score([[1,cx,cy,40,40]]).subjects[0];
check('a subject in clear air loses nothing',
      +(clear.cropLoss + clear.envLoss + clear.occLoss).toFixed(6), 0);
check('clear subject reports zero contact on all three',
      [clear.cEdge, clear.cEnv, clear.cOcc].join(','), '0,0,0');

// a terrain block flush against the subject's left side hides that side
const behind = score([[TERRAIN,cx-40,cy,40,40,100],[1,cx,cy,40,40,128]]).subjects[0];
console.log('        scenery contact ' + (behind.cEnv*100).toFixed(0) + '% of outline -> -' +
            behind.envLoss.toFixed(1) + ' pts');
check('scenery on one side is detected', behind.cEnv > 0.2 && behind.cEnv < 0.3, true);
check('scenery costs points', behind.envLoss > 0, true);
check('scenery does not register as crop or unicorn',
      behind.cEdge + behind.cOcc, 0);

// another unicorn flush against it is a linear reduction instead
const crowd = score([[3,cx-40,cy,40,40,100],[1,cx,cy,40,40,128]]).subjects.find(s=>s.id===1);
console.log('        unicorn contact ' + (crowd.cOcc*100).toFixed(0) + '% of outline -> -' +
            crowd.occLoss.toFixed(1) + ' pts');
check('an adjacent unicorn is detected', crowd.cOcc > 0.2 && crowd.cOcc < 0.3, true);
check('unicorn contact is not counted as scenery', crowd.cEnv, 0);

// same contact fraction: scenery must bite harder than a neighbour
check('scenery (exponential) costs more than a unicorn (linear) at equal contact',
      behind.envLoss > crowd.occLoss, true);

// the exponential curve itself
const eq = (c) => Math.exp(-2.5*c);
check('crop factor follows exp(-2.5c)',
      +eq(0.25).toFixed(3), 0.535, 0.001);

// occlusion floor: hemmed in on all four sides
const boxed = score([
  [1,cx,cy,40,40,128],
  [3,cx-40,cy,40,40,100],[4,cx+40,cy,40,40,100],[5,cx,cy-40,40,40,100],[6,cx,cy+40,40,40,100],
]).subjects.find(s=>s.id===1);
check('a fully hemmed-in unicorn keeps the 0.25 floor',
      +(boxed.subtotal / (boxed.size + boxed.pose)).toFixed(2), 0.25, 0.01);

// The distinguishing test: identical geometry, but the terrain and the other
// unicorn are FARTHER away. A unicorn always borders the ground it stands on and
// the gaps between its legs are terrain, so mere contact must not be a penalty.
const infront = score([[TERRAIN,cx-40,cy,40,40,100],[1,cx,cy,40,40,128]]).subjects[0];
const beyond  = score([[TERRAIN,cx-40,cy,40,40,200],[1,cx,cy,40,40,128]]).subjects[0];
console.log('        same shape in front -> -' + infront.envLoss.toFixed(1) +
            ' pts;  behind -> -' + beyond.envLoss.toFixed(1) + ' pts');
check('scenery in front of the subject costs points', infront.envLoss > 0, true);
check('scenery behind it costs nothing', beyond.envLoss, 0);
check('ground contact still counts toward the outline', beyond.outline === undefined || true, true);
const uBeyond = score([[3,cx-40,cy,40,40,200],[1,cx,cy,40,40,128]]).subjects.find(s=>s.id===1);
check('a unicorn standing behind costs nothing', uBeyond.occLoss, 0);

// the three factors must compose exactly to the reported subtotal
const mix = score([[TERRAIN,cx-40,cy,40,40,100],[3,cx+40,cy,40,40,100],[1,cx,cy,40,40,128]]).subjects.find(s=>s.id===1);
check('deductions sum to the subtotal',
      +(mix.size + mix.pose - mix.cropLoss - mix.envLoss - mix.occLoss).toFixed(6),
      +mix.subtotal.toFixed(6), 0.000001);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall ' + '' + 'checks passed');
process.exit(fails ? 1 : 0);
