import { buildWorld, pathAt, elevAt } from './terrain.js';
import { createRenderer } from './render.js';
import { spawn, updateHerd, packInstances } from './unicorn.js';
import { createPhotoRig, frame as viewFrame } from './photo.js';
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
  filmTiers: [5, 20, 30, 40, 50],   // TESTING: first tier is 5, not 15
  shutterTiers: [0.8, 0.55, 0.35, 0.2],  // seconds between frames, per motor drive
  cartSpeed: 8,           // world units per second
  eyeHeight: 2.4,
  baseFov: Math.PI / 3,
  zoomLevels: [1, 2, 4, 8, 16],
  // Deliberately not pixel counts: the photograph is the same size at every tier,
  // so naming them 720p..8K promised a resolution nothing in the pipeline has.
  resNames: ['low', 'med', 'high', 'ultra'],
  // What one frame-share of unicorn is worth on each sensor: 1 / 1.5 / 3 / 6 of
  // the base rate. Size is coverage x this, so a subject filling a tenth of the
  // frame scores 100 on the cheapest camera and 600 on the best.
  resBonus: [1000, 1500, 3000, 6000],
  // Fraction of the frame a unicorn must fill to be counted as a subject.
  minCoverage: 0.002,
  // How steeply a cut outline costs you. Crop and scenery decay exponentially;
  // being behind another unicorn is a linear reduction.
  cropK: 2.5,
  envK: 2.0,
  occK: 0.9,
};

const canvas = document.getElementById('c');

const seed = +location.hash.slice(1) || (Math.random() * 0x7fffffff) | 0;
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);
const photoRig = createPhotoRig(renderer.gl, canvas, renderer.draw);

// Namespaced per the jam's shared-origin rule, and never localStorage.clear().
const SAVE_KEY = 'u13k_uni_saf';

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}

const SAVE_VERSION = 3;

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      t: state.shutterTier,
     
      g: state.go,
      b: state.bank, z: state.maxZoom, r: state.res, f: state.filmTier,
    }));
  } catch (e) { /* private browsing: the run just doesn't carry over */ }
}

const saved = loadSave();

const state = {
  mode: 'title',
  bank: saved.b || 0,
  maxZoom: saved.z || 0,
  // Clamped: a save from a build with more tiers would index off the end of
  // resBonus, which is a NaN score rather than a visible failure.
  res: Math.min(saved.r || 0, 3),
  filmTier: saved.f || 0,
  zoom: 0,
  ready: 0,
  fx: 1, fy: 1,          // photo frame's share of the canvas, set every frame
  shutterTier: saved.t || 0,
  photos: [],
  scored: [],
};
state.film = CONFIG.filmTiers[state.filmTier];

// Every upgrade is a ladder: the tier values, the price of each step, the state
// key holding how far up it you are, and a suffix for the values. p[i] buys
// tier i+1, so p is always one shorter than v. The shop draws the whole ladder
// -- the old list showed only the next rung, so nothing on screen ever said
// what camera you were actually carrying.
const LADDERS = [
  ['zoom', CONFIG.zoomLevels, [400, 900, 1800, 3200], 'maxZoom', '×'],
  ['photo', CONFIG.resNames, [500, 1200, 2600], 'res', ''],
  ['film', CONFIG.filmTiers, [300, 700, 1400, 2400], 'filmTier', ''],
  ['speed', CONFIG.shutterTiers, [250, 700, 1600], 'shutterTier', 's'],
];

const offers = () => LADDERS.map(([label, v, p, key, sfx]) => ({
  label, v, p, sfx, at: state[key], price: p[state[key]],
  buy: () => state[key]++,
}));

const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let distance = 0;
let shutterQueued = false;
let clock = 0;          // seconds of ride time, always tickCount * STEP

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

// The photograph's own vertical fov. What the screen shows is derived from it
// per frame, so the window's shape changes how much you can see AROUND the
// frame and nothing about the frame itself.
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
// TODO: Is this necessary???
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
  addEventListener(g, (e) => e.preventDefault());
}

// Chrome rejects this promise if the lock was exited very recently, and an
// unhandled rejection would show up as a console error.
const lock = () => Promise.resolve(canvas.requestPointerLock()).catch(() => {});

function primary() {
  if (state.mode === 'title') {
    state.mode = 'ride';
    ui.hidePanel();
    ui.setChrome(true);
    lock();
  } else if (state.mode === 'ride') {
    // Escape releases the pointer but leaves you riding, so a click has to hand
    // the mouse back. Without this it fell through to the shutter, and the only
    // way to look around again was to spend a frame of film.
    if (document.pointerLockElement === canvas) shutterQueued = true;
    else lock();
  }
}

// Losing the pointer is otherwise invisible -- you find out by taking a photo
// you did not mean to take.
document.addEventListener('pointerlockchange', () => {
  if (state.mode === 'ride' && document.pointerLockElement !== canvas) {
    ui.toast('click to look');
  }
});

canvas.addEventListener('click', primary);
document.getElementById('panel').addEventListener('click', primary);
addEventListener('keydown', (e) => {
  // Leave the browser's own shortcuts alone: cmd+- is a page zoom, and without
  // this it would work the lens on the way past.
  if (e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') { e.preventDefault(); primary(); return; }
  // +/- work the zoom as well as the wheel, which is awkward on a trackpad.
  if (e.key === '+' || e.key === '=') state.zoom = Math.min(state.maxZoom, state.zoom + 1);
  else if (e.key === '-') state.zoom = Math.max(0, state.zoom - 1);
});

// --- photographs ---------------------------------------------------------

function takePhoto() {
  if (state.film <= 0 || clock < state.ready) return;
  state.ready = clock + CONFIG.shutterTiers[state.shutterTier];
  state.film--;
  ui.flash();
  const photo = photoRig.capture(cam, fov(), herd, state.fx, state.fy, state.res);
  const scored = scorePhoto(photo, CONFIG, state);
  state.photos.push(photo);
  state.scored.push(scored);
  ui.addThumb(photo.url);
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
  // A maxed ladder has no price at all, and `bank < undefined` is false -- so
  // without the second test it would sell you a tier past the top of the ladder.
  if (!o || !o.price || state.bank < o.price) return;
  state.bank -= o.price;
  o.buy();
  persist();
  showShop();
}

// A new lap needs a fresh world, which means rebuilding every GL buffer. The
// save already holds everything that carries over, so a reload is both cheaper
// in bytes and less likely to leak GPU resources than tearing the scene down.
function ride() {
  state.go = 1;
  persist();
  location.reload();
}

function restart() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
  location.reload();
}

// --- loop ----------------------------------------------------------------

ui.setChrome(false);
// Three ways in. A first run, or one after "Start over" wipes the save, stops on
// the title. "Ride again" leaves a one-shot marker and reloads to rebuild the
// world, so it lands straight on the cart -- consuming the marker here means an
// actual refresh does not do the same. That refresh reopens the shop instead, so
// a stray reload mid-lap costs the lap but not the bank.
if (saved.g) { state.go = 0; persist(); primary(); ui.toast('click to look'); }
else if (saved.v) showShop();
else ui.showTitle();

// The simulation advances in whole steps of this and never in wall-clock time.
// updateHerd draws from one RNG stream shared by the whole herd, from inside
// dt-gated branches, so the number and ORDER of draws -- and therefore every
// unicorn -- is a function of the tick count and nothing else. Fixing the step is
// what lets two machines at 60Hz and 144Hz ride an identical lap. `clock` is the
// authoritative tick clock: it is always exactly tickCount * STEP.
const STEP = 1 / 60;
let acc = 0;

function tick() {
  clock += STEP;
  distance += CONFIG.cartSpeed * STEP;
  updateHerd(herd, world, CONFIG, STEP);
}

let last = performance.now();
function frame(now) {
  // Capped so a long stall cannot spin this loop; the cost is that the dropped
  // ticks are simply lost, which a networked lap would have to resync.
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (state.mode === 'ride' && acc >= STEP) { tick(); acc -= STEP; }

  packInstances(herd, world);
  const lap = distance / world.path.length;
  // The cart alone is smoothed across the leftover accumulator, so it does not
  // judder on a display faster than the tick rate. Presentation only -- this
  // never feeds back into the simulation.
  const p = pathAt(world.path, distance + CONFIG.cartSpeed * acc);
  cam.x = p.x;
  // Ride the rails: the ground where there is ground, the span where there is not.
  cam.y = Math.max(elevAt(world, p.x, p.z), p.y) + CONFIG.eyeHeight;
  cam.z = p.z;

  const f = viewFrame(fov(), canvas.width / canvas.height);
  state.fx = f.fx; state.fy = f.fy;
  renderer.draw(cam, f.fov);

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
