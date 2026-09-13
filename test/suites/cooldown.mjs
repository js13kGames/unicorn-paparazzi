// The gate, not the readout. The previous test set state.ready by hand and only
// checked the HUD string, so a cooldown that never blocked anything passed.
// This drives the real takePhoto guard, evaluated from the shipping source.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');

const tiersSrc = /shutterTiers: (\[[^\]]*\])/.exec(src);
const guardSrc = /function takePhoto\(\) \{\n(\s*if \([^\n]*\)\s*return;\n\s*state\.armed = [^\n]*\n\s*state\.film--;)/.exec(src);

let fails = 0;
const check = (n, ok, d) => { if(!ok) fails++; console.log((ok?'  ok  ':'FAIL  ')+n.padEnd(58)+(d||'')); };

check('shutterTiers exists in CONFIG', !!tiersSrc);
check('takePhoto still guards on film and readiness', !!guardSrc);
const TIERS = JSON.parse(tiersSrc[1]);
console.log('  tiers: ' + TIERS.join(' / ') + ' seconds\n');

// Rebuild the guard verbatim so the test cannot drift from the source.
const shoot = new Function('state', 'clock', 'CONFIG', `
  ${guardSrc[1]}
  return true;
`);
const CONFIG = { shutterTiers: TIERS };

for (let tier = 0; tier < TIERS.length; tier++) {
  const cd = TIERS[tier];
  const state = { film: 10, armed: 0, sh: tier };
  const fired = (t) => { try { return shoot(state, t, CONFIG) === true; } catch { return false; } };

  const a = fired(0);
  const during = fired(cd * 0.5);
  const after = fired(cd * 1.01);
  check('tier ' + tier + ' (' + cd + 's): first shot fires', a);
  check('tier ' + tier + ': a second shot inside the window is refused', !during);
  check('tier ' + tier + ': it does not consume film either', state.film === 8,
        'film ' + state.film);
  check('tier ' + tier + ': the shot after the window fires', after);
}

// out of film still blocks regardless of readiness
const dry = { film: 0, armed: 0, sh: 0 };
check('an empty roll is refused even when ready', shoot(dry, 999, CONFIG) !== true);

// --- a ride is a span of time, not a lap --------------------------------
// Measured in laps, the drive train was an upgrade you paid for to get *fewer*
// chances: the loop ended sooner, so the same roll met less scenery and the
// motor drive had less to do. These pin the rule that fixed it, because it is
// one line and it reads like an implementation detail.
const SRC = await (await import('fs')).promises.readFile(
  new URL('../../src/index.js', import.meta.url), 'utf8');
const RIDE_SECONDS = +(/const RIDE_SECONDS = (\d+);/.exec(SRC) || [])[1];
check('a ride has a length in seconds', RIDE_SECONDS > 0, String(RIDE_SECONDS));
const progress = /const ride = (.+);/.exec(SRC)[1];
check('ride progress is measured off the tick clock, not the track',
      /clock \/ RIDE_SECONDS/.test(progress), progress);
check('so the drive train cannot shorten a ride',
      !/path\.length|distance/.test(progress), progress);
// Every ride starts from a page load, so the tick clock is always 0 at the line.
check('and the clock it is measured against starts every ride at zero',
      /^let clock = 0;/m.test(SRC), true);
// The shutter is what limits how many frames a ride can offer, and that budget
// has to be worth more than one roll of film or the motor drive buys nothing.
const tiersOf = (t) => Math.floor(RIDE_SECONDS / t);
check('the slowest shutter still offers a roll\'s worth of chances',
      tiersOf(TIERS[0]) >= 10, String(tiersOf(TIERS[0])));
check('and the fastest offers meaningfully more',
      tiersOf(TIERS[TIERS.length - 1]) > tiersOf(TIERS[0]) * 3,
      tiersOf(TIERS[0]) + ' -> ' + tiersOf(TIERS[TIERS.length - 1]));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
