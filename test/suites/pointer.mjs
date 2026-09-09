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

// `lock` and `shutterQueued` are module-level in index.js; supply them here.
const primary = new Function('state', 'ui', 'document', 'canvas', 'lock',
  'let shutterQueued;\n' + body[1] + '\nreturn shutterQueued;');

function run(mode, locked) {
  const canvas = {};
  const calls = { lock: 0, hidePanel: 0, chrome: null };
  const state = { mode };
  const ui = { hidePanel: () => calls.hidePanel++, setChrome: (v) => { calls.chrome = v; } };
  const doc = { pointerLockElement: locked ? canvas : null };
  const shutter = primary(state, ui, doc, canvas, () => calls.lock++);
  return { ...calls, shutter: shutter === true, mode: state.mode };
}

// The bug: riding without the pointer must re-lock, and must NOT shoot.
const lost = run('ride', false);
check('riding with the pointer lost re-locks', lost.lock === 1);
check('and does not queue the shutter', !lost.shutter);

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

// The lost lock is otherwise invisible, so it has to say something.
check('losing the lock mid-ride tells the player',
      /pointerlockchange[\s\S]{0,220}ui\.toast/.test(src));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
