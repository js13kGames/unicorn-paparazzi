import { multiply } from './mat.js';
import { mulberry32 } from './rng.js';
import { HEIGHT, elevAt } from './terrain.js';

// Six coat colours, in rainbow order. A unicorn's mane and tail take the NEXT
// colour along, so every animal is a little two-tone rainbow.
export const COLORS = [
  [0.90, 0.24, 0.24],  // R
  [0.95, 0.55, 0.20],  // O
  [0.96, 0.86, 0.28],  // Y
  [0.35, 0.78, 0.35],  // G
  [0.31, 0.55, 0.94],  // B
  [0.67, 0.39, 0.90],  // V
];
export const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'violet'];

export const POSE_NAMES = ['standing', 'eating', 'sitting', 'neighing'];
export const POSE_FRAMES = 16;
export const POSE_ROWS = POSE_NAMES.length * POSE_FRAMES;

// --- skeleton ------------------------------------------------------------
// Each part rotates about its own pivot, expressed in its parent's joint space.
// Model faces -Z. Positive rotX swings a downward limb forwards.

const BODY = 0, NECK = 1, HEAD = 2, HORN = 3, MANE = 4, TAIL = 5;
const LEG_FL = 6, LEG_FR = 7, LEG_BL = 8, LEG_BR = 9;
export const PARTS = 10;

//               parent, pivot x,     y,     z
const SKELETON = [
  [-1,      0,  1.04,  0.00],   // body
  [BODY,    0,  0.18, -0.50],   // neck
  [NECK,    0,  0.55, -0.14],   // head
  [HEAD,    0,  0.16, -0.30],   // horn
  [NECK,    0,  0.10,  0.08],   // mane
  [BODY,    0,  0.20,  0.60],   // tail
  [BODY, -0.20, -0.24, -0.42],  // front left leg
  [BODY,  0.20, -0.24, -0.42],  // front right leg
  [BODY, -0.20, -0.24,  0.42],  // back left leg
  [BODY,  0.20, -0.24,  0.42],  // back right leg
];

// Colour roles: 0 coat, 1 mane/tail, 2 horn, 3 hoof/muzzle, 4-6 extra horns.
//        part,  cx,    cy,    cz,   hx,    hy,    hz,   taper, role
const BOXES = [
  [BODY,    0,  0.00,  0.00, 0.30,  0.28,  0.62,  1.00, 0],
  [NECK,    0,  0.28, -0.10, 0.15,  0.32,  0.16,  0.85, 0],
  [HEAD,    0,  0.03, -0.20, 0.13,  0.15,  0.28,  1.00, 0],
  [HEAD,    0, -0.02, -0.44, 0.10,  0.10,  0.10,  1.00, 3],
  [HORN,    0,  0.18,  0.00, 0.05,  0.20,  0.05,  0.10, 2],
  [HORN, -0.08,  0.15,  0.05, 0.04,  0.16,  0.04,  0.10, 4],
  [HORN,  0.08,  0.15,  0.05, 0.04,  0.16,  0.04,  0.10, 5],
  [HORN,     0,  0.14,  0.11, 0.04,  0.14,  0.04,  0.10, 6],
  [MANE,    0,  0.30,  0.06, 0.09,  0.34,  0.08,  0.70, 1],
  [TAIL,    0, -0.22,  0.06, 0.07,  0.26,  0.07,  0.60, 1],
];
for (const leg of [LEG_FL, LEG_FR, LEG_BL, LEG_BR]) {
  BOXES.push([leg, 0, -0.36, 0, 0.09, 0.40, 0.09, 0.9, 0]);
  BOXES.push([leg, 0, -0.74, 0, 0.10, 0.06, 0.10, 1.0, 3]);
}

// --- mesh ----------------------------------------------------------------

// A box, optionally tapered towards its top face, in its part's joint space.
function box(out, cx, cy, cz, hx, hy, hz, taper, part, role) {
  const t = taper;
  // 8 corners: bottom four at full size, top four scaled by the taper.
  const v = [
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz - hz],
    [cx - hx * t, cy + hy, cz + hz * t], [cx + hx * t, cy + hy, cz + hz * t],
    [cx + hx * t, cy + hy, cz - hz * t], [cx - hx * t, cy + hy, cz - hz * t],
  ];
  // Faces wound counter-clockwise seen from outside.
  const faces = [
    [4, 5, 6, 7], [3, 2, 1, 0], [0, 1, 5, 4],
    [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7],
  ];
  for (const f of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      out.pos.push(...v[f[i]]);
      out.attr.push(part, role);
    }
  }
}

export function buildModel() {
  const out = { pos: [], attr: [] };
  for (const b of BOXES) box(out, b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[0], b[8]);
  return {
    pos: new Float32Array(out.pos),
    attr: new Uint8Array(out.attr),
    count: out.pos.length / 3,
  };
}

// --- poses ---------------------------------------------------------------

// Per-pose joint angles at animation phase `ph` in [0,1). Returns [rx, rz] per
// part plus a body lift, which is all the articulation this model needs.
function poseAngles(pose, ph) {
  const a = new Float32Array(PARTS * 2);
  const s = Math.sin(ph * Math.PI * 2), s2 = Math.sin(ph * Math.PI * 4);
  let lift = 0;
  const set = (p, rx, rz) => { a[p * 2] = rx; a[p * 2 + 1] = rz || 0; };

  if (pose === 0) {                       // standing: breathing and a tail swish
    lift = 0.012 * s;
    set(NECK, -0.25);
    set(HEAD, 0.10 + 0.05 * s);
    set(TAIL, -0.15, 0.30 * s);
    for (const l of [LEG_FL, LEG_FR, LEG_BL, LEG_BR]) set(l, 0.02 * s);
  } else if (pose === 1) {                // eating: muzzle down in the grass
    set(NECK, -1.30);
    set(HEAD, -0.50 + 0.10 * s2);
    set(TAIL, -0.10, 0.22 * s);
    set(LEG_FL, 0.18, -0.10); set(LEG_FR, 0.18, 0.10);
    set(LEG_BL, -0.10); set(LEG_BR, -0.10);
  } else if (pose === 2) {                // sitting: couched, all four legs tucked
    lift = -0.50;
    set(BODY, 0.10);
    set(NECK, -0.20);
    set(HEAD, 0.25 + 0.04 * s);
    set(TAIL, 0.05, 0.15 * s);
    set(LEG_FL, 1.05, -0.08); set(LEG_FR, 1.05, 0.08);
    set(LEG_BL, 1.14, -0.16); set(LEG_BR, 1.14, 0.16);
  } else {                                // neighing: reared up, pawing the air
    lift = 0.10 + 0.04 * s;
    set(BODY, 0.48 + 0.08 * s);
    // The neck counter-rotates so the head stays upright while the body rears.
    set(NECK, -0.34);
    set(HEAD, 0.52 + 0.08 * s2);
    set(TAIL, -0.70, 0.25 * s);
    set(LEG_FL, 1.00 + 0.30 * s, -0.12);
    set(LEG_FR, 0.75 - 0.30 * s, 0.12);
    set(LEG_BL, -0.07); set(LEG_BR, -0.07);
  }
  return { a, lift };
}

function rotXZ(rx, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
  // Rx * Rz, column-major.
  return new Float32Array([
    cz, sz * cx, sz * sx, 0,
    -sz, cz * cx, cz * sx, 0,
    0, -sx, cx, 0,
    0, 0, 0, 1,
  ]);
}

function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

// One RGBA32F row per animation frame: PARTS * 4 texels of part matrices.
export function buildPoseTable() {
  const data = new Float32Array(POSE_ROWS * PARTS * 16);
  for (let pose = 0; pose < POSE_NAMES.length; pose++) {
    for (let f = 0; f < POSE_FRAMES; f++) {
      const { a, lift } = poseAngles(pose, f / POSE_FRAMES);
      const row = pose * POSE_FRAMES + f;
      const mats = [];
      for (let p = 0; p < PARTS; p++) {
        const [parent, px, py, pz] = SKELETON[p];
        const local = multiply(
          translation(px, py + (p === BODY ? lift : 0), pz),
          rotXZ(a[p * 2], a[p * 2 + 1])
        );
        const m = parent < 0 ? local : multiply(mats[parent], local);
        mats.push(m);
        data.set(m, (row * PARTS + p) * 16);
      }
    }
  }
  return data;
}

// --- population ----------------------------------------------------------

// Each colour keeps to its home biome, so rare terrain means rare colours --
// which is what makes an all-six-colour photograph hard to stage.
function colorForBand(q, volcanic) {
  if (q >= 7) return 4;                      // blue: high peaks
  if (q >= 5) return volcanic ? 0 : 5;       // red on volcanoes, violet on mountains
  if (q >= 2) return 3;                      // green: forest
  if (q >= 1) return 2;                      // yellow: plains
  return 1;                                  // orange: beach
}

export function spawn(world, cfg, seed) {
  const rnd = mulberry32(seed ^ 0x13c9);
  const N = world.N;
  const list = { x: [], z: [], color: [], horns: [] };
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (world.track[i]) continue;
      const q = Math.round(world.elev[i]);
      if (q < 0) continue;                   // no unicorns in the sea
      if (rnd() >= cfg.unicornDensity) continue;
      // A few drifters wear an off-biome colour, which is what makes a rainbow
      // shot possible at all near the track.
      const color = rnd() < cfg.driftChance
        ? (rnd() * 6) | 0
        : colorForBand(q, world.volcanic[i]);
      list.x.push(x + 0.5);
      list.z.push(z + 0.5);
      list.color.push(color);
      // Bicorn 1%, tricorn 0.5%, quadricorn 0.25% -- about a dozen, three and
      // one per map. Rare enough to be worth hunting for.
      const r = rnd();
      list.horns.push(r < 0.0025 ? 3 : r < 0.0075 ? 2 : r < 0.0175 ? 1 : 0);
    }
  }
  return makeHerd(list, cfg, seed);
}

// Seconds for one loop of each pose's idle animation.
const POSE_CYCLE = [3.0, 1.6, 4.0, 1.2];
const STEP_TIME = 1.1;

function makeHerd(list, cfg, seed) {
  const n = list.x.length;
  const rnd = mulberry32(seed ^ 0x7a11);
  const h = {
    n,
    rnd,
    x: Float32Array.from(list.x),
    z: Float32Array.from(list.z),
    fromX: Float32Array.from(list.x),
    fromZ: Float32Array.from(list.z),
    toX: Float32Array.from(list.x),
    toZ: Float32Array.from(list.z),
    step: new Float32Array(n),          // progress through the current step
    yaw: new Float32Array(n),
    color: Uint8Array.from(list.color),
    horns: Uint8Array.from(list.horns),
    pose: new Uint8Array(n),
    phase: new Float32Array(n),
    hold: new Float32Array(n),
    instances: new Float32Array(n * 8),
  };
  for (let i = 0; i < n; i++) {
    h.yaw[i] = rnd() * Math.PI * 2;
    h.phase[i] = rnd();
    h.step[i] = rnd();
    h.pose[i] = rollPose(rnd(), cfg.poseWeights);
    h.hold[i] = 2 + rnd() * 4;
  }
  return h;
}

// Poses are listed rarest-last in POSE_NAMES order; weights must sum to 1.
function rollPose(r, weights) {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return 0;
}

export function updateHerd(h, world, cfg, dt) {
  const rnd = h.rnd;
  const N = world.N;
  for (let i = 0; i < h.n; i++) {
    // Pose schedule.
    h.hold[i] -= dt;
    if (h.hold[i] <= 0) {
      h.pose[i] = rollPose(rnd(), cfg.poseWeights);
      h.hold[i] = 2 + rnd() * 4;
    }
    h.phase[i] = (h.phase[i] + dt / POSE_CYCLE[h.pose[i]]) % 1;

    // Only a standing unicorn wanders; the other poses are stationary.
    if (h.pose[i] === 0) {
      h.step[i] += dt / STEP_TIME;
      while (h.step[i] >= 1) {
        h.step[i] -= 1;
        h.fromX[i] = h.toX[i];
        h.fromZ[i] = h.toZ[i];
        // One tile up, down or sideways -- the same +1/0/-1 walk the terrain uses.
        const dx = ((rnd() * 3) | 0) - 1, dz = ((rnd() * 3) | 0) - 1;
        const nx = h.toX[i] + dx, nz = h.toZ[i] + dz;
        const gi = (nz | 0) * N + (nx | 0);
        const ok = nx > 1 && nz > 1 && nx < N - 1 && nz < N - 1 && world.elev[gi] >= 0;
        if (ok && (dx || dz)) {
          h.toX[i] = nx;
          h.toZ[i] = nz;
          h.yaw[i] = Math.atan2(-dx, -dz);
        }
      }
      const t = h.step[i];
      const e = t * t * (3 - 2 * t);        // ease so steps don't look robotic
      h.x[i] = h.fromX[i] + (h.toX[i] - h.fromX[i]) * e;
      h.z[i] = h.fromZ[i] + (h.toZ[i] - h.fromZ[i]) * e;
    }
  }
}

// Pack every unicorn into the instance buffer. All of them go up each frame:
// the GPU culls far cheaper than we can, and it keeps gl_InstanceID equal to
// the herd index, which the photo scoring pass in step 3 depends on.
export function packInstances(h, world) {
  const a = h.instances;
  for (let i = 0; i < h.n; i++) {
    const o = i * 8;
    a[o] = h.x[i];
    a[o + 1] = elevAt(world, h.x[i], h.z[i]);
    a[o + 2] = h.z[i];
    a[o + 3] = h.yaw[i];
    a[o + 4] = 1;
    a[o + 5] = h.color[i];
    a[o + 6] = h.pose[i] * POSE_FRAMES + ((h.phase[i] * POSE_FRAMES) | 0);
    a[o + 7] = h.horns[i];
  }
  return a;
}
