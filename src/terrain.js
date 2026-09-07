import { mulberry32, hash, fbm } from './rng.js';

// World units: 1 tile = 1 unit across, 1 elevation band = HEIGHT units tall.
export const HEIGHT = 1.4;
// Sea surface sits just below band 0, so band-0 tiles read as dry beach.
export const WATER_Y = -0.25 * HEIGHT;

// --- elevation -----------------------------------------------------------

// Continuous elevation from fBm. The fBm spans roughly 0.15-0.91 with a median
// near 0.49, so SEA sits at the ~28th percentile and the land curve is stretched
// across the remainder: median lands in plains, the top few percent in peaks.
const SEA = 0.41;

function rawElevation(seed, x, y) {
  const n = fbm(seed, x / 62, y / 62, 5);
  const e = n < SEA
    ? ((n - SEA) / (SEA - 0.14)) * 3
    : Math.pow((n - SEA) / (0.91 - SEA), 1.15) * 10;
  return Math.max(-3, Math.min(10, e));
}

function generateElevation(seed, N, cfg) {
  const rnd = mulberry32(seed ^ 0x9e37);
  const elev = new Float32Array(N * N);
  const volcanic = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const e = rawElevation(seed, x, y);
      let q = Math.round(e);
      // Plains are sticky: bands adjacent to 1 mostly collapse onto it, which is
      // what turns noisy lowland into the broad open plains the game wants.
      // Band 0 is spared near the waterline so shores keep their sand rim.
      if ((q === 2 || (q === 0 && e > 0.15)) && rnd() < cfg.plainStickiness) q = 1;
      elev[i] = q;
      // Low-frequency field decides which highlands are volcanoes vs mountains.
      volcanic[i] = fbm(seed + 777, x / 130, y / 130, 2) > 0.5 ? 1 : 0;
    }
  }
  return { elev: median3(elev, N), volcanic };
}

// The sticky-plains roll is independent per cell, which leaves single-tile
// speckle along every biome boundary -- a field of one-unit pillars in 3D, and
// a lot of wasted wall geometry. One median pass erases isolated cells while
// leaving real landforms alone.
function median3(elev, N) {
  const out = new Float32Array(N * N);
  const w = new Float32Array(9);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= N) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= N) continue;
          w[n++] = elev[yy * N + xx];
        }
      }
      const s = w.subarray(0, n).slice().sort();
      out[y * N + x] = s[n >> 1];
    }
  }
  return out;
}

// --- the track -----------------------------------------------------------

// Periodic radius wobble: sines are exactly periodic in theta, so the loop closes.
function wobble(seed, theta) {
  const rnd = mulberry32(seed ^ 0x5eed);
  let s = 0, norm = 0;
  for (let k = 1; k <= 4; k++) {
    const amp = 1 / k, phase = rnd() * Math.PI * 2;
    s += amp * Math.sin(k * theta + phase);
    norm += amp;
  }
  return s / norm;
}

const PATH_POINTS = 1024;

function generateTrack(seed, N, elev, cfg) {
  const cx = N / 2, cz = N / 2;
  const baseR = N * cfg.trackRadiusFrac;
  const px = new Float32Array(PATH_POINTS), pz = new Float32Array(PATH_POINTS);
  const ph = new Float32Array(PATH_POINTS);

  for (let i = 0; i < PATH_POINTS; i++) {
    const t = (i / PATH_POINTS) * Math.PI * 2;
    const r = baseR * (1 + 0.2 * wobble(seed, t));
    px[i] = cx + Math.cos(t) * r;
    pz[i] = cz + Math.sin(t) * r;
    const gx = Math.min(N - 1, Math.max(0, Math.round(px[i])));
    const gz = Math.min(N - 1, Math.max(0, Math.round(pz[i])));
    ph[i] = elev[gz * N + gx];
  }

  // Circular smoothing so the cart rides a gentle grade instead of stairs.
  let h = ph;
  for (let pass = 0; pass < 60; pass++) {
    const out = new Float32Array(PATH_POINTS);
    for (let i = 0; i < PATH_POINTS; i++) {
      const a = h[(i - 1 + PATH_POINTS) % PATH_POINTS], b = h[i], c = h[(i + 1) % PATH_POINTS];
      out[i] = (a + 2 * b + c) / 4;
    }
    h = out;
  }
  for (let i = 0; i < PATH_POINTS; i++) h[i] = Math.max(h[i], 0.7);

  // Cumulative arc length, used to move the cart at a constant speed.
  const cum = new Float32Array(PATH_POINTS + 1);
  for (let i = 0; i < PATH_POINTS; i++) {
    const j = (i + 1) % PATH_POINTS;
    cum[i + 1] = cum[i] + Math.hypot(px[j] - px[i], pz[j] - pz[i]);
  }

  return { px, pz, h, cum, length: cum[PATH_POINTS] };
}

// Flatten the terrain under the track and mark those tiles for colouring.
function carve(N, elev, path, radius) {
  const track = new Uint8Array(N * N);
  const r = Math.ceil(radius);
  for (let i = 0; i < PATH_POINTS; i++) {
    const cx = path.px[i], cz = path.pz[i], y = path.h[i];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = Math.round(cx) + dx, gz = Math.round(cz) + dz;
        if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
        if (Math.hypot(gx + 0.5 - cx, gz + 0.5 - cz) > radius) continue;
        const k = gz * N + gx;
        elev[k] = y;
        track[k] = 1;
      }
    }
  }
  return track;
}

// --- colour --------------------------------------------------------------

function tileColor(q, x, y, volcanic, isTrack, out, o) {
  let r, g, b;
  if (isTrack) {
    r = 96; g = 72; b = 52;
  } else if (q < 0) {
    const d = Math.min(1, -q / 4);
    r = 26 + 24 * (1 - d); g = 64 + 56 * (1 - d); b = 132 + 74 * (1 - d);
  } else if (q === 0) {
    r = 238; g = 224; b = 186;                                  // shoreline sand
  } else if (q === 1) {
    r = 214; g = 196; b = 72;                                   // plains
  } else if (q <= 4) {
    const t = (q - 2) / 2;
    r = 62 - 22 * t; g = 142 - 44 * t; b = 62 - 20 * t;         // forest
  } else if (volcanic) {
    const t = Math.min(1, (q - 5) / 5);
    r = 198 + 44 * t; g = 112 - 92 * t; b = 42 - 26 * t;        // volcano: orange -> red
  } else {
    const t = Math.min(1, (q - 5) / 5);
    r = 128 + 66 * t; g = 104 + 76 * t; b = 168 + 72 * t;       // mountain: violet -> pale
  }
  const v = 0.92 + hash(9, x, y) * 0.16;                        // per-tile speckle
  out[o] = r * v; out[o + 1] = g * v; out[o + 2] = b * v; out[o + 3] = 255;
}

// --- mesh ----------------------------------------------------------------

// Flat-topped tiles plus vertical walls wherever a neighbour sits lower.
// Quantised elevations mean most neighbours match, so walls stay cheap.
function buildMesh(N, elev, volcanic, track) {
  const at = (x, z) => elev[z * N + x];

  let quads = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      quads++;
      const e = at(x, z);
      if (x === 0 || at(x - 1, z) < e) quads++;
      if (x === N - 1 || at(x + 1, z) < e) quads++;
      if (z === 0 || at(x, z - 1) < e) quads++;
      if (z === N - 1 || at(x, z + 1) < e) quads++;
    }
  }

  const count = quads * 6;
  const pos = new Float32Array(count * 3);
  const col = new Uint8Array(count * 4);
  let p = 0, c = 0;

  const push = (x, y, z) => { pos[p++] = x; pos[p++] = y; pos[p++] = z; };
  // Counter-clockwise when seen from the outside.
  const quad = (ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx, dy, dz, x, z, q, vol, tr) => {
    push(ax, ay, az); push(bx, by, bz); push(cx2, cy2, cz2);
    push(ax, ay, az); push(cx2, cy2, cz2); push(dx, dy, dz);
    for (let i = 0; i < 6; i++) { tileColor(q, x, z, vol, tr, col, c); c += 4; }
  };

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const e = elev[i], vol = volcanic[i], tr = track[i];
      const q = Math.round(e);
      const y = e * HEIGHT;
      const x0 = x, x1 = x + 1, z0 = z, z1 = z + 1;

      quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, x, z, q, vol, tr);

      const wall = (nx, nz, ax, az, bx, bz) => {
        const ne = (nx < 0 || nz < 0 || nx >= N || nz >= N) ? -4 : at(nx, nz);
        if (ne >= e) return;
        const ny = ne * HEIGHT;
        quad(ax, ny, az, bx, ny, bz, bx, y, bz, ax, y, az, x, z, q, vol, tr);
      };
      wall(x - 1, z, x0, z0, x0, z1);
      wall(x + 1, z, x1, z1, x1, z0);
      wall(x, z - 1, x1, z0, x0, z0);
      wall(x, z + 1, x0, z1, x1, z1);
    }
  }

  return { pos, col, count };
}

// --- entry point ---------------------------------------------------------

export function buildWorld(seed, cfg) {
  const N = cfg.mapSize;
  const { elev, volcanic } = generateElevation(seed, N, cfg);
  const path = generateTrack(seed, N, elev, cfg);
  const track = carve(N, elev, path, 2.2);
  const mesh = buildMesh(N, elev, volcanic, track);
  return { N, elev, volcanic, track, path, mesh, points: PATH_POINTS };
}

// Cart position at an arc-length distance around the loop.
export function pathAt(path, dist) {
  const n = PATH_POINTS;
  let d = dist % path.length;
  if (d < 0) d += path.length;
  // cum is monotonic; binary search for the segment.
  let lo = 0, hi = n;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid] <= d) lo = mid; else hi = mid;
  }
  const j = (lo + 1) % n;
  const seg = path.cum[lo + 1] - path.cum[lo];
  const t = seg > 0 ? (d - path.cum[lo]) / seg : 0;
  return {
    x: path.px[lo] + (path.px[j] - path.px[lo]) * t,
    z: path.pz[lo] + (path.pz[j] - path.pz[lo]) * t,
    y: (path.h[lo] + (path.h[j] - path.h[lo]) * t) * HEIGHT,
  };
}
