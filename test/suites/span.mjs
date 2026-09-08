// Over open water the rails must hold their line above the sea, with nothing
// holding them up.
import { buildWorld, pathAt, elevAt, WATER_Y } from '../.mirror/terrain.mjs';
const cfg = { mapSize:500, plainStickiness:.75, terrainSmooth:2, terrainDetail:.35, trackRadiusFrac:.25 };
let fails = 0;
const check = (n, ok, d) => { if(!ok) fails++; console.log((ok?'  ok  ':'FAIL  ')+n.padEnd(52)+(d||'')); };
let spans = 0, lowest = 1e9, deepest = 0;
for (const seed of [12345, 777, 42, 20260907, 5]) {
  const w = buildWorld(seed, cfg);
  const tm = w.trackMesh, P = 1024, bed = 2;
  for (let i = 0; i < P; i++) {
    const v = ((bed*P + i)*2)*3;
    const x = tm.pos[v], railY = tm.pos[v+1], z = tm.pos[v+2];
    const ground = elevAt(w, x, z);
    if (ground > WATER_Y) continue;              // on land, not a span
    spans++;
    lowest = Math.min(lowest, railY);
    deepest = Math.max(deepest, railY - ground);  // how far it floats
  }
}
console.log('  ' + spans + ' rail vertices sit over water');
console.log('  lowest rail there: ' + lowest.toFixed(2) + '   water line ' + WATER_Y.toFixed(2));
console.log('  greatest gap under the span: ' + deepest.toFixed(1) + ' units');
check('the rails never dip below the water line', lowest > WATER_Y, lowest.toFixed(2));
console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails?1:0);
