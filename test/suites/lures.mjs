// Do attractors actually gather unicorns, and do repellents scatter them?
import { buildWorld } from '../.mirror/terrain.mjs';
import { spawn, updateHerd } from '../.mirror/unicorn.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35,
              trackRadiusFrac:.25, unicornDensity:.003, adultChance:.75, driftChance:.08,
              poseWeights:[.80,.10,.08,.02], weakRadius:26, strongRadius:70, lureLife:22, lurePull:0.7, lureSpeed:4, lureGather:5 };
const w = buildWorld(12345, cfg);

let fails = 0;
const check = (n, got, want) => { const ok = got === want; if(!ok) fails++;
  console.log((ok?'  ok  ':'FAIL  ') + n.padEnd(52), String(got).padStart(7), ok?'':'(expected '+want+')'); };

// Mean distance from a point, for unicorns that start within the lure radius.
function meanDist(h, idx, x, z) {
  let s = 0; for (const i of idx) s += Math.hypot(h.x[i]-x, h.z[i]-z);
  return s / idx.length;
}
function run(lures, x, z, colourFilter) {
  const h = spawn(w, cfg, 12345);
  for (let i=0;i<300;i++) updateHerd(h, w, cfg, 1/60, []);   // settle
  const idx = [];
  for (let i=0;i<h.n;i++) {
    if (Math.hypot(h.x[i]-x, h.z[i]-z) < cfg.weakRadius &&
        (colourFilter === undefined || h.color[i] === colourFilter)) idx.push(i);
  }
  const before = meanDist(h, idx, x, z);
  for (let i=0;i<60*40;i++) updateHerd(h, w, cfg, 1/60, lures);
  return { n: idx.length, before, after: meanDist(h, idx, x, z) };
}

// pick a spot with unicorns around it
let X=0, Z=0, best=0;
{
  const h = spawn(w, cfg, 12345);
  for (let i=0;i<h.n;i++) {
    let n=0; for (let j=0;j<h.n;j++) if (Math.hypot(h.x[i]-h.x[j], h.z[i]-h.z[j]) < 26) n++;
    if (n>best) { best=n; X=h.x[i]; Z=h.z[i]; }
  }
}
console.log('  test site (' + X.toFixed(0) + ',' + Z.toFixed(0) + ') with ' + best + ' unicorns in radius\n');

const none = run([], X, Z);
console.log('  no lure      : mean dist ' + none.before.toFixed(1) + ' -> ' + none.after.toFixed(1) + '  (' + none.n + ' tracked)');
const att = run([{x:X, z:Z, strong:true, until:1e9}], X, Z);
console.log('  strong lure  : mean dist ' + att.before.toFixed(1) + ' -> ' + att.after.toFixed(1));
const weak = run([{x:X, z:Z, strong:false, until:1e9}], X, Z);
console.log('  weak lure    : mean dist ' + weak.before.toFixed(1) + ' -> ' + weak.after.toFixed(1));
console.log('');
check('a strong lure pulls unicorns closer than no lure', att.after < none.after, true);
check('a weak lure gathers too', weak.after < none.after, true);
// Both lures pull their catch into the same gather radius, so the final mean
// distance cannot tell them apart -- reach shows up in how many are drawn in.
function gathered(lures) {
  const h = spawn(w, cfg, 12345);
  for (let i=0;i<300;i++) updateHerd(h, w, cfg, 1/60, []);
  for (let i=0;i<60*45;i++) updateHerd(h, w, cfg, 1/60, lures);
  let n = 0;
  for (let i=0;i<h.n;i++) if (Math.hypot(h.x[i]-X, h.z[i]-Z) < 12) n++;
  return n;
}
const gStrong = gathered([{x:X, z:Z, strong:true, until:1e9}]);
const gWeak = gathered([{x:X, z:Z, strong:false, until:1e9}]);
console.log('  gathered within 12 units: strong ' + gStrong + ', weak ' + gWeak);
check('the strong lure draws in more than the weak one', gStrong > gWeak * 1.5, true);
check('attracted unicorns move in at all', att.after < att.before, true);
check('attracted unicorns gather, not stack (3-9 units out)',
      att.after > 3 && att.after < 9, true);

// Colour selectivity. The herd shares one RNG stream, so as soon as greens start
// taking the lure branch they consume extra draws and every later unicorn walks
// differently -- a single trial cannot separate that from real attraction.
// Averaging many spawn seeds leaves the coupling as noise around zero while real
// attraction would show as a consistent pull.
function trial(seed, lures, x, z, colour) {
  const h = spawn(w, cfg, seed);
  for (let i=0;i<300;i++) updateHerd(h, w, cfg, 1/60, []);
  const idx = [];
  for (let i=0;i<h.n;i++)
    if (Math.hypot(h.x[i]-x, h.z[i]-z) < cfg.weakRadius && h.color[i] === colour) idx.push(i);
  if (!idx.length) return null;
  const before = meanDist(h, idx, x, z);
  for (let i=0;i<60*40;i++) updateHerd(h, w, cfg, 1/60, lures);
  return { n: idx.length, delta: meanDist(h, idx, x, z) - before };
}

const SEEDS = [1,2,3,4,5,6,7,8,9,10,11,12];
function sweep(lureColour, subjectColour) {
  const lures = lureColour === null ? [] : [{x:X, z:Z, strong:true, until:1e9}];
  let sum = 0, n = 0, animals = 0;
  for (const s of SEEDS) {
    const t = trial(s, lures, X, Z, subjectColour);
    if (t) { sum += t.delta; n++; animals += t.n; }
  }
  return { mean: sum/n, trials: n, animals };
}

console.log('\n  mean change in distance to the lure spot, over ' + SEEDS.length + ' spawn seeds:');
const gg = sweep(3, 3), gy = sweep(3, 2), ny = sweep(null, 2), ng = sweep(null, 3);
const fmt = (r) => (r.mean>0?'+':'') + r.mean.toFixed(1) + '  (' + r.animals + ' animals over ' + r.trials + ' trials)';
console.log('    greens,  green attractor : ' + fmt(gg));
console.log('    greens,  no lure         : ' + fmt(ng));
console.log('    yellows, green attractor : ' + fmt(gy));
console.log('    yellows, no lure         : ' + fmt(ny));
console.log('');
check('a lure pulls in the colour nearest it', gg.mean < -5, true);
check('greens barely move without a lure (control)', Math.abs(ng.mean) < 5, true);
// The opposite of the old assertion: lures are colour-agnostic now, so a lure
// must move colours it was never "aimed at".
check('a lure also pulls in every other colour', gy.mean < ny.mean - 3, true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
