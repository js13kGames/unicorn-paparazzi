// Escape during a ride released the pointer but left state.mode === 'ride', so
// the next click fell through to the shutter: the only way to get the mouse
// back was to spend a frame of film. primary() now has to look at the lock as
// well as the mode.
//
// Like the cooldown suite, this lifts the real function out of src/index.js and
// evaluates it, so the assertions cannot drift from what ships.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');

let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? '  ok  ' : 'FAIL  ') + n.padEnd(58) + (d || '')); };

const body = /function primary\(\) \{\n([\s\S]*?)\n\}/.exec(src);
check('primary() is still there to test', !!body);

// `lock`, `net`, `seed`, `TOUCH`, `askIMU`, `multi` and `shutterQueued` are all
// module-level in index.js; supply them here.
const primary = new Function('state', 'ui', 'document', 'canvas', 'lock', 'net', 'seed',
  'TOUCH', 'askIMU', 'multi',
  'let shutterQueued;\n' + body[1] + '\nreturn shutterQueued;');

function run(mode, locked, touch, multi) {
  const canvas = {};
  const calls = { lock: 0, hidePanel: 0, chrome: null, announced: null, imu: 0 };
  const state = { mode };
  const ui = { hidePanel: () => calls.hidePanel++, setChrome: (v) => { calls.chrome = v; } };
  const doc = { pointerLockElement: locked ? canvas : null };
  const net = { go: (s) => { calls.announced = s; } };
  const shutter = primary(state, ui, doc, canvas, () => calls.lock++, net, 4242,
                          !!touch, () => calls.imu++, !!multi);
  return { ...calls, shutter: shutter === true, mode: state.mode };
}

// The bug: riding without the pointer must re-lock, and must NOT shoot.
const lost = run('ride', false);
check('riding with the pointer lost re-locks', lost.lock === 1);
check('and does not queue the shutter', !lost.shutter);

// Starting a ride used to shout its seed at every player in the game, and any idle
// one was yanked onto it. Lobbies replaced that, so the title must stay quiet --
// nothing about a single-player ride reaches the wire.
const started = run('title', false);
check('starting from the title tells nobody', started.announced === null);
check('and neither does riding', run('ride', true).announced === null);

// The normal case still works.
const riding = run('ride', true);
check('riding with the pointer held takes the photo', riding.shutter);
check('and does not fight for the lock', riding.lock === 0);

// The title click still starts the ride.
const title = run('title', false);
check('the title click starts the ride', title.mode === 'ride');
check('it takes the pointer', title.lock === 1);
check('it hides the panel and shows the hud', title.hidePanel === 1 && title.chrome === true);
check('and it does not shoot on the way in', !title.shutter);

// Panels own their own clicks; primary must keep its hands off.
for (const mode of ['results', 'detail', 'shop']) {
  const p = run(mode, false);
  check('a click in ' + mode + ' does nothing', !p.shutter && p.lock === 0);
}

// --- touch, where there is no lock to be had ------------------------------
// A phone can never satisfy `pointerLockElement === canvas`, so the desktop
// rule -- "a click only shoots while locked" -- means a tap could never take a
// photograph at all. It has to shoot on its own terms.
const tap = run('ride', false, 1);
check('a tap while riding shoots', tap.shutter);
check('and never asks for a lock it cannot have', tap.lock === 0);
check('and re-asks iOS for the orientation stream', tap.imu === 1);
// Letting go of a two-finger pinch also fires a click. Working the lens must
// not cost a frame of film.
check('the tail of a pinch does not shoot', !run('ride', false, 1, 1).shutter);

const touchTitle = run('title', false, 1);
check('a tap on the title still starts the ride', touchTitle.mode === 'ride');
check('and asks for the orientation stream instead of the pointer',
      touchTitle.imu === 1 && touchTitle.lock === 0);

// The lost lock is otherwise invisible, so the hud has to say something for as
// long as it lasts -- see the hud suite for the behaviour itself.
const hud = fs.readFileSync(ROOT + 'src/ui.js', 'utf8');
check('losing the lock mid-ride tells the player',
      /!document\.pointerLockElement[\s\S]{0,40}click to look/.test(hud));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
