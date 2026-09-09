// Ballistics, against the real constants and real terrain. throwLure lives in
// index.js and cannot be imported, so the launch numbers are read straight out
// of the source: if someone retunes them, this test retunes with them.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { buildWorld, pathAt, elevAt } from '../.mirror/terrain.mjs';
import { spawn, updateHerd } from '../.mirror/unicorn.mjs';

const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');
const num = (k) => +new RegExp(k + ':\\s*([\\d.]+)').exec(src)[1];
const SPEED = num('throwSpeed'), G = num('gravity'), EYE = num('eyeHeight');
console.log('  throwSpeed ' + SPEED + '   gravity ' + G + '\n');

const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35,
              trackRadiusFrac:.25, unicornDensity:.003, adultChance:.75, driftChance:.08,
              poseWeights:[.80,.10,.08,.02], weakRadius:26, strongRadius:70,
              lureLife:45, lureSpeed:4, lurePull:0.7, lureGather:5 };
const w = buildWorld(12345, cfg);

// Mirrors throwLure's integration exactly.
function throwFrom(dist, pitch, yawOff) {
  const p = pathAt(w.path, dist), q = pathAt(w.path, dist + 4);
  const yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z)) + yawOff;
  const ex = p.x, ez = p.z, ey = elevAt(w, p.x, p.z) + EYE;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const vx = -Math.sin(yaw) * cp * SPEED, vz = -Math.cos(yaw) * cp * SPEED, vy = sp * SPEED;
  let t = 0, x = ex, y = ey, z = ez;
  while (t < 12) {
    t += 0.05;
    x = ex + vx * t; y = ey + vy * t - 0.5 * G * t * t; z = ez + vz * t;
    if (y <= elevAt(w, x, z)) break;
  }
  return { range: Math.hypot(x - ex, z - ez), t, x, z };
}

let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log((ok?'  ok  ':'FAIL  ') + n.padEnd(52) + (d||'')); };

console.log('  pitch   range   flight');
const ranges = {};
for (const deg of [0, 15, 30, 45, 60, 75]) {
  const r = throwFrom(200, deg * Math.PI / 180, 0);
  ranges[deg] = r.range;
  console.log('  ' + String(deg).padStart(4) + '°' + r.range.toFixed(0).padStart(8) + r.t.toFixed(1).padStart(8) + 's');
}
console.log('');
check('a 45° throw carries ~190 units', Math.abs(ranges[45] - 190) < 19, ranges[45].toFixed(0));
check('a flat throw lands short', ranges[0] < 60, ranges[0].toFixed(0));
check('range peaks near 45°', ranges[45] > ranges[30] && ranges[45] > ranges[60], true);
check('a steep lob falls short again', ranges[75] < ranges[45], true);

// aim matters: the same pitch in a different direction lands somewhere else
const ahead = throwFrom(200, Math.PI / 4, 0);
const side = throwFrom(200, Math.PI / 4, Math.PI / 2);
check('yaw changes where it lands',
      Math.hypot(ahead.x - side.x, ahead.z - side.z) > 100, true);

// --- still inert while airborne, still gathers after landing ---
//
// "Inert" is measured against the herd's own wandering, not an absolute distance.
// It used to allow 3 units of drift in the 2.5s before touchdown, which is almost
// exactly how far a standing unicorn wanders anyway (max 3.03 on this seed), so
// any reseeding of the herd flipped the result. Running the same simulation with
// and without the lure isolates the lure's contribution instead.
function fly(withLure) {
  const h = spawn(w, cfg, 12345);
  for (let i = 0; i < 300; i++) updateHerd(h, w, cfg, 1/60, []);
  const X = h.x[0] + 30, Z = h.z[0];
  const lure = { x:X, z:Z, fx:h.x[0], fz:h.z[0], fy:5, launched:0, flightTime:3.0,
                 strong:true, until: 3.0 + cfg.lureLife };
  const near = () => { let n=0; for (let i=0;i<h.n;i++) if (Math.hypot(h.x[i]-X,h.z[i]-Z)<12) n++; return n; };
  const n0 = near();
  let clock = 0, airborne = null;
  for (let f = 0; f < 60 * 40; f++) {
    clock += 1/60;
    lure.flight = Math.min(1, clock / lure.flightTime);
    lure.flying = lure.flight < 1;
    updateHerd(h, w, cfg, 1/60, withLure ? [lure] : []);
    // Snapshot mid-flight, half a second before it lands.
    if (Math.abs(clock - 2.5) < 1/120) airborne = h.x.slice();
  }
  return { n0, near: near(), airborne };
}
const withLure = fly(true), without = fly(false);
check('nothing is hauled in while the lure is in the air',
      withLure.airborne.every((x, i) => x === without.airborne[i]));
check('the herd gathers once it lands (' + withLure.n0 + ' -> ' + withLure.near + ')',
      withLure.near > withLure.n0 + 5);
// ...and the gathering is the lure's doing, not the wander's.
check('a herd with no lure does not gather', without.near <= without.n0 + 5);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
