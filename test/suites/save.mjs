// The save migration, driven through the real index.js logic by loading the
// built bundle in a stubbed DOM with a pre-seeded localStorage.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import vm from 'vm';

const page = fs.readFileSync(ROOT + 'docs/dist/index.html', 'utf8');
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
const injected = new Set();
const node = () => ({ style:{}, className:'', textContent:'', innerHTML:'', dataset:{},
  addEventListener(){}, appendChild(){}, animate(){}, getContext(){return null;},
  toDataURL(){return 'data:,';}, drawImage(){}, requestPointerLock(){} });

function boot(stored) {
  let written = null;
  const sandbox = {
    console: { log(){}, warn(){}, error(){} }, performance, Math, Date, JSON, Map, Set,
    Promise, Uint8Array, Uint16Array, Uint32Array, Int8Array, Float32Array, ArrayBuffer,
    String, Number, Object, Array, Error, Image: class {},
    document: {
      head:{ insertAdjacentHTML(_,h){ for (const m of String(h).matchAll(/id=["']?([\w-]+)/g)) injected.add(m[1]); } },
      body:{ set innerHTML(h){ for (const m of String(h).matchAll(/id=["']?([\w-]+)/g)) injected.add(m[1]); }, get innerHTML(){return '';} },
      getElementById: node, createElement: node, addEventListener(){}, exitPointerLock(){}, pointerLockElement:null,
    },
    addEventListener(){}, requestAnimationFrame(){return 0;},
    devicePixelRatio:1, innerWidth:1280, innerHeight:720,
    location: { hash: '', reload() {} },
    localStorage: {
      getItem: () => (stored === null ? null : JSON.stringify(stored)),
      setItem: (_, v) => { written = JSON.parse(v); }, removeItem(){},
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  let err = null;
  try { vm.runInNewContext(script, sandbox, { timeout: 60000 }); } catch (e) { err = e; }
  if (!err || !/no gl/.test(err.message)) throw err || new Error('expected the GL stop');
  return sandbox;
}

let fails = 0;
const check = (n, ok, d) => { if(!ok) fails++; console.log((ok?'  ok  ':'FAIL  ') + n.padEnd(56) + (d||'')); };

// A save from an older version, carrying fields this build no longer knows.
boot({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0], w: false });
check('an old colour-array save still loads', true);

// A current save must be taken at face value.
boot({ v: 3, b: 900, z: 1, r: 0, f: 0, a: 7, s: 3, w: true });
check('a current save loads', true);

// No save at all.
boot(null);
check('a fresh player loads', true);
check('the bootstrap built the DOM in every case', injected.has('c') && injected.has('film'));

// What a save actually restores, evaluated from the real source text rather than
// a copy, so it cannot drift away from what ships.
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');
const VERSION = +/const SAVE_VERSION = (\d+)/.exec(src)[1];

// Each field of the state literal is one expression over `saved`; lift them out
// and run them against a fake save.
const restore = (saved) => {
  const grab = (key) => {
    const m = new RegExp('^  ' + key + ': (.+),$', 'm').exec(src);
    if (!m) throw new Error('no ' + key + ' in the state literal');
    return new Function('saved', 'return ' + m[1])(saved);
  };
  return { bank: grab('bank'), maxZoom: grab('maxZoom'), res: grab('res'),
           filmTier: grab('filmTier'), shutterTier: grab('shutterTier') };
};

const old = restore({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0] });
check('an old save keeps its bank', old.bank === 4200, String(old.bank));
check('an old save keeps its upgrades', old.maxZoom === 2 && old.res === 1 && old.filmTier === 3);

const fresh = restore({});
check('a fresh player starts at zero everywhere',
      !fresh.bank && !fresh.maxZoom && !fresh.res && !fresh.filmTier && !fresh.shutterTier);

// res indexes resBonus/resNames directly, so an out-of-range save used to give a
// NaN score rather than a visible failure.
check('a camera tier beyond the ladder is clamped', restore({ r: 9 }).res, 3);
check('and a legitimate top tier survives', restore({ r: 3 }).res, 3);

// --- the multiplayer lap -------------------------------------------------
// A multiplayer lap rides borrowed gear. Two things have to hold or it quietly
// eats the player's save: the override must land, and nothing after it may write
// gear back. Both are read out of the real source rather than reimplemented.
const mpBlock = /^const MP_GEAR[\s\S]*?^}$/m.exec(src);
check('the multiplayer boot block is still there to test', !!mpBlock);

const mpBoot = (saved) => {
  // filmTier starts at a value the fixed loadout does not use, so "it was
  // overwritten" is visible even when the loadout's own value is zero.
  const state = { bank: 900, maxZoom: 0, res: 0, filmTier: 4, shutterTier: 0, go: 1, code: '' };
  const writes = [];
  new Function('saved', 'state', 'persist', mpBlock[0])(
    saved, state, () => writes.push({ ...state }));
  return { state, writes };
};

const solo = mpBoot({ v: VERSION, g: 1 });
check('a solo lap is left completely alone',
      !solo.state.mp && !solo.state.res && solo.state.filmTier === 4 &&
      solo.writes.length === 0);

// `c` with no `g` is a lobby to go back to, not a lap to start. If this block
// fired on it, the lobby would inherit state.mp -- and persist() being a no-op
// would mean walking out of the lobby could never clear the code.
const lobbyOnly = mpBoot({ v: VERSION, c: '4821', h: 1 });
check('a lobby code with no lap marker starts no lap',
      !lobbyOnly.state.mp && !lobbyOnly.state.res && lobbyOnly.writes.length === 0);

const mp = mpBoot({ v: VERSION, g: 1, c: '4821', h: 1 });
check('a multiplayer lap is flagged as one', mp.state.mp === 1);
check('and restores which lobby it belongs to, and who hosted it',
      mp.state.code === '4821' && mp.state.host === 1);
check('and rides the fixed loadout, whatever the save held',
      mp.state.res > 0 && mp.state.maxZoom > 0 && mp.state.filmTier !== 4);
check('the markers are cleared, so a stray refresh drops out of multiplayer',
      mp.state.go === 0 && mp.writes.length === 1);
check('and that write went out BEFORE the gear was swapped, so it saved the real one',
      !mp.writes[0].res && !mp.writes[0].maxZoom &&
      mp.writes[0].filmTier === 4 && mp.writes[0].bank === 900);

// The guard is the whole defence: every later persist() -- finishing the lap,
// buying nothing, anything -- must be a no-op for the rest of the page's life.
const guard = /^function persist\(\) \{\n  if \(state\.mp\) return;$/m.test(src);
check('persist() refuses to run at all once the lap is a multiplayer one', guard);

// The code is what carries the lobby across the reload; without it on the wire
// format, everyone would reconnect to nothing.
check('the save carries the lobby code', /c: state\.code/.test(src));
// Without the host flag, everyone comes back from a rematch as a guest and
// nobody can start the next lap.
check('and who the host was', /h: state\.host/.test(src));

// --- actually getting the page to reload ---------------------------------
// Every lap transition is a reload, because the world has to be rebuilt. The
// trap: a URL that differs from the current one ONLY in its fragment is a
// same-document navigation, so assigning location.href looks like a reload and
// silently is not. This stub models that rule, so the bug it caused -- "Start
// Multiplayer Game" doing nothing at all -- cannot come back.
const fakeLocation = (href) => {
  const [path, hash = ''] = href.split('#');
  const loc = {
    pathname: path, reloads: 0,
    get hash() { return loc._h ? '#' + loc._h : ''; },
    set hash(v) { loc._h = String(v).replace(/^#/, ''); },
    get href() { return loc.pathname + loc.hash; },
    // Assigning href only reloads when the result is not a bare fragment change.
    set href(v) {
      const [p2, h2 = ''] = String(v).split('#');
      if (p2 !== loc.pathname) loc.reloads++;   // a real navigation
      loc.pathname = p2;
      loc._h = h2;
    },
    reload() { loc.reloads++; },
  };
  loc._h = hash;
  return loc;
};

const navBlock = (name) => {
  const m = new RegExp('^(?:const ' + name + ' = |function ' + name + ')[\\s\\S]*?^(?:};|})$', 'm').exec(src);
  if (!m) throw new Error('no ' + name + ' to test');
  return m[0];
};

const navigate = (name, from, call) => {
  const location = fakeLocation(from);
  const state = { mode: 'lobby' };
  new Function('location', 'state', 'persist',
               navBlock(name) + ';' + call)(location, state, () => {});
  return location;
};

// The one the player actually hit: the lobby lives at the bare path, so the lap
// used to be started by a fragment change that never reloaded anything.
const started = navigate('start', 'index.html', 'start(4242)');
check('starting a multiplayer lap really reloads', started.reloads > 0);
check('and carries the seed across in the hash', started.hash === '#4242', started.hash);

// Coming back from a lap, the URL DOES carry a seed, so dropping it is once again
// a fragment-only change -- and once again not a reload.
const back = navigate('home', 'index.html#4242', 'home()');
check('leaving a lap really reloads', back.reloads > 0);
check('and drops the seed, so it does not stick to the next lap',
      !+back.hash.slice(1), back.hash);

// The plain case has always worked, because the target URL was byte-identical.
const plain = navigate('home', 'index.html', 'home()');
check('and it still reloads when there was no seed to drop', plain.reloads > 0);

// --- what ends a lap -----------------------------------------------------
// Solo, an empty roll ends the ride. In a match it must not: the first rider to
// burn their film would be thrown off the track while the others kept shooting,
// and they would not finish together.
const endBlock = /^ {4}if \(lap >= 1\) endRun[\s\S]*?net\.allSpent\(\)\)\) endRun\(\);$/m.exec(src);
check('the lap-end conditions are still there to test', !!endBlock);

const ends = (lap, state, allSpent = false) => {
  let over = false;
  new Function('lap', 'state', 'net', 'endRun', endBlock[0])(
    lap, state, { allSpent: () => allSpent }, () => { over = true; });
  return over;
};

check('solo, finishing the track ends the lap', ends(1, { film: 9 }));
check('and so does running out of film', ends(0.3, { film: 0 }));
check('in a match, your own roll running out does NOT end the lap',
      !ends(0.3, { film: 0, mp: 1 }));
// ...but once every roll in the room is empty there is nothing left to ride for.
check('a match ends early when the last roll in the room runs dry',
      ends(0.3, { film: 0, mp: 1 }, true));
check('a rider who still has film is not stopped by that',
      !ends(0.3, { film: 4, mp: 1 }, true));
check('and a match rider always stops at the end of the track',
      ends(1, { film: 0, mp: 1 }));

// The room only learns a roll is empty because the rider says so.
check('running dry is announced to the room', /net\.noFilm\(\)/.test(src));
check('at the moment the last frame is spent',
      /if \(state\.mp && !state\.film\) net\.noFilm\(\);/.test(src));

// --- who the results screen is still waiting for -------------------------
// A finished rider's result now outlives their connection, so the roster can be
// SMALLER than the set of results on the board. Without the clamp this goes
// negative, and a negative is truthy: the screen would sit on "waiting for -1"
// for good, with the winner never crowned.
const waitLine = /^ {2}const waiting = .*$/m.exec(src);
check('the waiting count is still there to test', !!waitLine);

const waitingFor = (roster, results) => {
  let out;
  new Function('net', 'rivals', 'Math', waitLine[0] + '; return waiting;');
  out = new Function('net', 'rivals', 'Math', waitLine[0] + '\nreturn waiting;')(
    { lobby: () => new Array(roster) }, new Array(results), Math);
  return out;
};

check('two riders, one reported: still waiting for one', waitingFor(2, 0) === 1);
check('two riders, both reported: waiting for nobody', waitingFor(2, 1) === 0);
check('a rider who left after reporting cannot drive it negative',
      waitingFor(1, 1) === 0, waitingFor(1, 1));
check('nor can several of them', waitingFor(1, 3) === 0, waitingFor(1, 3));

// --- which screen a load lands on --------------------------------------------
// Three routes, and the one-shot `g` marker is what separates "Ride again"
// (straight onto the cart) from an actual refresh (back to the shop).
const bootLines = /^if \(saved\.g\)[\s\S]*?^else title\(\);$/m.exec(src);
check('the boot routing is still there to test', !!bootLines);

const route = (saved) => {
  const hit = [];
  const state = {};
  new Function('saved', 'state', 'persist', 'primary', 'showShop', 'title', 'lobby', 'ui',
               bootLines[0])(
    saved, state,
    () => hit.push('persist'), () => hit.push('ride'), () => hit.push('shop'),
    () => hit.push('title'), (c, h) => hit.push('lobby:' + c + ':' + (h || 0)),
    { toast: () => {} });
  return { hit, go: state.go };
};

check('a fresh player lands on the title', route({}).hit.join() === 'title');

// `c` without `g` is what Rematch and a mid-match refresh come back to: it means
// "you belong to this lobby", not "a lap is starting".
check('a lobby code alone lands back in that lobby',
      route({ v: VERSION, c: '4821', h: 1 }).hit.join() === 'lobby:4821:1');
check('and it carries whether you were the host',
      route({ v: VERSION, c: '4821' }).hit.join() === 'lobby:4821:0');
check('a lobby code outranks the shop, so a match is not silently left',
      !route({ v: VERSION, b: 900, c: '4821' }).hit.includes('shop'));
check('but the code alone never starts a lap',
      !route({ v: VERSION, c: '4821' }).hit.includes('ride'));
check('a plain refresh lands on the shop', route({ v: VERSION }).hit.join() === 'shop');
const again = route({ v: VERSION, g: 1 });
check('the ride marker lands on the cart', again.hit.includes('ride'), true);
check('and the marker is consumed so the next refresh does not re-ride',
      again.go === 0 && again.hit.includes('persist'), true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
