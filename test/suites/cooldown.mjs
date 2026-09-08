// The gate, not the readout. The previous test set state.ready by hand and only
// checked the HUD string, so a cooldown that never blocked anything passed.
// This drives the real takePhoto guard, evaluated from the shipping source.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');

const tiersSrc = /shutterTiers: (\[[^\]]*\])/.exec(src);
const guardSrc = /function takePhoto\(\) \{\n(\s*if \([^\n]*\)\s*return;\n\s*state\.ready = [^\n]*\n\s*state\.film--;)/.exec(src);

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
  const state = { film: 10, ready: 0, shutterTier: tier };
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
const dry = { film: 0, ready: 0, shutterTier: 0 };
check('an empty roll is refused even when ready', shoot(dry, 999, CONFIG) !== true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
