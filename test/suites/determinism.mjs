// Two players are meant to ride the same ride from the same seed and compare
// photographs, which only works if the herd is a function of the TICK COUNT and
// nothing else.
//
// It used to be a function of frame cadence. updateHerd draws from one RNG stream
// shared by the whole herd, from inside dt-gated branches -- `h.hold[i] -= dt`
// then two draws when it crosses zero, `h.step[i] += dt / STEP_TIME` then draws
// per step -- so a different frame rate consumed a different NUMBER of draws in a
// different ORDER, and every unicorn diverged, not just one.
//
// These checks pin both halves: the frame loop turns any wall clock into a fixed
// number of ticks, and a fixed number of ticks always lands the same herd. The
// negative controls matter as much as the positive ones -- a determinism test
// that cannot fail is worthless.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { buildWorld } from '../.mirror/terrain.mjs';
import { spawn, updateHerd } from '../.mirror/unicorn.mjs';

const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(56),
              ok ? '' : '-> ' + JSON.stringify(got));
};

const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35,
              trackRadiusFrac:.25, unicornDensity:.003, driftChance:.08,
              poseWeights:[.80,.10,.08,.02],
              cartSpeed:8 };
const w = buildWorld(4242, cfg);

// --- the shipped frame loop, driven by a fake clock -----------------------
// The accumulator and its while-loop are lifted verbatim out of src/index.js, so
// this cannot drift from what runs in the browser.
const STEP = eval(/const STEP = ([^;]+);/.exec(src)[1]);
const accLine = /^\s*(acc \+= Math\.min\([^\n]+)$/m.exec(src);
const whileLine = /^\s*(while \(state\.mode[^\n]+)$/m.exec(src);
check('the accumulator line is still in index.js', !!accLine, true);
check('the fixed-step while loop is still in index.js', !!whileLine, true);
check('STEP is a 60Hz tick', +(1 / STEP).toFixed(6), 60);

const drive = new Function('times', 'state', 'STEP', 'tick', `
  let acc = 0, last = 0;
  for (const now of times) {
    ${accLine[1]}
    last = now;
    ${whileLine[1]}
  }
  return acc;
`);

// Turn a list of frame durations (ms) into the timestamps rAF would hand over.
const stamps = (durs) => { let t = 0; return durs.map((d) => (t += d)); };
const ticksFor = (durs) => {
  let n = 0;
  drive(stamps(durs), { mode: 'ride' }, STEP, () => n++);
  return n;
};

// A repeating pattern of frame durations adding up to exactly `total` ms.
const pattern = (total, cycle) => {
  const out = [];
  for (let t = 0, i = 0; t < total; i++) {
    const d = Math.min(cycle[i % cycle.length], total - t);
    out.push(d); t += d;
  }
  return out;
};

const TOTAL = 10000;                                       // ten seconds of riding
const steady = ticksFor(pattern(TOTAL, [1000 / 60]));               // a clean 60fps
const fast = ticksFor(pattern(TOTAL, [1000 / 120]));                // 120fps
const jitter = ticksFor(pattern(TOTAL, [33.3, 8.3, 22.2, 25.5]));   // a bad day
console.log('        ticks in 10s -- 60fps ' + steady + ', 120fps ' + fast + ', jittery ' + jitter);

// Within one tick, not exactly equal: the accumulator carries a fractional
// remainder, so a client can sit one tick behind for a frame. That is harmless
// because the ride ends on a tick count, not on a wall-clock time -- both players
// traverse the identical tick sequence, at worst a frame apart. What would break a
// match is a systematic drift, which is what these bounds catch.
const near = (a, b) => Math.abs(a - b) <= 1;
check('60fps and 120fps agree on the tick count', near(steady, fast), true);
check('and so does a jittery frame rate', near(jitter, steady), true);
check('ten seconds is six hundred ticks', steady >= 599 && steady <= 600, true);

// The cap is a real limit, not an oversight: frames longer than it lose ticks.
const stalled = ticksFor(Array(10).fill(1000));
console.log('        a stalled client (10 x 1000ms) runs only ' + stalled + ' ticks');
check('a long stall drops ticks, which a match would have to resync', stalled < steady, true);

// --- a fixed number of ticks always lands the same herd -------------------
const hash = (h) => {
  let a = 2166136261;
  const mix = (v) => { a = Math.imul(a ^ (Math.round(v * 4096) | 0), 16777619) >>> 0; };
  for (let i = 0; i < h.n; i++) {
    mix(h.x[i]); mix(h.z[i]); mix(h.pose[i]); mix(h.phase[i]); mix(h.step[i]); mix(h.hold[i]);
  }
  return a;
};

function run(steps) {
  const h = spawn(w, cfg, 4242);
  for (let n = 0; n < steps; n++) updateHerd(h, w, cfg, STEP);
  return hash(h);
}

const plain = run(600);
check('the same tick count lands the same herd', run(600), plain);
check('a different tick count does not', run(601) !== plain, true);
// End to end, through the real loop text: two clients on wildly different frame
// rates, each stopped at the same tick, must hold the identical herd. This is the
// actual promise made to a networked match -- the guarantee is per TICK, not per
// wall-clock second, since a client can be a tick behind for a frame.
function rideTo(durs, target) {
  const h = spawn(w, cfg, 4242);
  let n = 0;
  drive(stamps(durs), { mode: 'ride' }, STEP, () => {
    if (n < target) { updateHerd(h, w, cfg, STEP); n++; }
  });
  return { at: n, hash: hash(h) };
}
const slow = rideTo(pattern(TOTAL, [1000 / 60]), 500);
const quick = rideTo(pattern(TOTAL, [1000 / 240]), 500);
const nasty = rideTo(pattern(TOTAL, [50, 4, 31.5, 9.2, 120]), 500);
check('every client reached the target tick', slow.at === 500 && quick.at === 500 && nasty.at === 500, true);
check('60fps and 240fps hold the same herd at tick 500', quick.hash, slow.hash);
check('and so does a client with a terrible frame rate', nasty.hash, slow.hash);

// The old behaviour, kept as the control: variable dt over the same total time.
function drifted(steps) {
  const h = spawn(w, cfg, 4242);
  const jit = [1 / 30, 1 / 120, 1 / 45, 1 / 90];
  let t = 0, i = 0;
  while (t < steps * STEP) { const dt = jit[i++ % 4]; updateHerd(h, w, cfg, dt); t += dt; }
  return hash(h);
}
check('wall-clock dt over the same ten seconds diverges (the old bug)',
      drifted(600) !== plain, true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
