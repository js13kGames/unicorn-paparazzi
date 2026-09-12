// Monte Carlo of a whole run, to answer "how many rides does a player get, and
// is every upgrade worth its price?".
//
// Three stages, split because only the first one is slow:
//
//   A  Sample real photographs. Walk the lap, aim the camera several ways at
//      each stop, rasterise the ID pass and run the real `tally`. What gets
//      cached is the raw tally output -- pixel counts and outline sums -- not a
//      score, so stage B can re-score the same photograph for any sensor tier
//      without rendering it again. ~100ms a shot, so this is cached to disk.
//   B  Score. `scorePhoto` runs verbatim over the cached tallies, which is what
//      keeps the sim from drifting away from the shipped rubric.
//   C  Play the economy. Buy film, ride, bank the take, shop, repeat until the
//      dead end in index.js -- thousands of times, over three skill bands.
//
// Usage:  node test/tools/economy.mjs            # report
//         node test/tools/economy.mjs --resample # throw the cache away first
//
// Stage A forks one child per seed, because scene.mjs fixes its seed at import.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '..', '.cache');
const SEEDS = [12345, 777, 42];

// --- the shipped numbers, lifted from src/index.js so they cannot drift ------
// CONFIG and the shop ladders are read out of the source rather than copied, the
// mistake every other tool in here made.
const SRC = readFileSync(join(HERE, '..', '..', 'src', 'index.js'), 'utf8');
const lift = (re, what) => {
  const m = re.exec(SRC);
  if (!m) throw new Error('could not lift ' + what + ' out of src/index.js');
  return m[1];
};
const CONFIG = (0, eval)('(' + lift(/export const CONFIG = (\{[\s\S]*?\n\});/, 'CONFIG') + ')');
const FILM = +lift(/const FILM = (\d+);/, 'FILM');
const RIDE_SECONDS = +lift(/const RIDE_SECONDS = (\d+);/, 'RIDE_SECONDS');
// The shape of the cost curve, lifted too -- `** 2` in the source has to be a 2
// here or every run length the sim reports is measured against the wrong game.
const FILM_POW = /state\.rides \|\| 1\) \*\* (\d+(?:\.\d+)?)/.exec(SRC);
// The ladder table names CONFIG.*, so it has to be evaluated somewhere CONFIG is
// in scope -- hence the direct eval rather than the indirect one used above.
const ladders = ((C) =>
  eval(lift(/const LADDERS = (\[[\s\S]*?\n\]);/, 'LADDERS').replace(/CONFIG\./g, 'C.'))
    .map(([label, v, p, key]) => ({ label, v, p, key })))(CONFIG);

const START = { bank: 0, film: 10, rides: 0, maxZoom: 1, res: 0, shutterTier: 0, cartTier: 0 };
const TUNE = { film: FILM, pow: FILM_POW ? +FILM_POW[1] : 1, res: 1 };
const priceOf = (rides) => TUNE.film * (rides || 1) ** TUNE.pow;

// ---------------------------------------------------------------------------
// Stage A -- sample photographs
// ---------------------------------------------------------------------------

const VANTAGES = 48;   // stops around the lap
const AIMS = 5;        // camera directions tried at each stop

async function sampleSeed(seed) {
  process.env.SEED = String(seed);
  const scene = await import('./scene.mjs');
  const { tally } = await import('../.mirror/photo.mjs');
  const { pathAt } = await import('../.mirror/terrain.mjs');
  const { world, herd, W, H } = scene;

  const out = { seed, lapLength: world.path.length, zooms: {} };
  for (const zoom of CONFIG.zoomLevels) {
    const pool = [];
    for (let vi = 0; vi < VANTAGES; vi++) {
      const d = (vi / VANTAGES) * world.path.length;
      const p = pathAt(world.path, d);
      const a = pathAt(world.path, d), b = pathAt(world.path, d + 4);
      const heading = Math.atan2(-(b.x - a.x), -(b.z - a.z));

      // Aim candidates: the nearest animal, then a spread around the lap. A
      // player never gets to try five framings of the same instant, but the
      // skill bands below pick among them, which is exactly what a player's eye
      // is doing when it decides where to point.
      let best = -1, bd = 1e9;
      for (let u = 0; u < herd.n; u++) {
        const dd = Math.hypot(herd.x[u] - p.x, herd.z[u] - p.z);
        if (dd < bd && dd > 4) { bd = dd; best = u; }
      }
      const aims = [];
      if (best >= 0) {
        aims.push(Math.atan2(-(herd.x[best] - p.x), -(herd.z[best] - p.z)) - heading);
      }
      while (aims.length < AIMS) aims.push((aims.length / AIMS) * Math.PI * 2);

      for (const yawOff of aims) {
        const ids = scene.shot(d, -0.06, yawOff, true, zoom);
        // readPixels is bottom-up; the rasteriser is top-down, so flip to match.
        const px = new Uint8Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const s0 = (H - 1 - y) * W + x, dst = (y * W + x) * 4;
          px[dst] = ids.px[s0 * 3]; px[dst + 1] = ids.px[s0 * 3 + 1]; px[dst + 3] = ids.parts[s0];
        }
        const subs = [];
        for (const [id, s] of tally(px, W, H, herd)) {
          // Everything scorePhoto reads, and nothing derived -- so the sensor
          // tier can still be varied later.
          if (s.pose === undefined || s.horns === undefined || s.color === undefined) {
            process.stderr.write('  !! id ' + id + ' is not in the herd; dropped\n');
            continue;
          }
          subs.push([id, { n: s.n, sx: s.sx, sy: s.sy, nx: s.nx, ny: s.ny, nn: s.nn,
                           outline: s.outline, edge: s.edge, env: s.env, occ: s.occ,
                           color: s.color, pose: s.pose, horns: s.horns }]);
        }
        pool.push(subs);
      }
    }
    out.zooms[zoom] = pool;
    process.stderr.write('  seed ' + seed + ' zoom ' + zoom + 'x: ' + pool.length + ' shots\n');
  }
  out.w = W; out.h = H;
  return out;
}

function loadSamples(resample) {
  if (resample && existsSync(CACHE)) rmSync(CACHE, { recursive: true });
  mkdirSync(CACHE, { recursive: true });
  return SEEDS.map((seed) => {
    const file = join(CACHE, 'economy-' + seed + '.json');
    if (!existsSync(file)) {
      process.stderr.write('sampling seed ' + seed + ' (one-off, ~1 min)\n');
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--sample', String(seed), file],
                   { stdio: ['ignore', 'inherit', 'inherit'] });
    }
    return JSON.parse(readFileSync(file, 'utf8'));
  });
}

// ---------------------------------------------------------------------------
// Stage B -- score a cached photograph at a given sensor tier
// ---------------------------------------------------------------------------

const { scorePhoto } = await import('../.mirror/score.mjs');

function scoreShot(sample, subs, res) {
  const cfg = { ...CONFIG, resBonus: CONFIG.resBonus.map((v) => v * TUNE.res) };
  return scorePhoto({ url: '', w: sample.w, h: sample.h, subjects: new Map(subs) },
                    cfg, { res }).total;
}

// Every shot in the pool, scored at every sensor tier, once -- kept grouped by
// vantage, because aiming and firing are two different decisions and the skill
// bands below model them separately.
function buildTable(samples) {
  const t = {};
  for (const zoom of CONFIG.zoomLevels) {
    t[zoom] = CONFIG.resBonus.map((_, res) => {
      const stops = [];
      for (const s of samples) {
        for (let i = 0; i < s.zooms[zoom].length; i += AIMS) {
          stops.push(s.zooms[zoom].slice(i, i + AIMS).map((subs) => scoreShot(s, subs, res)));
        }
      }
      return stops;
    });
  }
  return t;
}

// ---------------------------------------------------------------------------
// Stage C -- play the economy
// ---------------------------------------------------------------------------

const mulberry = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// How many shutter-ready moments a lap offers. This is the quiet lever behind
// three of the four ladders: a player with more opportunities than film can
// afford to wait for a good one, and that selectivity is worth real points.
// A ride is a fixed span of seconds, so the shutter alone sets how many frames
// you get a chance at -- the cart no longer takes chances away by ending sooner.
const opportunities = (st) => RIDE_SECONDS / CONFIG.shutterTiers[st.shutterTier];

// Every photograph is banked, so there is never a reason to hold fire when film
// is plentiful -- selectivity only buys anything while film is the scarce side.
// And the chances are not independent: two frames 0.8s apart on the same stretch
// of track are the same photograph twice. The scene turns over about every
// SCENE units of track, which is the granularity stage A actually sampled at,
// and that -- not the shutter -- is the ceiling on how choosy anyone can be.
// ...and it turns over more slowly the longer the lens, because a distant animal
// stays in shot for as long as it takes the cart to change its bearing. Reach
// grows with zoom, so the decorrelation distance does too.
// ...and it turns over more slowly the longer the lens, because a distant animal
// stays in shot for as long as it takes the cart to change its bearing. Reach
// grows with zoom, so the decorrelation distance does too.
//
// This is where the drive train earns its money: ground covered is cart speed
// times ride length, so a faster cart passes more country and therefore more
// genuinely different photographs, without costing a single frame.
const SCENE = 18;
const distinct = (st, zoom) =>
  (RIDE_SECONDS * CONFIG.cartTiers[st.cartTier]) / (SCENE * zoom);

// A skill band is two habits, not one number.
//   aims  how many framings of a moment the player's eye considers before
//         shooting -- 1 is "point it forwards and hope".
//   grip  how much of the theoretically-available selectivity they realise.
//         A player with ten frames and a hundred chances *could* shoot only the
//         best tenth; grip 1 does exactly that, grip 0 fires on cooldown at
//         whatever is in front of the lens.
// Nobody sits at either end of that range. A first-timer still declines to spend
// a frame on an empty hillside, and even an expert is guessing at what the next
// bend holds -- grip 1 would be perfect foresight, which no player has.
const BANDS = {
  low:    { aims: 1, grip: 0.2 },
  median: { aims: 2, grip: 0.55 },
  high:   { aims: AIMS, grip: 0.85 },
};
// Aim 0 of each stop is the shot at the nearest animal; aims 1.. are bearings
// the player could have swung to instead. Everyone takes aim 0 -- even a
// beginner points at a unicorn -- and the band says how many alternatives they
// weigh against it.

// The distribution of what one moment is worth to this band, sorted. Built once
// per (zoom, res, band) and then only ever sampled by quantile.
const momentCache = new Map();
function moments(table, zoom, res, band) {
  const key = zoom + '/' + res + '/' + band;
  let m = momentCache.get(key);
  if (m) return m;
  const stops = table[zoom][res], n = BANDS[band].aims;
  const out = [];
  const rnd = mulberry(0x51ed | (res << 8));
  for (const stop of stops) {
    for (let r = 0; r < 8; r++) {
      let best = stop[0];
      for (let k = 1; k < n; k++) {
        const v = stop[1 + ((rnd() * (stop.length - 1)) | 0)];
        if (v > best) best = v;
      }
      out.push(best);
    }
  }
  out.sort((a, b) => a - b);
  momentCache.set(key, out);
  return out;
}

// The share of moments this band actually waits for. Perfect play shoots only
// the best `film / opportunities` of them; grip interpolates towards that on a
// log scale, so a half-skilled player is genuinely half as choosy.
function share(st, band) {
  const chances = Math.min(opportunities(st), distinct(st, CONFIG.zoomLevels[st.maxZoom]));
  const frames = Math.min(Math.max(st.film, 1), Math.floor(opportunities(st)));
  const perfect = Math.min(1, frames / Math.max(1, chances));
  return Math.exp(Math.log(perfect) * BANDS[band].grip);
}

function ride(st, table, rnd, band) {
  const m = moments(table, CONFIG.zoomLevels[st.maxZoom], st.res, band);
  const shots = Math.min(st.film, Math.max(1, Math.floor(opportunities(st))));
  const s = share(st, band);
  let take = 0;
  for (let i = 0; i < shots; i++) {
    // A shot the player chose to take is drawn from the top `s` of moments.
    const q = 1 - rnd() * s;
    take += m[Math.min(m.length - 1, Math.floor(q * m.length))];
  }
  st.film -= shots;
  return take;
}

// Mean take of a ride under this loadout: the mean of the top `s` of moments,
// times the frames shot. Used to rank shop rungs and to report marginal value.
function expected(st, table, band) {
  const m = moments(table, CONFIG.zoomLevels[st.maxZoom], st.res, band);
  const shots = Math.min(Math.max(st.film, 1), Math.max(1, Math.floor(opportunities(st))));
  const s = share(st, band);
  const from = Math.min(m.length - 1, Math.floor((1 - s) * m.length));
  let acc = 0;
  for (let i = from; i < m.length; i++) acc += m[i];
  return (acc / (m.length - from)) * shots;
}

// Greedy on marginal points per dollar, measured rather than assumed: try each
// affordable rung, see what a ride would earn with it, keep the best rate.
function shop(st, table, band) {
  for (;;) {
    const baseline = expected(st, table, band);
    const keep = st.film ? 0 : priceOf(st.rides);
    let pick = null, bestRate = 0;
    for (const l of ladders) {
      const price = l.p[st[l.key]];
      if (!price || st.bank - price < keep) continue;
      const trial = { ...st, [l.key]: st[l.key] + 1 };
      const rate = (expected(trial, table, band) - baseline) / price;
      if (rate > bestRate) { bestRate = rate; pick = l; }
    }
    if (!pick) break;
    st.bank -= pick.p[st[pick.key]];
    st[pick.key]++;
    st.spent[pick.label] = (st.spent[pick.label] || 0) + 1;
  }
  // Whatever is left becomes film, which is the only thing left to want.
  const p = priceOf(st.rides);
  const buy = Math.floor(st.bank / p);
  st.film += buy;
  st.bank -= buy * p;
}

function playRun(table, seed, band) {
  const rnd = mulberry(seed);
  const st = { ...START, spent: {} };
  const income = [];
  for (let guard = 0; guard < 400; guard++) {
    if (!st.film && st.bank < priceOf(st.rides)) break;     // the dead end
    if (!st.film) shop(st, table, band);
    if (!st.film) break;
    income.push(ride(st, table, rnd, band));
    st.bank += income[income.length - 1];
    st.rides++;
    shop(st, table, band);
  }
  return { rides: st.rides, income, spent: st.spent, st };
}

// ---------------------------------------------------------------------------

const pct = (a, q) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))];
const fmt = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));

async function main() {
  const samples = loadSamples(process.argv.includes('--resample'));
  const table = buildTable(samples);

  console.log('\n=== shot value (points per photograph) ===');
  console.log('zoom'.padEnd(6) + ['dpi ' + CONFIG.resBonus[0], 'dpi ' + CONFIG.resBonus[3]]
    .map((h) => h.padStart(22)).join(''));
  console.log(' '.repeat(6) + ['p50    p90    p99', 'p50    p90    p99']
    .map((h) => h.padStart(22)).join(''));
  for (const zoom of CONFIG.zoomLevels) {
    let row = (zoom + '×').padEnd(6);
    for (const res of [0, 3]) {
      const v = table[zoom][res].flat();
      row += (fmt(pct(v, .5)).padStart(7) + fmt(pct(v, .9)).padStart(7) + fmt(pct(v, .99)).padStart(8));
    }
    console.log(row);
  }

  console.log('\n=== subjects in frame, and colour variety, by zoom ===');
  for (const zoom of CONFIG.zoomLevels) {
    const counts = [];
    const colors = [];
    for (const s of samples) for (const subs of s.zooms[zoom]) {
      const big = subs.filter(([, x]) => x.n / (s.w * s.h) >= CONFIG.minCoverage);
      counts.push(big.length);
      colors.push(new Set(big.map(([, x]) => x.color)).size);
    }
    const rate = (k) => (100 * colors.filter((c) => c >= k).length / colors.length).toFixed(1) + '%';
    console.log((zoom + '×').padEnd(6) + 'mean subjects ' + (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2).padStart(5) +
      '   2+ colours ' + rate(2).padStart(6) + '   3+ ' + rate(3).padStart(6) +
      '   6 (RAINBOW) ' + rate(6).padStart(6));
  }

  console.log('\n=== runs (1000 per band) ===');
  for (const band of Object.keys(BANDS)) {
    const runs = [];
    for (let i = 0; i < 1000; i++) runs.push(playRun(table, i * 7919 + 1, band));
    const r = runs.map((x) => x.rides);
    console.log(band.padEnd(8) + 'rides  p10 ' + pct(r, .1) + '   median ' + pct(r, .5) +
      '   p90 ' + pct(r, .9) + '   max ' + Math.max(...r));
    const med = runs.sort((a, b) => a.rides - b.rides)[500];
    console.log('        median run income per ride: ' + med.income.map(fmt).join(', '));
    console.log('        bought: ' + (Object.keys(med.spent).length
      ? Object.entries(med.spent).map(([k, v]) => k + '×' + v).join(', ') : 'nothing'));
  }

  console.log('\n=== what each rung is worth, and what it should cost ===');
  // Measured at a mid-run loadout rather than a fresh one: nobody is deciding
  // between the $3200 lens and a roll of film on their first ride, and a rung's
  // worth depends on the gear around it. Prices are then set so every ladder
  // returns about the same points per dollar -- which is the whole definition of
  // "no dead buys".
  {
    // Mid-run gear, including a drive train. That last part matters: the motor
    // drive is worth nothing behind a slow cart, because the scenery does not
    // turn over fast enough to be worth more frames a second. Cart first, then
    // speed, is a real order of purchase and not an artefact.
    const mid = { ...START, film: 12, maxZoom: 2, res: 1, shutterTier: 1, cartTier: 2 };
    const rows = [];
    for (const l of ladders) {
      for (let tier = 0; tier < l.p.length; tier++) {
        if (!l.p[tier]) continue;
        const a = { ...mid, [l.key]: tier }, b = { ...mid, [l.key]: tier + 1 };
        rows.push({ l, tier, price: l.p[tier],
                    gain: expected(b, table, 'median') - expected(a, table, 'median') });
      }
    }
    // One rate for the whole shop: hold the total cost of maxing everything where
    // it is, and redistribute it in proportion to what each rung actually buys.
    const totalPrice = rows.reduce((x, r) => x + r.price, 0);
    const totalGain = rows.reduce((x, r) => x + Math.max(0, r.gain), 0);
    const round = (n) => n < 1000 ? Math.round(n / 50) * 50 : Math.round(n / 100) * 100;
    for (const l of ladders) {
      const mine = rows.filter((r) => r.l === l);
      console.log(l.label.padEnd(7) + mine.map((r) =>
        '$' + r.price + '→$' + (r.gain <= 0 ? '?' : round(totalPrice * Math.max(0, r.gain) / totalGain)) +
        ' (' + fmt(r.gain) + '/ride)').join('  '));
    }
    console.log('       total shop cost $' + totalPrice + ', held constant');
  }
  console.log('\n=== marginal value of each rung, fresh loadout, median player ===');
  const st0 = { ...START };
  for (const l of ladders) {
    const parts = [];
    for (let tier = 0; tier < l.p.length; tier++) {
      const price = l.p[tier];
      if (!price) continue;
      const a = { ...st0, [l.key]: tier }, b = { ...st0, [l.key]: tier + 1 };
      const gain = expected(b, table, 'median') - expected(a, table, 'median');
      parts.push('$' + price + ' → ' + fmt(gain) + '/ride (' + (gain / price).toFixed(2) + ' pts/$)');
    }
    console.log(l.label.padEnd(7) + parts.join('   '));
  }
  samplesRef = samples;
  if (process.argv.includes('--sweep')) sweep(table);
  console.log('');
}

// --- sweep ------------------------------------------------------------------
// The run length that matters is the median band's. Try cost curves against it
// and print the grid; the target is low ~4, median 6, high ~10.
let samplesRef = null;
function sweep(table) {
  const runsFor = (t, band) => {
    const r = [];
    for (let i = 0; i < 300; i++) r.push(playRun(t, i * 7919 + 1, band).rides);
    return pct(r, .5);
  };
  console.log('\n=== sweep: sensor scale × cost curve (median rides per band) ===');
  console.log('setting'.padEnd(30) + 'low'.padStart(6) + 'median'.padStart(8) + 'high'.padStart(6));
  const RES = (process.env.SW_RES || '1').split(',').map(Number);
  const POW = (process.env.SW_POW || '1,1.5,2').split(',').map(Number);
  const FILMS = (process.env.SW_FILM || '100,400,1600,6400').split(',').map(Number);
  for (const res of RES) {
    for (const pow of POW) {
      for (const film of FILMS) {
        TUNE.res = res; TUNE.film = film; TUNE.pow = pow;
        momentCache.clear();
        const t = buildTable(samplesRef);
        const row = ['low', 'median', 'high'].map((b) => String(runsFor(t, b)));
        const runs = [];
        for (let i = 0; i < 300; i++) runs.push(playRun(t, i * 7919 + 1, 'median'));
        const med = runs.sort((a, b) => a.rides - b.rides)[150];
        console.log(('dpi×' + res + '  $' + film + ' × r^' + pow).padEnd(30) +
          row[0].padStart(6) + row[1].padStart(8) + row[2].padStart(6) +
          '   ' + med.income.slice(0, 8).map(fmt).join(' ') +
          '  [' + (Object.entries(med.spent).map(([k, v]) => k + '×' + v).join(' ') || '-') + ']');
      }
    }
  }
  TUNE.film = FILM; TUNE.pow = FILM_POW ? +FILM_POW[1] : 1; TUNE.res = 1; momentCache.clear();
}

if (process.argv[2] === '--sample') {
  const [, , , seed, file] = process.argv;
  writeFileSync(file, JSON.stringify(await sampleSeed(+seed)));
} else {
  await main();
}
