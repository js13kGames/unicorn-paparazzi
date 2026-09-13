// Turning a phone is the only way to look around on mobile, and it is the piece
// hardest to check by eye: pointing a handset at a unicorn and squinting tells
// you nothing about whether the maths is right, only that it feels roughly
// sideways. So the real handler is lifted out of src/index.js and driven with
// orientations whose answers are known.
//
// alpha/beta/gamma describe the device frame: X across the screen, Y up it, Z
// out of it. The lens is the BACK of the phone, so the aim is the -Z axis, and
// yaw/pitch fall out of where that lands in the world.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');

let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? '  ok  ' : 'FAIL  ') + n.padEnd(58) + (d || '')); };

const body = /addEventListener\('deviceorientation', \(e\) => \{\n([\s\S]*?)\n\}\);/.exec(src);
check('the orientation handler is still there to test', !!body);

const LIM = Math.PI / 2 - 0.05;
// `yawOff` is module-level in index.js and deliberately survives between events:
// it is the origin the first reading establishes. So the harness holds it too,
// handing it back in and taking it out again, exactly as the module does.
const { RIDE, SHOP } = await import('../.mirror/mode.mjs');
const turn = (cam, state, yawOff, e) => {
  const fn = new Function('cam', 'state', 'yawOff', 'LIM', 'clampPitch', 'RIDE', 'e',
    body[1] + '\nreturn yawOff;');
  const out = fn(cam, state, yawOff, LIM,
                 () => (cam.tilt = Math.max(-LIM, Math.min(LIM, cam.tilt))), RIDE, e);
  return out;
};
// A fresh phone, already looking down the track at yaw 1 the way a ride starts.
const fresh = () => ({ cam: { yaw: 1, tilt: 0 }, state: { phase: RIDE }, off: undefined });
const point = (a, b, g) => {
  const p = fresh();
  p.off = turn(p.cam, p.state, p.off, { alpha: a, beta: b, gamma: g });
  return p;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- the origin ----------------------------------------------------------
// Absolute alpha is a compass heading, and a ride that snapped the player round
// to face magnetic north the instant the first reading landed would throw them
// off the track they were told to look down. The first reading is the origin
// instead, which also makes alpha's drift and the absolute/relative split
// between Android and iOS stop mattering: only the change is ever used.
const start = point(37, 90, 0);
check('the first reading does not move the view', near(start.cam.yaw, 1),
      'yaw ' + start.cam.yaw.toFixed(4));

// --- pitch ---------------------------------------------------------------
// Screen up on a table: the lens is pointing at the table.
const flat = point(0, 0, 0);
check('flat on its back looks straight down', near(flat.cam.tilt, -LIM),
      flat.cam.tilt.toFixed(4));
// Held up like a viewfinder: the lens is on the horizon.
check('held upright looks at the horizon', near(point(0, 90, 0).cam.tilt, 0));
// Tilted back past vertical: the lens climbs.
check('tilted back looks up', point(0, 135, 0).cam.tilt > 0.7);
check('and the clamp holds at the zenith', near(point(0, 180, 0).cam.tilt, LIM));

// --- yaw -----------------------------------------------------------------
// The offset makes a single reading meaningless in isolation, so yaw is tested
// as a pair: establish an origin, then turn, and read the difference.
const swing = (a2) => {
  const p = fresh();
  p.off = turn(p.cam, p.state, p.off, { alpha: 0, beta: 90, gamma: 0 });
  turn(p.cam, p.state, p.off, { alpha: a2, beta: 90, gamma: 0 });
  return p.cam.yaw - 1;
};
check('turning the phone left turns the view left', near(swing(90), Math.PI / 2),
      swing(90).toFixed(4));
check('and turning it right turns the view right', near(swing(-90), -Math.PI / 2));
// Same direction as the mouse, which decreases yaw as it moves right.

// --- the orientation the screen happens to be in -------------------------
// The lens does not care which way up the screen is. A phone aimed north in
// portrait and the same phone aimed north in landscape must give the same
// answer, or the view would lurch the moment the player turned the handset.
const portrait = point(0, 90, 0);
const landscape = point(90, 0, -90);
check('portrait and landscape aim the same way',
      near(portrait.cam.yaw, landscape.cam.yaw, 1e-9) &&
      near(portrait.cam.tilt, landscape.cam.tilt, 1e-9),
      portrait.cam.yaw.toFixed(4) + ' vs ' + landscape.cam.yaw.toFixed(4));

// --- when it must keep its hands off -------------------------------------
const parked = fresh();
parked.state.phase = SHOP;
turn(parked.cam, parked.state, parked.off, { alpha: 90, beta: 90, gamma: 0 });
check('a card on screen is not steered by the handset', near(parked.cam.yaw, 1));

const blind = fresh();
turn(blind.cam, blind.state, blind.off, { alpha: null, beta: null, gamma: null });
check('a device with no sensor is ignored rather than NaN',
      near(blind.cam.yaw, 1) && near(blind.cam.tilt, 0));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
