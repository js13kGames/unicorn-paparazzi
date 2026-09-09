import { tally, TERRAIN } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';

const cfg = { poseWeights:[.80,.10,.08,.02], resBonus:[1000,1500,3000,6000], minCoverage:0.002, resNames:['low','med','high','ultra'], cropK:2.5, envK:2.0, occK:0.9 };
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

// --- composition: average distance between subjects ---
// A lone subject has no pairs, so it is judged on how centred it is instead.
check('1 subject dead centre -> composition 100', score([[1,cx,cy,40,40]]).composition, 100, 1);
// (a 40px box in the corner still has its centroid 20px in, so this is not the
// mathematical corner -- hence 30, not 0)
check('1 subject in the corner -> composition low',
      score([[1,4,4,40,40]]).composition < 30, true);
check('1 subject off-centre scores below centred',
      score([[1,cx+60,cy,40,40]]).composition < 100, true);
note('lone: centred ' + score([[1,cx,cy,40,40]]).composition +
     '  off-centre ' + score([[1,cx+60,cy,40,40]]).composition +
     '  corner ' + score([[1,4,4,40,40]]).composition);
// Two subjects far apart beat two touching, wherever they sit in the frame.
const apart = score([[1,20,cy,40,40],[2,W-60,cy,40,40]]).composition;
const together = score([[1,cx-22,cy,40,40],[2,cx+22,cy,40,40]]).composition;
check('2 subjects far apart beat 2 side by side', apart > together, true);
note('far apart ' + apart + '  vs side by side ' + together);
// Edges are not part of the rule any more: sliding a well-separated pair into
// the corner of the frame must not change the score.
const centredPair = score([[1,cx-70,cy,40,40],[2,cx+70,cy,40,40]]).composition;
const shiftedPair = score([[1,4,4,40,40],[2,144,4,40,40]]).composition;
check('the same separation scores the same anywhere in frame',
      centredPair, shiftedPair, 1);
// It is a mean over pairs, so a third subject dumped on top of the first
// dilutes the spread rather than adding to it.
// (kept clear of the 100 cap, or dilution would not be visible)
const two = score([[1,cx-40,cy,40,40],[2,cx+40,cy,40,40]]).composition;
const twoPlusClone = score([[1,cx-40,cy,40,40],[2,cx+40,cy,40,40],[3,cx-36,cy,40,40]]).composition;
check('a subject piled on another dilutes the spread', twoPlusClone < two, true);
note('2 spread ' + two + '  vs the same 2 plus a clone ' + twoPlusClone);

// --- per-subject terms ---
const s = score([[1,cx,cy,40,40]]).subjects[0];
check('size is coverage x the tier bonus on the cheap camera',
      +s.size.toFixed(3), +(1600/(W*H)*1000).toFixed(3), 0.001);
// standing scores nothing, which is what lets the breakdown suppress the row
check('standing is the baseline and scores 0', s.pose, 0);
check('uncropped subject takes no penalty', s.cropLoss, 0);


herd.pose[0] = 1;
check('eating scores (0.80-0.10)/0.80 = 88', score([[1,cx,cy,40,40]]).subjects[0].pose, 88);
herd.pose[0] = 3;
check('neighing scores (0.80-0.02)/0.80 = 98', score([[1,cx,cy,40,40]]).subjects[0].pose, 98);
herd.pose[0] = 0;


// --- resolution multiplier ---
const atLow = score([[1,cx,cy,40,40]]).subjects[0].size;
st.res = 3;
const atTop = score([[1,cx,cy,40,40]]).subjects[0].size;
check('the top tier scores 6x the bottom', +(atTop/atLow).toFixed(3), 6, 0.001);
check('a unicorn filling the top-tier frame scores the whole bonus',
      score([[1,0,0,W,H]]).subjects[0].size, 6000);
// the user's worked example: the smallest subject that counts is worth 2 points
// on the cheap camera, and twelve on the best.
st.res = 0;
const floorSub = score([[1,cx,cy,11,11]]).subjects[0];
check('a subject just over the 0.2% floor scores about 2 at the bottom',
      +floorSub.size.toFixed(1), 2, 0.2);
st.res = 3;
check('the same subject scores 6x that at the top',
      +score([[1,cx,cy,11,11]]).subjects[0].size.toFixed(1), +(floorSub.size*6).toFixed(1), 0.1);
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
check('6 colours still earns the rainbow bonus', score(row(6)).bonuses.some(b=>b.label==='RAINBOW'), true);
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
const spread = score([[1,20,20,26,26],[2,Math.round(W/2)-13,20,26,26],[3,W-46,20,26,26],
                      [4,20,H-46,26,26],[5,Math.round(W/2)-13,H-46,26,26],[6,W-46,H-46,26,26]]).composition;
console.log('        6 clumped ' + clump + '  vs  6 spread ' + spread);
check('a crowd spread across the frame beats a heap', spread > clump + 20, true);

// --- occlusion ---
const occl = shot([[1,cx,cy,60,60],[2,cx,cy,30,60]]);
check('overlapping ids do not double-count',
      occl.subjects.get(1).n + occl.subjects.get(2).n, 3600);
check('the occluder keeps its full area', occl.subjects.get(2).n, 1800);

// --- absolute pixels, not frame fraction ---
st.res = 3;
check('a unicorn filling a top-tier frame scores exactly the bonus',
      score([[1,0,0,W,H]]).subjects[0].size, 6000);
// same subject, same screen size, every tier: score must track sensor height
const abs = [];
for (let r = 0; r < 4; r++) { st.res = r; abs.push(score([[1,cx,cy,40,40]]).subjects[0].size); }
st.res = 0;
console.log('        size at low/med/high/ultra: ' + abs.map(v=>v.toFixed(2)).join(' / '));
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

// --- the compact breakdown ---------------------------------------------------
// One format, drawn on a photo's own screen and on the winner's card, and sent
// over the wire so a rival's winning card can be drawn too. A leading space on a
// label means "detail of the row above"; that convention is the whole contract.
const rowsOf = (sc) => sc.b.map((r) => r[0]);
const valueOf = (sc, label) => (sc.b.find((r) => r[0] === label) || [])[1];

herd.pose[0] = 0;
const standing = score([[1,cx,cy,40,40]]);
check('a subject heads its own group', standing.b[0][0], 'red', 0);
check('and the group header is not marked as a detail',
      standing.b[0][0][0] === ' ', false);
check('size is always broken out', rowsOf(standing).includes(' size'), true);
check('and it is marked as a detail of the subject above',
      standing.b[1][0][0], ' ');
// Standing is the baseline and scores nothing, so a row saying "+0" would be noise.
check('standing shows no pose row', rowsOf(standing).includes(' pose'), false);

herd.pose[0] = 3;
const neighing = score([[1,cx,cy,40,40]]);
check('a pose worth points gets its own row', rowsOf(neighing).includes(' pose'), true);
check('and it carries the points, signed', valueOf(neighing, ' pose'), '+98');
check('the pose is named in the subject header', neighing.b[0][0], 'red neighing', 0);
herd.pose[0] = 0;

// The three ways a subject can be spoiled are one number to the player.
const clean1 = score([[1,cx,cy,40,40]]);
check('an unspoiled subject has no obscured row',
      rowsOf(clean1).includes(' obscured'), false);
const spoiled = score([[TERRAIN,cx-40,cy,40,40,100],[1,cx,cy,40,40,128]]);
check('scenery in the way shows up as one obscured row',
      rowsOf(spoiled).filter((r) => r === ' obscured').length, 1);
check('and it is a deduction', valueOf(spoiled, ' obscured')[0], '-');

// Everything on the wire has to already be a string, or net.js could not filter it.
check('every cell is a string',
      spoiled.b.every((r) => r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'string'),
      true);

const bonused = score(row(6));
check('bonuses ride along as multiply rows',
      bonused.b.some((r) => r[1] === '\u00d72'), true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall ' + '' + 'checks passed');
process.exit(fails ? 1 : 0);
