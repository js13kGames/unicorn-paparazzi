import { buildWorld, pathAt, elevAt } from './terrain.js';
import { createRenderer } from './render.js';
import { spawn, updateHerd, packInstances } from './unicorn.js';

export const CONFIG = {
  mapSize: 500,
  plainStickiness: 0.75,
  terrainSmooth: 2,      // [1,2,1] blur passes turning bands into slopes
  terrainDetail: 0.35,   // fine relief added back after blurring, in bands
  unicornDensity: 0.003,
  adultChance: 0.75,
  driftChance: 0.08,      // chance a unicorn wears an off-biome colour
  poseWeights: [0.80, 0.10, 0.08, 0.02],
  trackRadiusFrac: 0.25,
  startFilm: 15,
  cartSpeed: 14,        // world units per second
  eyeHeight: 2.4,
};

const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
const bar = document.getElementById('bar');

const seed = (Math.random() * 0x7fffffff) | 0;
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);

const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let distance = 0;

// Start the ride looking along the track rather than at a random compass point.
{
  const a = pathAt(world.path, 0), b = pathAt(world.path, 4);
  cam.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
}
let fovy = Math.PI / 3;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

// --- look controls -------------------------------------------------------

canvas.addEventListener('click', () => {
  // Chrome returns a promise here and rejects it if the lock was exited very
  // recently; an unhandled rejection would show up as a console error.
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  cam.yaw -= e.movementX * 0.0022;
  cam.pitch -= e.movementY * 0.0022;
  const lim = Math.PI / 2 - 0.05;
  cam.pitch = Math.max(-lim, Math.min(lim, cam.pitch));
});

// --- loop ----------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  updateHerd(herd, world, CONFIG, dt);
  packInstances(herd, world);

  distance += CONFIG.cartSpeed * dt;
  const lap = distance / world.path.length;
  const p = pathAt(world.path, distance);
  cam.x = p.x;
  // Ride the rendered surface, not the path's own height estimate.
  cam.y = elevAt(world, p.x, p.z) + CONFIG.eyeHeight;
  cam.z = p.z;

  renderer.draw(cam, fovy);

  bar.style.width = (Math.min(1, lap) * 100).toFixed(1) + '%';
  hud.textContent = 'seed ' + seed + '  ·  lap ' + (lap * 100).toFixed(0) +
    '%  ·  ' + herd.n + ' unicorns';

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
