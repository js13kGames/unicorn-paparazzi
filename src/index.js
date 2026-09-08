import { buildWorld, pathAt, elevAt } from './terrain.js';
import { createRenderer } from './render.js';
import { spawn, updateHerd, packInstances } from './unicorn.js';
import { createPhotoRig } from './photo.js';
import { scorePhoto } from './score.js';
import * as ui from './ui.js';

export const CONFIG = {
  mapSize: 500,
  plainStickiness: 0.75,
  terrainSmooth: 2,       // [1,2,1] blur passes turning bands into slopes
  terrainDetail: 0.35,    // fine relief added back after blurring, in bands
  unicornDensity: 0.003,
  driftChance: 0.08,      // chance a unicorn wears an off-biome colour
  poseWeights: [0.80, 0.10, 0.08, 0.02],
  trackRadiusFrac: 0.25,
  filmTiers: [15, 20, 30, 40, 50],
  shutterTiers: [0.8, 0.55, 0.35, 0.2],  // seconds between frames, per motor drive
  weakRadius: 26,        // tiles the cheap lure reaches
  strongRadius: 70,      // the expensive one sweeps wide enough to stage all six
  lureLife: 45,          // seconds it works for, once it lands
  lureSpeed: 4,          // lured unicorns move this much faster than a wander
  lurePull: 0.7,         // chance a unicorn in range steps with the lure
  lureGather: 5,         // attracted unicorns mill about within this radius
  throwSpeed: 62,        // launch speed; a 45 deg throw carries about 190 units
  gravity: 20,
  cartSpeed: 8,           // world units per second
  eyeHeight: 2.4,
  baseFov: Math.PI / 3,
  zoomLevels: [1, 2, 4, 8, 16],
  resNames: ['720p', '1080p', '4K', '8K'],
  // Sensor height over 4320, so the size term is literally "pixels of unicorn
  // out of an 8K frame". Not hand-tuned -- these are the real tier dimensions.
  resFactor: [720 / 4320, 1080 / 4320, 2160 / 4320, 1],
  // Linear share of the screen each sensor photographs. A cheap camera crops
  // tightly, which is a real cost: harder to fit a group, easier to clip a leg.
  resCrop: [0.55, 0.7, 0.85, 1.0],
  // Fraction of the frame a unicorn must fill to be counted as a subject.
  minCoverage: 0.002,
  // How steeply a cut outline costs you. Crop and scenery decay exponentially;
  // being behind another unicorn is a linear reduction.
  cropK: 2.5,
  envK: 2.0,
  occK: 0.9,
  baitPenalty: 200,      // for letting a lure into the shot
};

const canvas = document.getElementById('c');

const seed = (Math.random() * 0x7fffffff) | 0;
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);
const photoRig = createPhotoRig(renderer.gl, canvas, renderer.draw);

// Namespaced per the jam's shared-origin rule, and never localStorage.clear().
const SAVE_KEY = 'u13k_snap';

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}

const SAVE_VERSION = 3;

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      t: state.shutterTier,
     
      b: state.bank, z: state.maxZoom, r: state.res, f: state.filmTier,
      a: state.weak, s: state.strong, w: state.won,
    }));
  } catch (e) { /* private browsing: the run just doesn't carry over */ }
}

const saved = loadSave();

// Older saves held seven-element colour arrays; those migrate to the two
// counters, and any save from before this version gets the starter lures back.
// Bank and upgrades are kept either way.
const stock = (n, starter) =>
  saved.v === SAVE_VERSION && typeof n === 'number' ? n : starter;

const state = {
  mode: 'title',
  bank: saved.b || 0,
  maxZoom: saved.z || 0,
  res: saved.r || 0,
  filmTier: saved.f || 0,
  weak: stock(saved.a, 2),
  strong: stock(saved.s, 0),
  won: !!saved.w,
  zoom: 0,
  ready: 0,
  shutterTier: saved.t || 0,
  photos: [],
  scored: [],
  catalogued: new Set(),
};
state.film = CONFIG.filmTiers[state.filmTier];
const lures = [];

const ZOOM_PRICE = [400, 900, 1800, 3200];
const RES_PRICE = [500, 1200, 2600];
const FILM_PRICE = [300, 700, 1400, 2400];
const SHUTTER_PRICE = [250, 700, 1600];

function offers() {
  const o = [];
  if (state.maxZoom < 4) {
    o.push({ label: CONFIG.zoomLevels[state.maxZoom + 1] + '× zoom lens',
             price: ZOOM_PRICE[state.maxZoom], buy: () => state.maxZoom++ });
  }
  if (state.res < 3) {
    const r = state.res + 1;
    o.push({ label: CONFIG.resNames[r] + ' resolution — ' + RES_PX[r] + 'px tall, ' +
             (RES_PX[r] / RES_PX[0]).toFixed(1) + '× the size score of 720p',
             price: RES_PRICE[state.res], buy: () => state.res++ });
  }
  if (state.filmTier < 4) {
    o.push({ label: CONFIG.filmTiers[state.filmTier + 1] + '-shot film roll',
             price: FILM_PRICE[state.filmTier], buy: () => state.filmTier++ });
  }
  if (state.shutterTier < 3) {
    o.push({ label: 'Motor drive — ' + CONFIG.shutterTiers[state.shutterTier + 1] + 's per frame', price: SHUTTER_PRICE[state.shutterTier],
             buy: () => state.shutterTier++ });
  }
  o.push({ label: 'Weak lure — gathers within ' + CONFIG.weakRadius,
           price: 120, buy: () => state.weak++ });
  o.push({ label: 'Strong lure — gathers within ' + CONFIG.strongRadius,
           price: 400, buy: () => state.strong++ });
  return o;
}

const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let distance = 0;
let shutterQueued = false;
let clock = 0;          // seconds of ride time, used for lure lifetimes

// Start the ride looking along the track rather than at a random compass point.
{
  const a = pathAt(world.path, 0), b = pathAt(world.path, 4);
  cam.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

const fov = () => CONFIG.baseFov / CONFIG.zoomLevels[state.zoom];
state.zoom = Math.min(state.zoom, state.maxZoom);

// --- input ---------------------------------------------------------------

addEventListener('mousemove', (e) => {
  if (state.mode !== 'ride' || document.pointerLockElement !== canvas) return;
  cam.yaw -= e.movementX * 0.0022;
  cam.pitch -= e.movementY * 0.0022;
  const lim = Math.PI / 2 - 0.05;
  cam.pitch = Math.max(-lim, Math.min(lim, cam.pitch));
});

// A trackpad pinch reaches the page as ctrl+wheel, which is also the browser's
// page-zoom gesture -- so reaching for the lens would zoom the whole document
// instead. Cancelling that needs a non-passive listener. Ordinary wheel is only
// swallowed while riding, so the shop panel can still scroll.
addEventListener('wheel', (e) => {
  if (e.ctrlKey || state.mode === 'ride') e.preventDefault();
  if (state.mode !== 'ride' || !state.maxZoom) return;
  state.zoom = Math.max(0, Math.min(state.maxZoom, state.zoom + (e.deltaY > 0 ? -1 : 1)));
}, { passive: false });

// Safari sends pinch as its own gesture events rather than ctrl+wheel.
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
  addEventListener(g, (e) => e.preventDefault());
}

// Lures land well up the track, not where you are standing. The cart never
// stops, so a lure dropped beside you is useless: by the time anything has
// walked in you are a couple of hundred units past it. Thrown ahead, the cart
// arrives just as the herd does, which turns the lure into a planning tool --
// you are baiting the stretch of track you are about to ride through.
const KINDS = ['weak', 'strong'];

function throwLure(kind) {
  if (state.mode !== 'ride') return;
  const name = KINDS[kind];
  if (!state[name]) {
    ui.toast('no ' + name + ' — buy some after the lap');
    return;
  }
  state[name]--;
  // Thrown where you are actually pointing, and the pitch sets the range: flat
  // throws land close and are wasted, because the cart will be well past them
  // before anything has walked in. Aim up the track and lob it.
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const v = CONFIG.throwSpeed;
  const vx = -Math.sin(cam.yaw) * cp * v, vz = -Math.cos(cam.yaw) * cp * v, vy = sp * v;

  // Step the arc until it meets the ground, so hills and valleys catch it.
  const dt = 0.05;
  let t = 0, x = cam.x, y = cam.y, z = cam.z;
  while (t < 12) {
    t += dt;
    x = cam.x + vx * t;
    y = cam.y + vy * t - 0.5 * CONFIG.gravity * t * t;
    z = cam.z + vz * t;
    if (y <= elevAt(world, x, z)) break;
  }

  lures.push({
    x, z,
    fx: cam.x, fz: cam.z, fy: cam.y,
    vx, vy, vz,
    launched: clock, flightTime: t,
    until: clock + t + CONFIG.lureLife,
    strong: kind === 1,
  });
  ui.toast(name + ' — ' +
    Math.round(Math.hypot(x - cam.x, z - cam.z)) + ' out');
}

function primary() {
  if (state.mode === 'title') {
    state.mode = 'ride';
    ui.hidePanel();
    ui.setChrome(true);
    // Chrome rejects this promise if the lock was exited very recently, and an
    // unhandled rejection would show up as a console error.
    Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  } else if (state.mode === 'ride') {
    shutterQueued = true;
  }
}

canvas.addEventListener('click', primary);
document.getElementById('panel').addEventListener('click', primary);
addEventListener('keydown', (e) => {
  // Leave the browser's own shortcuts alone -- cmd+2 is a tab switch, and
  // without this it would throw a lure on the way past.
  if (e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') { e.preventDefault(); primary(); return; }
  // 1 throws a weak lure, 2 a strong one.
  const n = e.code.startsWith('Digit') ? +e.code.slice(5) : 0;
  if (n === 1 || n === 2) throwLure(n - 1);
  // +/- work the zoom as well as the wheel, which is awkward on a trackpad.
  else if (e.key === '+' || e.key === '=') state.zoom = Math.min(state.maxZoom, state.zoom + 1);
  else if (e.key === '-') state.zoom = Math.max(0, state.zoom - 1);
});

// --- photographs ---------------------------------------------------------

function takePhoto() {
  if (state.film <= 0 || clock < state.ready) return;
  state.ready = clock + CONFIG.shutterTiers[state.shutterTier];
  state.film--;
  ui.flash();
  const photo = photoRig.capture(cam, fov(), herd, CONFIG.resCrop[state.res]);
  const scored = scorePhoto(photo, CONFIG, state);
  state.photos.push(photo);
  state.scored.push(scored);
  ui.addThumb(photo.url);
  for (const s of scored.subjects) state.catalogued.add(s.colourIndex);
  if (scored.bonuses.some((b) => b.rainbow)) state.won = true;
}

function endRun(reason) {
  state.mode = 'results';
  state.endReason = reason;
  for (const s of state.scored) state.bank += s.total;
  persist();
  ui.setChrome(false);
  document.exitPointerLock();
  showResults();
}

function showResults() {
  state.mode = 'results';
  ui.showResults(state, state.scored, state.endReason, showDetail, showShop);
}

function showDetail(i) {
  state.mode = 'detail';
  ui.showPhoto(state.scored[i], i, state.scored.length, showResults);
}

function showShop() {
  state.mode = 'shop';
  ui.showShop(state, CONFIG, offers(), buy, ride, restart);
}

function buy(i) {
  const o = offers()[i];
  if (!o || state.bank < o.price) return;
  state.bank -= o.price;
  o.buy();
  persist();
  showShop();
}

// A new lap needs a fresh world, which means rebuilding every GL buffer. The
// save already holds everything that carries over, so a reload is both cheaper
// in bytes and less likely to leak GPU resources than tearing the scene down.
function ride() {
  persist();
  location.reload();
}

function restart() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
  location.reload();
}

// --- loop ----------------------------------------------------------------

ui.setChrome(false);
ui.showTitle();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state.mode === 'ride') {
    clock += dt;
    distance += CONFIG.cartSpeed * dt;
    for (let i = lures.length - 1; i >= 0; i--) {
      const l = lures[i];
      if (l.until <= clock) { lures.splice(i, 1); continue; }
      l.flight = Math.min(1, (clock - l.launched) / l.flightTime);
      l.flying = l.flight < 1;
      l.life = (l.until - clock) / CONFIG.lureLife;
    }
  }

  updateHerd(herd, world, CONFIG, dt, lures);
  packInstances(herd, world);
  const lap = distance / world.path.length;
  const p = pathAt(world.path, distance);
  cam.x = p.x;
  // Ride the rails: the ground where there is ground, the span where there is not.
  cam.y = Math.max(elevAt(world, p.x, p.z), p.y) + CONFIG.eyeHeight;
  cam.z = p.z;

  renderer.buildLures(lures, (x, z) => elevAt(world, x, z), clock, CONFIG.gravity);
  renderer.draw(cam, fov());

  // The capture reads the drawing buffer, so it has to happen in this same
  // frame, right after the visible draw.
  if (shutterQueued) {
    shutterQueued = false;
    takePhoto();
  }

  ui.updateHud(state, CONFIG, lap, clock);

  if (state.mode === 'ride') {
    if (lap >= 1) endRun('You completed the lap.');
    else if (state.film <= 0) endRun('You ran out of film.');
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
