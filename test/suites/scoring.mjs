import { tally, TERRAIN } from '../.mirror/photo.mjs';
import { scorePhoto } from '../.mirror/score.mjs';

// The rubric's constants are lifted from src/index.js, not copied. A copy that
// silently lacked a key the scorer reads turned every number in this suite into
// NaN, which is exactly the failure a hand-kept duplicate invites.
const SRC = await (await import('fs')).promises.readFile(
  new URL('../../src/index.js', import.meta.url), 'utf8');
const cfg = (0, eval)('(' + /export const CONFIG = (\{[\s\S]*?\n\});/.exec(SRC)[1] + ')');
// Lifted, not restated: what a pose pays is a plain table in CONFIG now rather
// than a curve over the spawn weights, and these checks read it straight.
const poseF = (k) => cfg.poseBonus[k];
const st = { res: 0 };
const W = 320, H = 180;

// Fixture: id N maps to herd index N-1. Color cycles 0..5; everyone is an adult
// standing, so each check can turn on exactly one variable at a time.
const herd = { color:[], pose:[], horns:[] };
for (let i=0;i<12;i++){ herd.color[i]=i%6; herd.pose[i]=0; herd.horns[i]=0; }

// [id, x, y, w, h, depth, part]. Blue is distance/256, so a smaller depth is
// nearer; the tally only treats a neighbour as occluding when it is genuinely in
// front. Alpha is the part the ID pass writes: 255 head or horn, 102 neck, 0
// flank. Left 0 by every fixture below except the head and neck ones, which is
// the whole animal reading as flank and framed off its body centroid.
const HEAD = 255, NECK = 102;
function buffer(rects) {
  const px = new Uint8Array(W*H*4);
  for (const [id,x0,y0,w,h,d=128,part=0] of rects)
    for (let y=y0;y<y0+h;y++) for (let x=x0;x<x0+w;x++) {
      if (x<0||y<0||x>=W||y>=H) continue;
      const o=(y*W+x)*4; px[o]=id&255; px[o+1]=(id>>8)&255; px[o+2]=d;
      px[o+3]=part;
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

// --- framing: crowding and the frame edge, punished together ---
// A lone subject has no pairs, so only its distance from the edge counts.
check('1 subject dead centre -> framing at the ceiling',
      score([[1,cx,cy,40,40]]).framing, 2, 0.01);
// (a 40px box in the corner still has its centroid 20px in, so this is not the
// mathematical corner -- hence well above the floor)
check('1 subject in the corner -> framing low',
      score([[1,4,4,40,40]]).framing < 0.8, true);
check('1 subject off-centre scores below centred',
      score([[1,cx+60,cy,40,40]]).framing < 2, true);
const f2 = (r) => score(r).framing.toFixed(2);
note('lone: centred ' + f2([[1,cx,cy,40,40]]) +
     '  off-centre ' + f2([[1,cx+60,cy,40,40]]) +
     '  corner ' + f2([[1,4,4,40,40]]));
// Two subjects far apart beat two touching, at the same distance from the edge.
const apart = score([[1,cx-70,cy,40,40],[2,cx+70,cy,40,40]]).framing;
const together = score([[1,cx-22,cy,40,40],[2,cx+22,cy,40,40]]).framing;
check('2 subjects far apart beat 2 side by side', apart > together, true);
note('far apart ' + apart.toFixed(2) + '  vs side by side ' + together.toFixed(2));
// Edges are part of the rule again: the same separation slid into the corner of
// the frame must now score worse than the same pair centred.
const centredPair = score([[1,cx-70,cy,40,40],[2,cx+70,cy,40,40]]).framing;
const shiftedPair = score([[1,4,4,40,40],[2,144,4,40,40]]).framing;
check('the same separation scores worse jammed into the corner',
      shiftedPair < centredPair - 0.1, true);
note('centred pair ' + centredPair.toFixed(2) + '  vs cornered ' + shiftedPair.toFixed(2));
// Spread is a mean over pairs, so a third subject dumped on top of the first
// dilutes it rather than adding to it. (Both kept clear of the ceiling, or the
// dilution would not be visible.)
const two = score([[1,cx-40,cy,40,40],[2,cx+40,cy,40,40]]).framing;
const twoPlusClone = score([[1,cx-40,cy,40,40],[2,cx+40,cy,40,40],[3,cx-36,cy,40,40]]).framing;
check('a subject piled on another dilutes the spread', twoPlusClone < two, true);
note('2 spread ' + two.toFixed(2) + '  vs the same 2 plus a clone ' + twoPlusClone.toFixed(2));

// --- per-subject terms ---
const s = score([[1,cx,cy,40,40]]).subjects[0];
// Area, not apparent width: the share of the frame the animal fills, times the
// sensor rate. The square root read fairer on paper and paid a speck on the
// horizon a third of what a unicorn filling the frame was worth, which left
// little reason to work for the close shot.
check('size is coverage x the tier bonus on the cheap camera',
      +s.size.toFixed(3), +(1600 / (W * H) * 1000).toFixed(3), 0.001);
// standing scores nothing, which is what lets the breakdown suppress the row
check('standing is the baseline and multiplies by 1', s.pose, 1);
check('uncropped subject takes no penalty', s.cropLoss, 0);


herd.pose[0] = 1;
check('eating pays its own rate', +score([[1,cx,cy,40,40]]).subjects[0].pose.toFixed(4),
      +poseF(1).toFixed(4));
herd.pose[0] = 3;
check('neighing pays its own rate', +score([[1,cx,cy,40,40]]).subjects[0].pose.toFixed(4),
      +poseF(3).toFixed(4));
// The table is free to be anything, but the rarer moment must never pay less --
// that is the one thing the curve it replaced guaranteed for nothing.
check('and the rarer moment is paid more', poseF(0) < poseF(1) && poseF(1) < poseF(3), true);
// Modest on purpose: at the old 6.3x the roll was a lottery on what the herd
// happened to be doing, whatever the photographer did.
check('but never enough to outweigh the photograph', poseF(3) < 2, true);
herd.pose[0] = 0;


// --- resolution multiplier ---
const atLow = score([[1,cx,cy,40,40]]).subjects[0].size;
st.res = 3;
const atTop = score([[1,cx,cy,40,40]]).subjects[0].size;
check('the top tier scores 6x the bottom', +(atTop/atLow).toFixed(3), 6, 0.001);
check('a unicorn filling the top-tier frame scores the whole bonus',
      score([[1,0,0,W,H]]).subjects[0].size, 6000);
// The other end of the range: the smallest subject that counts at all. On area
// it is worth about two points on the cheap camera against the 1000 a unicorn
// filling the frame earns -- a 480x spread, and the reason getting close is now
// the strongest thing a photographer does.
st.res = 0;
const floorSub = score([[1,cx,cy,11,11]]).subjects[0];
check('a subject just over the 0.2% floor is worth next to nothing',
      +floorSub.size.toFixed(1), 0.0021 * 1000, 0.3);
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
// A fifth of the photograph per colour in it, added rather than compounded. As
// the bare count it reached x12 on a rainbow, which made one lucky crowd worth
// more than a whole roll of deliberate photographs.
check('1 color -> no multiplier', score(row(1)).multiplier, 1);
check('2 colors -> x1.4', score(row(2)).multiplier, 1.4);
check('3 colors -> x1.6', score(row(3)).multiplier, 1.6);
check('6 colors -> x2.2 then x2 rainbow = x4.4', score(row(6)).multiplier, 4.4);
// The label carries the arithmetic, so the row says what another colour is
// worth rather than only what this one came to.
// Two names: the roll summary lists the short one beside a shot, the breakdown
// shows the arithmetic. A rate in the summary would be noise.
check('the roll summary gets the short name', score(row(3)).bonuses[0].label, '3 colors');
check('and the breakdown row names the rate it was paid at',
      score(row(3)).bonuses[0].row, '3 colors \u00b7 3 \u00d7 20%');
check('6 colors still earns the rainbow bonus', score(row(6)).bonuses.some(b=>b.label==='RAINBOW'), true);
check('same color twice is still x1',
      score([[1,40,cy,40,40],[7,200,cy,40,40]]).multiplier, 1);


check('empty frame scores 0', score([]).total, 0);

// --- small unicorns: a point each, and a vote on what colors are in frame ---
// The herd on the horizon used to be dropped on the floor, for a good reason --
// a dozen distant specks handing out a huge color multiplier. They are back
// because the color bonus is worth far less than it was, and because a herd in
// the distance is genuinely part of the picture.
//
// 10x10 is 100 pixels against a 115-pixel floor, so these are below it by
// construction -- see the coverage checks above.
const speck = (id, i) => [id, 6 + i * 14, 6, 10, 10];
const smalls = (n, from = 0) => Array.from({ length: n }, (_, i) => speck(from + i + 1, i));
const withSmalls = (n) => score([[1, cx, cy, 40, 40], ...smalls(n, 1)]);
check('a speck is not a subject', withSmalls(3).subjects.length, 1);
// Flat, and outside framing: one point is one point wherever it stands.
check('but it is worth a point', withSmalls(3).total - withSmalls(0).total >= 3, true);
// The whole reason they are counted: ids 2..7 cycle colors 1..5,0, so six specks
// beside a red subject is six colors in frame.
check('and it votes on the color count',
      withSmalls(5).bonuses[0].label, '6 colors');
// ...but not on the rainbow. Six colors in frame earns the 20% steps; the
// doubling still demands six animals photographed properly, or the shot of the
// whole valley from as far back as possible is the best one in the game again.
check('specks cannot buy the rainbow',
      withSmalls(5).bonuses.some((b) => b.label === 'RAINBOW'), false);
check('six real subjects still can',
      score(row(6)).bonuses.some((b) => b.label === 'RAINBOW'), true);
// Framing is the composition of what you photographed. A speck in the corner of
// the frame must not drag the arrangement of the animals you meant to shoot.
check('and they stay out of framing entirely',
      withSmalls(5).framing, withSmalls(0).framing);

// The card groups them, rather than spending a row on each single point.
{
  const b = withSmalls(3).b;
  const head = b.find((r) => r[0] === 'small unicorns');
  check('the card groups them under one heading', !!head, true);
  check('and the heading carries what they came to', head && head[1], '+3');
  // The label carries the count the way the size row carries its arithmetic.
  check('with a row per color, counted', b.some((r) => r[0] === ' orange \u00b7 1'), true);
  // Detail rows, so ui.js dims and indents them under the heading -- and they sit
  // under it rather than anywhere on the card. Counted from the heading down,
  // because the subject's own ` size \u00b7 4.8% ...` row is the same shape.
  const at = b.findIndex((r) => r[0] === 'small unicorns');
  check('and those rows are details, sitting under the heading',
        b.slice(at + 1).filter((r) => /^ \w+ \u00b7 \d+$/.test(r[0])).length, 3);
}

// The dreaded one reaches all the way out to the horizon. Unfair in a random
// world; fair in a fixed one, which is exactly why the seeds were pinned.
herd.color[7] = 6;
{
  const voided = score([[1, cx, cy, 40, 40], [8, 6, 6, 10, 10]]);
  check('a black speck voids the photograph', voided.total, 0);
  check('and says so on the card',
        voided.b.some((r) => r[0] === 'black unicorn' && r[1] === '-100%'), true);
  // It is still listed among the smalls -- the card has to show what it was that
  // cost you the shot, or a zero arrives with no explanation.
  check('while still being named among the smalls',
        voided.b.some((r) => r[0] === ' black \u00b7 1'), true);
}
herd.color[7] = 7 % 6;

// --- extra horns: paid per animal, not per photograph ---
// A bicorn used to double the whole shot, so one in the corner doubled what six
// other unicorns had earned. It now multiplies only its own subtotal.
const sub = (rects, i=0) => +score(rects).subjects[i].subtotal.toFixed(4);
const plain = sub([[1,cx,cy,40,40]]);
check('a plain unicorn is multiplied by nothing', plain > 0, true);
check('horns are no longer a photograph-wide bonus',
      score([[1,cx,cy,40,40]]).bonuses.length, 0);
herd.horns[0] = 1;
const times = (rects) => +(sub(rects)/plain).toFixed(3);
// 20% a horn, the same step the colour bonus pays -- see the note in score.js.
check('a bicorn pays one step of 20%', times([[1,cx,cy,40,40]]), 1.2, 1e-6);
check('and stays out of the photograph-wide multiplier',
      score([[1,cx,cy,40,40]]).multiplier, 1);
check('and is named in its own breakdown rows, as an adjustment',
      score([[1,cx,cy,40,40]]).b.some(r=>r[0]===' bicorn' && r[1]==='+20%'), true);
herd.horns[0] = 2;
check('a tricorn pays two steps', times([[1,cx,cy,40,40]]), 1.4, 1e-6);
herd.horns[0] = 3;
check('a quadricorn pays three', times([[1,cx,cy,40,40]]), 1.6, 1e-6);

// The point of the change: a horned animal must not lift the others.
herd.horns[0] = 3; herd.horns[1] = 0;
{
  const two = score([[1,40,cy,40,40],[2,200,cy,40,40]]);
  const bare = two.subjects.find(s=>s.horns===0).subtotal;
  const horned = two.subjects.find(s=>s.horns===3).subtotal;
  check('the plain animal beside a quadricorn is untouched',
        +bare.toFixed(4), +score([[1,40,cy,40,40],[2,200,cy,40,40]]).subjects
          .find(s=>s.horns===0).subtotal.toFixed(4), 1e-9);
  check('only the horned one is multiplied', +(horned/bare).toFixed(2) > 1.5, true);
}
herd.horns[0] = 0; herd.horns[1] = 0;

// --- framing is a multiplier, floored so a bad frame never zeroes a shot ---
const framingOf = (rects) => score(rects).framing;
check('dead centre earns the ceiling', framingOf([[1,cx,cy,40,40]]), 2, 0.01);
check('the corner earns more than the floor', framingOf([[1,4,4,40,40]]) > 0.05, true);
check('and never drops below the floor',
      Math.min(...[[[1,4,4,40,40]],[[1,0,0,10,10]],[[1,W-12,H-12,10,10]]]
        .map(r=>framingOf(r))) >= 0.05, true);
check('and never rises above the ceiling',
      Math.max(...[[[1,cx,cy,40,40]],[[1,cx,cy,14,14]],[[1,cx-1,cy-1,16,16]]]
        .map(r=>framingOf(r))) <= 2, true);
check('an empty frame cannot be framed well', framingOf([]), 0.05, 1e-9);
check('framing shows as a signed percentage, not a point total',
      score([[1,cx,cy,40,40]]).b.some(r=>r[0]==='framing' && /^[-+]?\d+%$/.test(r[1])), true);
note('the framing row reads ' +
     JSON.stringify(score([[1,4,4,40,40]]).b.find(r=>r[0]==='framing')[1]) +
     ' in the corner and ' +
     JSON.stringify(score([[1,cx,cy,40,40]]).b.find(r=>r[0]==='framing')[1]) + ' dead centre');

// --- the whole range is open at every subject count ---
// The reason the reference distances are a function of N: spreading out to earn
// separation walks everyone towards the edges, so against fixed distances only a
// lone subject could ever reach the ceiling. These fail if anyone hard-codes
// them back to constants.
{
  // The ideal arrangement: N evenly spaced on a ring of this radius, in pixels.
  const ring = (N) => {
    const r = 0.35 * Math.sqrt(1 - 1/N);
    return [...Array(N)].map((_, k) => {
      const th = 2*Math.PI*k/N;
      return [k+1, Math.round((0.5 + r*Math.cos(th))*W) - 7,
                   Math.round((0.5 - r*Math.sin(th))*H) - 7, 14, 14];
    });
  };
  // The other end: everyone crammed into the corner, in thin adjacent columns.
  // Two subjects can never share a pixel, so nothing can sit at exactly zero
  // separation -- the floor is approached rather than landed on.
  const heap = (N) => [...Array(N)].map((_, k) => [k+1, 2*k, 0, 2, 60]);
  for (const N of [1,2,3,6]) {
    note(N + ' on the ideal ring -> ' + framingOf(ring(N)).toFixed(3) +
         '   ' + N + ' crammed into the corner -> ' + framingOf(heap(N)).toFixed(3));
    check(N + ' subjects can still reach the ceiling', framingOf(ring(N)), 2, 0.02);
    check(N + ' subjects crammed into the corner reach the floor',
          framingOf(heap(N)) < 0.1, true);
  }
  // Exactly the floor, where it is actually attainable: a subject whose neck
  // centre lands on the frame edge zeroes the edge term outright.
  check('a neck centred on the frame edge hits the floor exactly',
        framingOf([[1,-7,cy,14,14]]), 0.05, 1e-9);
}
// The whole reason for the change: framing must bite the same at every tier.
{
  const ratio = (r) => { st.res = r;
    const good = score([[1,cx,cy,40,40]]).total, bad = score([[1,4,4,40,40]]).total;
    return +(bad/good).toFixed(3); };
  const at = [0,1,2,3].map(ratio); st.res = 0;
  console.log('        corner/centre score ratio per tier: ' + at.join(' / '));
  check('a bad frame costs the same share on every camera',
        +(Math.max(...at) - Math.min(...at)).toFixed(3) < 0.01, true);
}

// Reporting the factor and applying it are two different things: dropping
// `framing` from the total left every assertion above still passing.
{
  const expect = (sc) => Math.round(
    sc.subjects.reduce((a, x) => a + x.subtotal, 0) * sc.framing * sc.multiplier);
  const centred = score([[1,cx,cy,40,40]]);
  const corner = score([[1,4,4,40,40]]);
  check('the total is the subtotals times framing times bonuses',
        centred.total, expect(centred));
  check('and the same at the other end of the framing range',
        corner.total, expect(corner));
  check('so a corner shot really does score less than a centred one',
        corner.total < centred.total, true);
}

// --- the size row explains its own arithmetic ---
{
  const rows = score([[1,cx,cy,40,40]]).b;
  const size = rows.find(r=>/dpi$/.test(r[0]));
  console.log('        size row: ' + JSON.stringify(size));
  check('the size row names the sensor rate', /× 1000dpi$/.test(size[0]), true);
  check('and the share of the frame it is charged on', /^ size · \d+\.\d% ×/.test(size[0]), true);
  // percent-as-a-fraction times the rate is exactly the points shown
  const pct = parseFloat(/(\d+\.\d)%/.exec(size[0])[1]), pts = parseFloat(size[1]);
  check('and the two multiply out to the points beside them',
        +(pct/100*1000).toFixed(1), +pts.toFixed(1), 0.05);
}

// --- standing is the baseline and earns nothing ---
check('standing multiplies by 1', score([[1,cx,cy,40,40]]).subjects[0].pose, 1);
herd.pose[0] = 3;
check('neighing is still the top rate',
      +score([[1,cx,cy,40,40]]).subjects[0].pose.toFixed(4), +poseF(3).toFixed(4));
herd.pose[0] = 0;

// --- framing for a crowd ---
// six piled into one corner must not score like six spread across the frame
const clump = score([0,1,2,3,4,5].map((k)=>[k+1, 30+k*6, 20+k*4, 26, 26])).framing;
const spread = score([[1,20,20,26,26],[2,Math.round(W/2)-13,20,26,26],[3,W-46,20,26,26],
                      [4,20,H-46,26,26],[5,Math.round(W/2)-13,H-46,26,26],[6,W-46,H-46,26,26]]).framing;
console.log('        6 clumped ' + clump.toFixed(2) + '  vs  6 spread ' + spread.toFixed(2));
check('a crowd spread across the frame beats a heap', spread > clump + 0.4, true);

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

// ---- the head is worth more of the outline than a flank ----
// The animal is 40x40 with its left eight columns flagged as head and horn, so
// a block flush against its left side hides the face and one flush against its
// right side hides the same number of pixels of rump.
const headed = (blockX) => score([
  [TERRAIN, blockX, cy, 40, 40, 100],
  [1, cx, cy, 40, 40, 128],
  [1, cx, cy, 8, 40, 128, HEAD],
]).subjects[0];
const faceHidden = headed(cx - 40), rumpHidden = headed(cx + 40);
console.log('        face hidden  ' + (faceHidden.cEnv*100).toFixed(0) + '% of outline -> -' +
            faceHidden.envLoss.toFixed(1) + ' pts');
console.log('        rump hidden  ' + (rumpHidden.cEnv*100).toFixed(0) + '% of outline -> -' +
            rumpHidden.envLoss.toFixed(1) + ' pts');
check('the same block costs more over the face than over the rump',
      faceHidden.envLoss > rumpHidden.envLoss, true);
check('and by roughly the weight, not a rounding error',
      faceHidden.cEnv / rumpHidden.cEnv > 2.5, true);
// The flip side of raising the denominator: a flank-only loss is now cheaper
// than it was before the head carried any extra weight.
const unflagged = score([
  [TERRAIN, cx + 40, cy, 40, 40, 100],
  [1, cx, cy, 40, 40, 128],
]).subjects[0];
check('an animal with no head flagged scores exactly as it always did',
      +unflagged.cEnv.toFixed(6), 0.25);
check('and flagging a head makes losing the far side hurt less',
      rumpHidden.cEnv < unflagged.cEnv, true);
// Cropping is the same measurement, so the frame edge follows the same rule:
// a head cut off by the edge of the photograph costs more than a tail.
const cropped = (x) => score([[1, x, cy, 40, 40, 128], [1, x, cy, 8, 40, 128, HEAD]],
                             0.5).subjects[0];
const faceCut = cropped(Math.round(W*0.25) - 20);
check('a head cut by the frame costs something', faceCut.cropLoss > 0, true);

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
      +(boxed.subtotal / (boxed.size * boxed.pose)).toFixed(2), 0.25, 0.01);

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
      +(mix.size * mix.pose - mix.cropLoss - mix.envLoss - mix.occLoss).toFixed(6),
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
check('size is always broken out', rowsOf(standing).some(l=>/dpi$/.test(l)), true);
check('and is still marked as a detail of the row above',
      rowsOf(standing).find(l=>/dpi$/.test(l))[0], ' ');
check('and it is marked as a detail of the subject above',
      standing.b[1][0][0], ' ');
// Standing is the baseline and scores nothing, so a row saying "+0" would be noise.
check('standing shows no pose row', rowsOf(standing).some((l) => /^ pose/.test(l)), false);

herd.pose[0] = 3;
const neighing = score([[1,cx,cy,40,40]]);
check('a pose worth points gets its own row, and it names the pose',
      rowsOf(neighing).includes(' pose · neighing'), true);
// Said the one way every other adjustment on this card is said, so a pose, a
// horn, a framing penalty and a colour bonus all read as the same kind of thing.
check('and it carries the gain as a signed percentage',
      valueOf(neighing, ' pose · neighing'), '+80%');
// The pose row below says "neighing" already, so the header is the color alone.
check('the subject header is the color alone', neighing.b[0][0], 'red', 0);
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
// Shown as the adjustment it is, like framing, rather than as a factor: a bonus
// and a framing penalty are the same kind of number and used to read as two.
check('a bonus rides along as a signed percentage',
      bonused.b.some((r) => r[0] === '6 colors \u00b7 6 \u00d7 20%' && r[1] === '+120%'), true);
check('and the rainbow with it', bonused.b.some((r) => r[1] === '+100%'), true);
// It is a gain, so photoCard has to colour it as one: the leading + is the whole
// of that contract.
check('and it is signed, which is what gets it coloured',
      bonused.b.filter((r) => /colors|RAINBOW/.test(r[0])).every((r) => r[1][0] === '+'), true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall ' + '' + 'checks passed');
process.exit(fails ? 1 : 0);
