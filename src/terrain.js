import { hash, fbm } from './rng.js';

// World units: 1 tile = 1 unit across, 1 elevation band = HEIGHT units tall.
export const HEIGHT = 1.9;
// Sea surface. The smoothed shoreline crosses it wherever it likes, which reads
// as wet sand rather than a hard edge.
export const WATER_Y = -0.2 * HEIGHT;

const PATH_POINTS = 1024;

// --- elevation bands -----------------------------------------------------
// Bands are integers. They decide color, biome and where each unicorn color
// lives; the geometry uses a smoothed copy so the world isn't a staircase.

// The fBm spans roughly 0.15-0.91 with a median near 0.49, so SEA sits at the
// ~28th percentile and the land curve is stretched across the remainder.
const SEA = 0.41;

function rawElevation(seed, x, y) {
  const n = fbm(seed, x / 62, y / 62, 5);
  const e = n < SEA
    ? ((n - SEA) / (SEA - 0.14)) * 3
    : Math.pow((n - SEA) / (0.91 - SEA), 1.15) * 10;
  return Math.max(-3, Math.min(10, e));
}

function generateBands(seed, N, cfg) {
  const band = new Float32Array(N * N);
  const volcanic = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const e = rawElevation(seed, x, y);
      let q = Math.round(e);
      // Plains are sticky: bands adjacent to 1 mostly collapse onto it, turning
      // noisy lowland into broad plains. Band 0 is spared near the waterline so
      // shores keep their sand rim. The roll comes from a noise field, not white
      // noise, so sticky regions are patches rather than salt-and-pepper.
      if ((q === 2 || (q === 0 && e > 0.15)) &&
          fbm(seed + 555, x / 5, y / 5, 2) < cfg.plainStickiness) q = 1;
      band[i] = q;
      // Low-frequency field decides which highlands are volcanoes vs mountains.
      volcanic[i] = fbm(seed + 777, x / 130, y / 130, 2) > 0.5 ? 1 : 0;
    }
  }
  return { band: median3(band, N), volcanic };
}

// The sticky-plains roll is independent per cell, which leaves single-tile
// speckle along every biome boundary. One median pass erases isolated cells
// while leaving real landforms alone.
function median3(band, N) {
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
          w[n++] = band[yy * N + xx];
        }
      }
      out[y * N + x] = w.subarray(0, n).slice().sort()[n >> 1];
    }
  }
  return out;
}

// --- smoothed height -----------------------------------------------------

// Separable [1,2,1] blur. Each pass spreads a one-band step over another tile,
// turning the quantised plateaus into slopes without moving the color bands.
function smoothHeight(band, N, passes) {
  let src = Float32Array.from(band);
  let dst = new Float32Array(N * N);
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        dst[i] = (src[y * N + cl(x - 1, N - 1)] + 2 * src[i] + src[y * N + cl(x + 1, N - 1)]) / 4;
      }
    }
    [src, dst] = [dst, src];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        dst[i] = (src[cl(y - 1, N - 1) * N + x] + 2 * src[i] + src[cl(y + 1, N - 1) * N + x]) / 4;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// Blurring flattens the plains into a dead wash, so put fine relief back with a
// high-frequency noise layer. The track carve runs afterwards and irons it out
// under the roadbed.
function addDetail(seed, N, height, amp) {
  if (!amp) return;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      height[y * N + x] += (fbm(seed + 31, x / 7, y / 7, 3) - 0.5) * amp;
    }
  }
}

// --- the track -----------------------------------------------------------

function generateTrack(seed, N, band, cfg) {
  const cx = N / 2, cz = N / 2;
  const baseR = N * cfg.trackRadiusFrac;
  const px = new Float32Array(PATH_POINTS), pz = new Float32Array(PATH_POINTS);
  const ph = new Float32Array(PATH_POINTS);

  for (let i = 0; i < PATH_POINTS; i++) {
    const t = (i / PATH_POINTS) * Math.PI * 2;
    const r = baseR * (1 + 0.2 * Math.sin(3 * t + seed));
    px[i] = cx + Math.cos(t) * r;
    pz[i] = cz + Math.sin(t) * r;
    const gx = Math.min(N - 1, Math.max(0, Math.round(px[i])));
    const gz = Math.min(N - 1, Math.max(0, Math.round(pz[i])));
    ph[i] = band[gz * N + gx];
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

// Flatten the height field under the track, fading out over an embankment so
// the roadbed meets the hillside instead of cutting a trench through it.
const TRACK_R = 2.6, TRACK_FADE = 5.4;

function carve(N, height, path) {
  const track = new Uint8Array(N * N);
  const weight = new Float32Array(N * N);
  const target = new Float32Array(N * N);
  const r = Math.ceil(TRACK_FADE);
  for (let i = 0; i < PATH_POINTS; i++) {
    const cx = path.px[i], cz = path.pz[i], y = path.h[i];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = Math.round(cx) + dx, gz = Math.round(cz) + dz;
        if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
        const d = Math.hypot(gx + 0.5 - cx, gz + 0.5 - cz);
        if (d > TRACK_FADE) continue;
        const k = gz * N + gx;
        if (d <= TRACK_R) track[k] = 1;
        // smoothstep from full flatten at the roadbed to untouched at the fade.
        let w = 1;
        if (d > TRACK_R) {
          const t = 1 - (d - TRACK_R) / (TRACK_FADE - TRACK_R);
          w = t * t * (3 - 2 * t);
        }
        // Nearest path point wins, so the embankment follows the roadbed grade.
        if (w > weight[k]) { weight[k] = w; target[k] = y; }
      }
    }
  }
  for (let k = 0; k < N * N; k++) {
    if (weight[k] <= 0) continue;
    // Sea floor is never touched: grading it up to the rails built a mound out of
    // the bay that kept its water colouring, so the crossing stood on blue
    // supports. The track spans open water instead.
    if (height[k] < 0) continue;
    height[k] += (target[k] - height[k]) * weight[k];
  }
  return track;
}

// --- the track's own mesh ------------------------------------------------

// Painted onto the terrain grid the track can only have a one-tile blurred edge,
// since corner vertices are shared. A ribbon off the path polyline has exact edges
// that owe nothing to the grid -- and can carry rails.
const RIBBON_LIFT = 0.20;   // clears the ground under the whole bed; reads as embankment
const HALF_W = 1.50;
const BED = [108, 82, 58], RAIL = [176, 170, 160];
// [left offset, right offset, is rail]
const BANDS = [
  [-1.50, -1.05, 0], [-1.05, -0.85, 1], [-0.85, 0.85, 0],
  [0.85, 1.05, 1], [1.05, 1.50, 0],
];

function buildTrackMesh(path, mesh, N) {
  const P = PATH_POINTS, nb = BANDS.length;
  const verts = nb * P * 2;
  const pos = new Float32Array(verts * 3);
  const col = new Uint8Array(verts * 4);
  const nrm = new Int8Array(verts * 4);
  const idx = new Uint32Array(nb * P * 6);

  // A frame per cross-section: horizontal right vector and surface normal.
  const rx = new Float32Array(P), rz = new Float32Array(P);
  const nx = new Float32Array(P), ny = new Float32Array(P), nz = new Float32Array(P);
  for (let i = 0; i < P; i++) {
    const j = (i + 1) % P, k = (i - 1 + P) % P;
    let tx = path.px[j] - path.px[k];
    let tz = path.pz[j] - path.pz[k];
    let ty = (path.h[j] - path.h[k]) * HEIGHT;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const rl = Math.hypot(tz, tx) || 1;
    rx[i] = tz / rl; rz[i] = -tx / rl;
    // n = t x r
    const ax = ty * rz[i] - tz * 0;
    const ay = tz * rx[i] - tx * rz[i];
    const az = tx * 0 - ty * rx[i];
    const al = Math.hypot(ax, ay, az) || 1;
    nx[i] = ax / al; ny[i] = ay / al; nz[i] = az / al;
  }

  // A rail bed is flat across its width, so each cross-section takes one height:
  // the highest ground under it. Sampling only at the ribbon's own vertices misses
  // the bulge between them, and the terrain pokes through the bed.
  const y = new Float32Array(P);
  const SAMPLES = 13;
  for (let i = 0; i < P; i++) {
    // Never below the smoothed grade: over water there is no ground under the
    // bed at all, and the span has to hold its line.
    let hi = path.h[i] * HEIGHT;
    for (let k = 0; k < SAMPLES; k++) {
      const u = -HALF_W + (2 * HALF_W * k) / (SAMPLES - 1);
      const h = sampleH(mesh, N, path.px[i] + rx[i] * u, path.pz[i] + rz[i] * u);
      if (h > hi) hi = h;
    }
    y[i] = hi;
  }
  // Also clear the neighbouring cross-sections, since the surface between two
  // of them is only a chord across whatever the ground does in between.
  const ys = new Float32Array(P);
  for (let i = 0; i < P; i++) {
    ys[i] = Math.max(y[(i - 1 + P) % P], y[i], y[(i + 1) % P]) + RIBBON_LIFT;
  }

  let o = 0;
  for (let b = 0; b < nb; b++) {
    const [uL, uR, isRail] = BANDS[b];
    const c = isRail ? RAIL : BED;
    for (let i = 0; i < P; i++) {
      for (let e = 0; e < 2; e++) {
        const u = e ? uR : uL;
        const v = (b * P + i) * 2 + e;
        const wx = path.px[i] + rx[i] * u, wz = path.pz[i] + rz[i] * u;
        pos[v * 3] = wx;
        pos[v * 3 + 1] = ys[i] + (isRail ? 0.04 : 0);
        pos[v * 3 + 2] = wz;
        col[v * 4] = c[0]; col[v * 4 + 1] = c[1]; col[v * 4 + 2] = c[2]; col[v * 4 + 3] = 255;
        nrm[v * 4] = nx[i] * 127; nrm[v * 4 + 1] = ny[i] * 127; nrm[v * 4 + 2] = nz[i] * 127;
      }
    }
    for (let i = 0; i < P; i++) {
      const j = (i + 1) % P;
      const a = (b * P + i) * 2, d = (b * P + j) * 2;
      idx[o++] = a; idx[o++] = a + 1; idx[o++] = d + 1;
      idx[o++] = a; idx[o++] = d + 1; idx[o++] = d;
    }
  }
  return { pos, col, nrm, idx, tally: idx.length };
}

// --- color --------------------------------------------------------------

function tileColor(q, x, y, volcanic, out) {
  let r, g, b;
  if (q < 0) {
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
  const v = 0.97 + hash(9, x, y) * 0.06;                        // faint per-tile speckle
  out[0] = r * v; out[1] = g * v; out[2] = b * v;
}

// --- mesh ----------------------------------------------------------------

// An indexed grid over the (N+1)^2 corners. Corner height, color and normal are
// all averaged from the cells that touch the corner, so the surface, the shading
// and the biome edges are continuous -- no walls, no stair-steps, no facets.
function buildMesh(N, band, height, volcanic) {
  const S = N + 1;
  const cornerH = new Float32Array(S * S);
  for (let z = 0; z <= N; z++) {
    for (let x = 0; x <= N; x++) {
      let sum = 0, n = 0;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const cx = x + dx, cz = z + dz;
          if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
          sum += height[cz * N + cx];
          n++;
        }
      }
      cornerH[z * S + x] = n ? sum / n : 0;
    }
  }

  const pos = new Float32Array(S * S * 3);
  const col = new Uint8Array(S * S * 4);
  const nrm = new Int8Array(S * S * 4);
  const rgb = new Float32Array(3), acc = new Float32Array(3);

  for (let z = 0; z <= N; z++) {
    for (let x = 0; x <= N; x++) {
      const ci = z * S + x;
      pos[ci * 3] = x;
      pos[ci * 3 + 1] = cornerH[ci] * HEIGHT;
      pos[ci * 3 + 2] = z;

      acc[0] = acc[1] = acc[2] = 0;
      let n = 0;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const cx = x + dx, cz = z + dz;
          if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
          const k = cz * N + cx;
          tileColor(band[k], cx, cz, volcanic[k], rgb);
          acc[0] += rgb[0]; acc[1] += rgb[1]; acc[2] += rgb[2];
          n++;
        }
      }
      col[ci * 4] = acc[0] / n; col[ci * 4 + 1] = acc[1] / n;
      col[ci * 4 + 2] = acc[2] / n; col[ci * 4 + 3] = 255;

      // Analytic normal from central differences of the corner height field.
      const xm = x > 0 ? cornerH[z * S + x - 1] : cornerH[ci];
      const xp = x < N ? cornerH[z * S + x + 1] : cornerH[ci];
      const zm = z > 0 ? cornerH[(z - 1) * S + x] : cornerH[ci];
      const zp = z < N ? cornerH[(z + 1) * S + x] : cornerH[ci];
      const nx = -(xp - xm) * HEIGHT / 2, nz = -(zp - zm) * HEIGHT / 2;
      const len = Math.hypot(nx, 1, nz);
      nrm[ci * 4] = (nx / len) * 127;
      nrm[ci * 4 + 1] = (1 / len) * 127;
      nrm[ci * 4 + 2] = (nz / len) * 127;
    }
  }

  const idx = new Uint32Array(N * N * 6);
  let o = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const a = z * S + x, b = a + 1, c = a + S + 1, d = a + S;
      // Counter-clockwise seen from above.
      idx[o++] = d; idx[o++] = c; idx[o++] = b;
      idx[o++] = d; idx[o++] = b; idx[o++] = a;
    }
  }

  return { pos, col, nrm, idx, tally: idx.length, cornerH, S };
}

// --- entry point ---------------------------------------------------------

export function buildWorld(seed, cfg) {
  const N = cfg.mapSize;
  const { band, volcanic } = generateBands(seed, N, cfg);
  const path = generateTrack(seed, N, band, cfg);
  const height = smoothHeight(band, N, cfg.terrainSmooth);
  addDetail(seed, N, height, cfg.terrainDetail);
  const track = carve(N, height, path);
  const mesh = buildMesh(N, band, height, volcanic);
  const trackMesh = buildTrackMesh(path, mesh, N);
  return { N, elev: band, volcanic, track, route: path, mesh, trackMesh };
}

// Ground height in world units, bilinear over the corner grid so unicorns, the
// cart and the track ribbon all sit exactly on the rendered surface.
export function elevAt(world, x, z) {
  return sampleH(world.mesh, world.N, x, z);
}

function sampleH(mesh, N, x, z) {
  const { S, cornerH } = mesh;
  const fx = x < 0 ? 0 : x > N ? N : x;
  const fz = z < 0 ? 0 : z > N ? N : z;
  const x0 = Math.min(N - 1, fx | 0), z0 = Math.min(N - 1, fz | 0);
  const tx = fx - x0, tz = fz - z0;
  const h00 = cornerH[z0 * S + x0], h10 = cornerH[z0 * S + x0 + 1];
  const h01 = cornerH[(z0 + 1) * S + x0], h11 = cornerH[(z0 + 1) * S + x0 + 1];
  const a = h00 + (h10 - h00) * tx, b = h01 + (h11 - h01) * tx;
  return (a + (b - a) * tz) * HEIGHT;
}

// Cart position at an arc-length distance around the loop.
export function pathAt(path, dist) {
  const n = PATH_POINTS;
  let d = dist % path.length;
  if (d < 0) d += path.length;
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
