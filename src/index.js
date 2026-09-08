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
  adultChance: 0.75,
  driftChance: 0.08,      // chance a unicorn wears an off-biome colour
  poseWeights: [0.80, 0.10, 0.08, 0.02],
  trackRadiusFrac: 0.25,
  startFilm: 15,
  cartSpeed: 14,          // world units per second
  eyeHeight: 2.4,
  baseFov: Math.PI / 3,
  zoomLevels: [1, 2, 4, 8, 16],
  resNames: ['720p', '1080p', '4K', '8K'],
  // A narrower spread than 0.25-1.0: at 0.25 the starting camera could not earn
  // a meaningful size score at all, which made the whole term dead weight until
  // the shop opened.
  resFactor: [0.55, 0.7, 0.85, 1.0],
  // Fraction of the frame a unicorn must fill to be counted as a subject.
  minCoverage: 0.002,
};

const canvas = document.getElementById('c');

const seed = (Math.random() * 0x7fffffff) | 0;
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);
const photoRig = createPhotoRig(renderer.gl, canvas, renderer.draw);

const state = {
  mode: 'title',
  film: CONFIG.startFilm,
  bank: 0,
  zoom: 0,
  maxZoom: 0,      // step 4's shop raises this
  res: 0,
  photos: [],
  scored: [],
  reviewIdx: 0,
  catalogued: new Set(),
  won: false,
};

const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let distance = 0;
let shutterQueued = false;

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

// --- input ---------------------------------------------------------------

addEventListener('mousemove', (e) => {
  if (state.mode !== 'ride' || document.pointerLockElement !== canvas) return;
  cam.yaw -= e.movementX * 0.0022;
  cam.pitch -= e.movementY * 0.0022;
  const lim = Math.PI / 2 - 0.05;
  cam.pitch = Math.max(-lim, Math.min(lim, cam.pitch));
});

addEventListener('wheel', (e) => {
  if (state.mode !== 'ride' || !state.maxZoom) return;
  state.zoom = Math.max(0, Math.min(state.maxZoom, state.zoom + (e.deltaY > 0 ? -1 : 1)));
}, { passive: true });

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
  } else if (state.mode === 'review') {
    advanceReview();
  }
}

canvas.addEventListener('click', primary);
document.getElementById('panel').addEventListener('click', primary);
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); primary(); }
});

// --- photographs ---------------------------------------------------------

function takePhoto() {
  if (state.film <= 0) return;
  state.film--;
  ui.flash();
  const photo = photoRig.capture(cam, fov(), herd);
  const scored = scorePhoto(photo, CONFIG, state);
  state.photos.push(photo);
  state.scored.push(scored);
  for (const s of scored.subjects) state.catalogued.add(s.colourIndex);
  if (scored.bonuses.some((b) => b.rainbow)) state.won = true;
}

function endRun(reason) {
  state.mode = 'review';
  state.reviewIdx = 0;
  state.endReason = reason;
  ui.setChrome(false);
  document.exitPointerLock();
  showCurrent();
}

function showCurrent() {
  if (state.reviewIdx < state.scored.length) {
    const s = state.scored[state.reviewIdx];
    ui.showPhoto(s, state.reviewIdx, state.scored.length, state.bank);
  } else {
    let best = null;
    for (const s of state.scored) if (!best || s.total > best.total) best = s;
    ui.showSummary(state, state.endReason, best);
  }
}

function advanceReview() {
  if (state.reviewIdx < state.scored.length) {
    state.bank += state.scored[state.reviewIdx].total;
    state.reviewIdx++;
    showCurrent();
  }
}

// --- loop ----------------------------------------------------------------

ui.setChrome(false);
ui.showTitle(CONFIG);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  updateHerd(herd, world, CONFIG, dt);
  packInstances(herd, world);

  if (state.mode === 'ride') distance += CONFIG.cartSpeed * dt;
  const lap = distance / world.path.length;
  const p = pathAt(world.path, distance);
  cam.x = p.x;
  // Ride the rendered surface, not the path's own height estimate.
  cam.y = elevAt(world, p.x, p.z) + CONFIG.eyeHeight;
  cam.z = p.z;

  renderer.draw(cam, fov());

  // The capture reads the drawing buffer, so it has to happen in this same
  // frame, right after the visible draw.
  if (shutterQueued) {
    shutterQueued = false;
    takePhoto();
  }

  ui.updateHud(state, CONFIG, lap);

  if (state.mode === 'ride') {
    if (lap >= 1) endRun('You completed the lap.');
    else if (state.film <= 0) endRun('You ran out of film.');
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
