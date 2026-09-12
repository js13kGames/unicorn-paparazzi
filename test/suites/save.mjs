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
check('an old color-array save still loads', true);

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
// The screen names are one-letter constants in ui.js now; lifted source that
// tests against one needs it in scope. Imported, not restated -- a letter
// spelled out here could drift from the one that ships.
const { TITLE, SHOP, LOBBY } = await import('../.mirror/mode.mjs');
const VERSION = +/const SAVE_VERSION = (\d+)/.exec(src)[1];

// Each field of the state literal is one expression over `saved`; lift them out
// and run them against a fake save.
const CONFIG = (0, eval)('(' + /export const CONFIG = (\{[\s\S]*?\n\});/.exec(src)[1] + ')');
const restore = (saved) => {
  const grab = (key) => {
    const m = new RegExp('^  ' + key + ': (.+),$', 'm').exec(src);
    if (!m) throw new Error('no ' + key + ' in the state literal');
    // Some fields clamp themselves against CONFIG now, so it has to be in scope.
    return new Function('saved', 'CONFIG', 'return ' + m[1])(saved, CONFIG);
  };
  return { bank: grab('bank'), maxZoom: grab('maxZoom'), res: grab('res'),
           shutterTier: grab('shutterTier'), rides: grab('rides'),
           dead: grab('dead') };
};

const old = restore({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0] });
check('an old save keeps its bank', old.bank === 4200, String(old.bank));
check('an old save keeps its upgrades', old.maxZoom === 2 && old.res === 1);

// Film is not in the save at all any more -- it refills to FRAMES every ride, so
// there is no stock to carry and nothing to migrate. `f` is still written by old
// builds and sitting in saves in the wild; it must simply be ignored.
const FRAMES = +/^const FRAMES = (\d+);/m.exec(src)[1];
check('the roll is a fixed size, not a saved stock', FRAMES > 0, String(FRAMES));
check('and film is no longer a field of the state literal',
      !/^  film: saved\./m.test(src));
// Likewise the cart tier: the ladder is gone, and `d` is dead weight in old
// saves. Nothing may quietly start reading it again -- an existing save carries
// a cart tier under that letter and would be misread as something else.
check('the cart tier is gone from the save', !/\bd: state\./.test(src));
check('and nothing reads `d` back out', !/saved\.d\b/.test(src));

const fresh = restore({});
check('a fresh player starts at zero everywhere',
      // ...but the zoom starts on the free rung, not at nothing: index 1 is the
      // 1.2x step every camera owns so the wheel does something on day one.
      !fresh.bank && fresh.maxZoom === 1 && !fresh.res && !fresh.shutterTier);
check('a fresh player has taken no rides', fresh.rides === 0, String(fresh.rides));
check('and is not already dead', !fresh.dead, String(fresh.dead));
check('a save from before the counter existed reads as none taken',
      restore({ v: 4, b: 900, f: 3 }).rides === 0);
check('and one that has been ridden keeps its count',
      restore({ v: 4, s: 6 }).rides === 6);
// The quota flag has to survive the reload between the ride that missed it and
// the shop that reports it, which is the only reason it is in the save.
check('a run that missed its quota stays missed', restore({ v: 4, q: 1 }).dead === 1);

// res indexes resBonus/resNames directly, so an out-of-range save used to give a
// NaN score rather than a visible failure.
check('a camera tier beyond the ladder is clamped', restore({ r: 9 }).res, 3);
check('and a legitimate top tier survives', restore({ r: 3 }).res, 3);

// --- the dead end --------------------------------------------------------
// "The last ride came in under its quota" is the whole failure condition now.
// It used to be "no frames, and not enough money for one", which ended a run by
// arithmetic; this ends one by photography.
const brokeSrc = /^const broke = .+$/m.exec(src)[0];
check('the dead-end test is still there to test', !!brokeSrc);
const isBroke = (dead) => new Function('state', brokeSrc + ';return !!broke()')({ dead });
check('a missed quota is the dead end', isBroke(1) === true);
check('and a run still going is not', isBroke(0) === false);

// --- the quota curve -----------------------------------------------------
// Lifted whole rather than reconstructed from a power: it was reconstructed
// once, and when the shape changed the pattern quietly stopped matching and left
// this suite checking a curve the game no longer had.
const goalSrc = /^const GOAL = .+\nconst goal = .+$/m.exec(src)[0];
const goalAt = (n) => new Function('n', goalSrc + ';return goal(n)')(n);
check('the first level asks for something', goalAt(0) > 0, String(goalAt(0)));
check('and every level asks for more than the last',
      [0,1,2,3,4,5].every((n) => goalAt(n + 1) > goalAt(n)));
// It has to climb GEOMETRICALLY: takings compound with gear, and a player whose
// income compounds will outrun any straight line forever.
check('and it climbs faster than linearly',
      goalAt(4) > goalAt(2) * 2, goalAt(2) + ' -> ' + goalAt(4));

// The film economy is gone entire, and nothing may quietly bring a piece of it
// back -- a price, a purchasable frame, or a bulk roll.
check('nothing prices film any more', !/const (FILM|price) = /.test(src));
check('and nothing sells it', !/frames\(/.test(src));

// The shop is where the dead end is discovered -- it is what the end of a run
// and a plain reload both land on -- so the routing out of it is the thing that
// actually decides whether losing is reachable at all.
const shopSrc = /^function showShop\(\)[\s\S]*?^}$/m.exec(src)[0];
const routed = (dead) => {
  let to = null;
  const state = { dead, rides: 0 };
  new Function('state', 'broke', 'ui', 'CONFIG', 'offers', 'buy', 'ride', 'title',
               'SHOP', 'goal', shopSrc + ';showShop()')(
    state, () => state.dead,
    { showShop: () => { to = 'shop'; } }, {}, () => [], 0, 0,
    () => { to = 'title'; }, SHOP, () => 0);
  return to;
};
check('a player who missed the quota is sent to the dead end',
      routed(1) === 'title', String(routed(1)));
check('and one still in the run gets the shop', routed(0) === 'shop');

// The title carries the dead end too, because a lobby you walk out of lands
// there rather than on the shop. If it stopped asking, Solo would ride a whole
// ride with a dead shutter.
const titleSrc = /^function title\(\)[\s\S]*?^}$/m.exec(src)[0];
const titled = (dead) => {
  let lost;
  const state = { dead, rides: 0 };
  new Function('state', 'broke', 'ui', 'solo', 'lobby', 'saved', 'restart',
               'read', 'SAVE_KEY', 'PIC_KEY', 'TITLE', 'goal', titleSrc + ';title()')(
    state, () => state.dead,
    { showTitle: (a, b, c, d) => { lost = d; } }, 0, 0, { v: 4 }, 0,
    // Both the save and the best photograph are read live off their own keys,
    // so title() needs the reader and both keys handed to it here.
    (k) => (k === 'saf' ? { v: 4 } : {}), 'saf', 'pic', TITLE, () => 0);
  return !!lost;
};
check('the title shows the dead end when the quota was missed', titled(1) === true);
check('and does not while the run is still going', titled(0) === false);
// Reset is gated on there being a save to wipe -- but on a LIVE read of it.
// `saved` is the snapshot taken at boot and nothing refreshes it, so gating on
// `saved.v` hid the button through a whole first session however far the player
// got, and the dead end, whose only way out is Reset, became a wall.
const titleCode = titleSrc.replace(/\/\/.*$/gm, '');
check('Reset is gated on a save', /read\(SAVE_KEY\)/.test(titleCode), titleCode);
check('and never on the stale boot snapshot',
      !/\bsaved\b/.test(titleCode), titleCode);

// The live read must actually reach ui.showTitle, or the gate is decorative.
{
  let saw;
  new Function('state', 'broke', 'ui', 'solo', 'lobby', 'restart',
               'read', 'SAVE_KEY', 'PIC_KEY', 'TITLE', 'goal', titleSrc + ';title()')(
    { rides: 0 }, () => false,
    { showTitle: (a, b, c, d, e) => { saw = e; } }, 0, 0, 0,
    () => ({}), 'saf', 'pic', TITLE, () => 0);
  check('so a player with nothing saved is offered no wipe', !saw);
}

// The shutter spends a frame, and -- since the roll refills every ride -- must
// NOT write the save doing it. That write existed when a frame was money and a
// reload mid-ride would otherwise hand the roll back free; now it is a JSON
// serialise and a localStorage hit per shutter press for a field nothing reads.
const shotSrc = /^function takePhoto\(\)[\s\S]*?^}$/m.exec(src)[0];
const shot = (film) => {
  const state = { film, ready: 0, shutterTier: 0, res: 0, fx: 1, fy: 1,
                  photos: [], scored: [] };
  const saved = [];
  new Function('state', 'clock', 'CONFIG', 'net', 'ui', 'photoRig', 'scorePhoto',
               'fov', 'herd', 'cam', 'persist', shotSrc + ';takePhoto()')(
    state, 0, { shutterTiers: [0.8] }, { noFilm() {} },
    { flash() {}, addThumb() {} }, { capture: () => ({ url: '' }) },
    () => ({}), () => 1, null, null, () => saved.push(state.film));
  return { left: state.film, saved };
};
check('taking a photograph spends a frame', shot(5).left === 4);
check('and does not touch the save doing it',
      shot(5).saved.length === 0, JSON.stringify(shot(5).saved));
check('a shutter with no film left spends nothing', shot(0).left === 0);

// The other half of the round trip. restore() above pins what each key is read
// back as; nothing pinned what gets written under it, so `f` could stop carrying
// the roll and every read-side check would still pass.
const persistSrc = /^function persist\(\)[\s\S]*?^}$/m.exec(src)[0];
const persisted = (st) => {
  let out = null;
  new Function('state', 'SAVE_KEY', 'SAVE_VERSION', 'localStorage',
               persistSrc + ';persist()')(
    st, 'k', VERSION, { setItem: (_, v) => { out = JSON.parse(v); } });
  return out;
};
const kit = { shutterTier: 1, go: 0, code: '', host: 0, name: 'Ann',
              bank: 900, maxZoom: 2, res: 1, rides: 6, dead: 0, film: 7 };
const w = persisted(kit);
check('the save writes the bank under `b`', w.b === 900, JSON.stringify(w));
check('and the level under `s`', w.s === 6);
check('and stamps the version it was written by', w.v === VERSION);
check('what is written comes back as what it was', restore(w).rides === 6);
// The roll is not money any more -- it refills every ride -- so writing it would
// be a field nothing ever reads.
check('and the roll is not written at all', w.f === undefined, JSON.stringify(w));
// Nor the cart rung, whose ladder is gone.
check('nor the cart rung', w.d === undefined, JSON.stringify(w));
// The quota flag is, though: it has to survive the reload between the ride that
// missed it and the shop that reports it.
check('a missed quota is written under `q`',
      persisted({ ...kit, dead: 1 }).q === 1);
// Borrowed gear must never reach the save, or a match would overwrite the roll
// it was lent.
check('a multiplayer ride writes nothing at all', persisted({ ...kit, mp: 1 }) === null);

// Where the money actually moves. buy() is the till, and it does not trust the
// card it was handed: the shop greys what you cannot afford, but the guard has
// to stand here too, or the only thing between the player and a negative bank is
// a disabled attribute.
const buySrc = /^function buy\(i\)[\s\S]*?^}$/m.exec(src)[0];
const sell = (offer) => {
  const state = { bank: 450 };
  new Function('state', 'offers', 'persist', 'showShop', buySrc + ';buy(0)')(
    state, () => [offer], () => {}, () => {});
  return state;
};
const refused = sell({ price: 400, ok: false, buy() {} });
check('an upgrade marked unaffordable is refused at the till',
      refused.bank === 450, String(refused.bank));
const sold = sell({ price: 400, ok: true, buy() {} });
check('and one marked affordable still sells', sold.bank === 50, String(sold.bank));

// --- the multiplayer ride -------------------------------------------------
// A multiplayer ride rides borrowed gear. Two things have to hold or it quietly
// eats the player's save: the override must land, and nothing after it may write
// gear back. Both are read out of the real source rather than reimplemented.
const mpBlock = /^const MP_GEAR[\s\S]*?^}$/m.exec(src);
check('the multiplayer boot block is still there to test', !!mpBlock);

const mpBoot = (saved) => {
  // The roll starts at a value the fixed loadout does not use, so "it was
  // overwritten" is visible even when the loadout's own value is zero.
  const state = { bank: 900, maxZoom: 0, res: 0, film: 99, shutterTier: 0, go: 1, code: '' };
  const writes = [];
  new Function('saved', 'state', 'persist', mpBlock[0])(
    saved, state, () => writes.push({ ...state }));
  return { state, writes };
};

const solo = mpBoot({ v: VERSION, g: 1 });
check('a solo ride is left completely alone',
      !solo.state.mp && !solo.state.res && solo.state.film === 99 &&
      solo.writes.length === 0);

// `c` with no `g` is a lobby to go back to, not a ride to start. If this block
// fired on it, the lobby would inherit state.mp -- and persist() being a no-op
// would mean walking out of the lobby could never clear the code.
const lobbyOnly = mpBoot({ v: VERSION, c: '4821', h: 1 });
check('a lobby code with no ride marker starts no ride',
      !lobbyOnly.state.mp && !lobbyOnly.state.res && lobbyOnly.writes.length === 0);

const mp = mpBoot({ v: VERSION, g: 1, c: '4821', h: 1 });
check('a multiplayer ride is flagged as one', mp.state.mp === 1);
check('and restores which lobby it belongs to, and who hosted it',
      mp.state.code === '4821' && mp.state.host === 1);
// Film is not in the loadout any more -- every ride, solo or match, starts with
// the same fixed roll -- so what MP_GEAR still has to override is the camera.
check('and rides the fixed loadout, whatever the save held',
      mp.state.res > 0 && mp.state.maxZoom > 0);
check('the markers are cleared, so a stray refresh drops out of multiplayer',
      mp.state.go === 0 && mp.writes.length === 1);
check('and that write went out BEFORE the gear was swapped, so it saved the real one',
      !mp.writes[0].res && !mp.writes[0].maxZoom &&
      mp.writes[0].film === 99 && mp.writes[0].bank === 900);

// The guard is the whole defence: every later persist() -- finishing the ride,
// buying nothing, anything -- must be a no-op for the rest of the page's life.
const guard = /^function persist\(\) \{\n  if \(state\.mp\) return;$/m.test(src);
check('persist() refuses to run at all once the ride is a multiplayer one', guard);

// The code is what carries the lobby across the reload; without it on the wire
// format, everyone would reconnect to nothing.
check('the save carries the lobby code', /c: state\.code/.test(src));
// Without the host flag, everyone comes back from a rematch as a guest and
// nobody can start the next ride.
check('and who the host was', /h: state\.host/.test(src));

// --- actually getting the page to reload ---------------------------------
// Every ride transition is a reload, because the world has to be rebuilt. The
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
  const state = { mode: LOBBY };
  new Function('location', 'state', 'persist', 'LOBBY',
               navBlock(name) + ';' + call)(location, state, () => {}, LOBBY);
  return location;
};

// The one the player actually hit: the lobby lives at the bare path, so the ride
// used to be started by a fragment change that never reloaded anything.
const started = navigate('start', 'index.html', 'start(4242)');
check('starting a multiplayer ride really reloads', started.reloads > 0);
check('and carries the seed across in the hash', started.hash === '#4242', started.hash);

// Coming back from a ride, the URL DOES carry a seed, so dropping it is once again
// a fragment-only change -- and once again not a reload.
const back = navigate('home', 'index.html#4242', 'home()');
check('leaving a ride really reloads', back.reloads > 0);
check('and drops the seed, so it does not stick to the next ride',
      !+back.hash.slice(1), back.hash);

// The plain case has always worked, because the target URL was byte-identical.
const plain = navigate('home', 'index.html', 'home()');
check('and it still reloads when there was no seed to drop', plain.reloads > 0);

// --- the way into a room --------------------------------------------------
// The multiplayer card is one screen with two states, and which state you are in
// is `state.code`. These pin the wiring around that, because a mismatch here is
// invisible: the suites that render the card never run index.js, so a handler
// wired to a function that no longer exists still passes every other check.
const roomBlock = (name) => navBlock(name);
const room = (name, call, code = '') => {
  const state = { code, mode: LOBBY };
  const net = { connected: null, closed: 0,
                connect: (c) => { net.connected = c; }, close: () => { net.closed++; } };
  let titled = 0;
  new Function('state', 'net', 'refresh', 'persist', 'title', 'start', 'LOBBY',
               roomBlock('lobby') + ';' + roomBlock(name === 'lobby' ? 'back' : name) +
               ';' + call)(
    state, net, () => {}, () => {}, () => { titled++; }, () => {}, LOBBY);
  return { state, net, titled };
};

// Out of a room, the card is the way in: nothing is minted and nothing connects,
// or "Multiplayer" would put you on the air before you had a name.
const wayIn = room('back', 'lobby()');
check('the way in mints no room', wayIn.state.code === '');
check('and opens no socket', wayIn.net.connected === null);

// Create is the only place a room is minted, and it hosts the room it mints.
const made = room('create', 'create()');
check('Create mints a four-digit room', /^\d{4}$/.test(made.state.code), made.state.code);
check('and connects to exactly that room', made.net.connected === made.state.code);
check('and you host what you made', made.state.host === 1);

// Joining takes the code as given and does not host it.
const joined = room('back', "lobby('4821')");
check('joining uses the code you were given', joined.state.code === '4821');
check('and connects to it', joined.net.connected === '4821');
check('and a guest does not host', !joined.state.host);

// Back is the way off multiplayer from either state: the socket goes, or the
// host keeps counting a ghost, and the code goes, or the next boot walks
// straight back into the room you just left.
const left = room('back', 'back()', '4821');
check('Back closes the socket', left.net.closed === 1);
check('and forgets the room', left.state.code === '');
check('and lands on the main menu', left.titled === 1);

// --- what ends a ride -----------------------------------------------------
// Solo, an empty roll ends the ride. In a match it must not: the first rider to
// burn their film would be thrown off the track while the others kept shooting,
// and they would not finish together.
const endBlock = /^ {4}if \(ride >= 1\) endRun[\s\S]*?net\.allSpent\(\)\)\) endRun\(\);$/m.exec(src);
check('the ride-end conditions are still there to test', !!endBlock);

const ends = (ride, state, allSpent = false) => {
  let over = false;
  new Function('ride', 'state', 'net', 'endRun', endBlock[0])(
    ride, state, { allSpent: () => allSpent }, () => { over = true; });
  return over;
};

// The level counter rides inside endRun's solo-only payout guard, because a
// borrowed-gear ride must not advance a solo run's level. Lifted from the source
// so the two can never come apart.
const payout = /^ {2}if \(!state\.mp\) \{[\s\S]*?^ {2}\}$/m.exec(src);
check('the solo-only settle-up is still one guarded block', !!payout);
// Five things hang off that one guard now: the bank, the lifetime takings, the
// best photograph the game-over card is built from, the quota check, and the
// level counter. Every one of them has to stay out of a borrowed-gear ride, so
// they are tested together through the lifted block rather than one at a time.
// `goal` is handed in so these can set the bar where each check wants it.
const settle = (state, bar = 0) => {
  state.earned = state.earned || 0;
  state.photos = state.photos || [{ url: 'best.jpg' }];
  const paid = state.scored.reduce((a, s) => a + s.total, 0);
  new Function('state', 'paid', 'shot', 'best', 'keepBest', 'goal', payout[0])(
    state, paid, state.scored[0], 0, (s) => { state.kept = s; }, () => bar);
  return state;
};
check('a solo ride banks the roll and counts the ride',
      settle({ scored: [{ total: 30 }], bank: 5, rides: 2 }).rides === 3);
check('and the money still lands', settle({ scored: [{ total: 30 }], bank: 5 }).bank === 35);
// The bank is spent down by the shop, so it is no record of how the run went.
// This is, and it only ever goes up.
check('and the takings are counted apart from the bank',
      settle({ scored: [{ total: 30 }], bank: 5, earned: 70 }).earned === 100);
check('and the ride offers its best frame to be kept',
      settle({ scored: [{ total: 30 }], bank: 5 }).kept.total === 30);
check('a multiplayer ride counts for nothing',
      settle({ scored: [{ total: 30 }], bank: 5, rides: 2, mp: 1 }).rides === 2);
check('and earns nothing', settle({ scored: [{ total: 30 }], bank: 5, mp: 1 }).bank === 5);
check('and adds nothing to the takings',
      settle({ scored: [{ total: 30 }], bank: 5, earned: 70, mp: 1 }).earned === 70);
// A borrowed-gear ride must not hang its photographs on a solo run's card
// either -- the gear that took them was not the run's.
check('and leaves no photograph behind',
      settle({ scored: [{ total: 30 }], bank: 5, mp: 1 }).kept === undefined);

// --- the quota, settled ---------------------------------------------------
// The only way a run ends. It is checked against the level just ridden, before
// the counter moves on -- an off-by-one here would bill you for the next level's
// bar while you were still on this one.
check('a ride that clears its quota leaves the run alive',
      !settle({ scored: [{ total: 300 }], bank: 0, rides: 2 }, 300).dead);
check('and one that falls a pound short ends it',
      settle({ scored: [{ total: 299 }], bank: 0, rides: 2 }, 300).dead === 1);
check('exactly the quota is a pass, not a miss',
      !settle({ scored: [{ total: 300 }], bank: 0, rides: 2 }, 300).dead);
// A match sets no quota at all, and must never end a solo run by missing one.
check('a borrowed-gear ride cannot kill a run',
      !settle({ scored: [{ total: 0 }], bank: 0, rides: 2, mp: 1 }, 300).dead);

// keepBest is the only writer of that key, and it writes only on a new high --
// otherwise every ride would overwrite the run's best with its own.
const keepSrc = /^function keepBest\([\s\S]*?^}$/m.exec(src)[0];
check('the keeper is still there to test', !!keepSrc);
// `held` is what is already on disk; `n` is what this ride is offering it.
const keeps = (held, n) => {
  let wrote;
  new Function('read', 'PIC_KEY', 'localStorage', 'shot', 'photo',
               keepSrc + ';keepBest(shot, photo)')(
    () => (held === undefined ? {} : { n: held }), 'k',
    { setItem: (k, v) => { wrote = JSON.parse(v); } },
    n === undefined ? null : { total: n, b: [['red', '' + n]] }, { url: 'best.jpg' });
  return wrote;
};
check('a first photograph is kept, there being nothing to beat',
      keeps(undefined, 300).n === 300);
check('and it is the picture and its breakdown, not just a number',
      keeps(undefined, 300).p === 'best.jpg' && keeps(undefined, 300).b[0][0] === 'red');
check('a better one replaces it', keeps(300, 900).n === 900);
check('a worse one does not', keeps(900, 300) === undefined);
// Equal is not better: rewriting on a tie spends a few hundred kilobytes of
// quota to change nothing.
check('and neither does an equal one', keeps(900, 900) === undefined);
// A ride that photographed nothing has no best frame at all, and `shot` is
// undefined rather than a zero-scoring one.
check('a roll with no subjects in it keeps nothing', keeps(300, undefined) === undefined);

check('solo, finishing the track ends the ride', ends(1, { film: 9 }));
check('and so does running out of film', ends(0.3, { film: 0 }));
check('in a match, your own roll running out does NOT end the ride',
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
// "you belong to this lobby", not "a ride is starting".
check('a lobby code alone lands back in that lobby',
      route({ v: VERSION, c: '4821', h: 1 }).hit.join() === 'lobby:4821:1');
check('and it carries whether you were the host',
      route({ v: VERSION, c: '4821' }).hit.join() === 'lobby:4821:0');
check('a lobby code outranks the shop, so a match is not silently left',
      !route({ v: VERSION, b: 900, c: '4821' }).hit.includes('shop'));
check('but the code alone never starts a ride',
      !route({ v: VERSION, c: '4821' }).hit.includes('ride'));
check('a plain refresh lands on the shop', route({ v: VERSION }).hit.join() === 'shop');
const again = route({ v: VERSION, g: 1 });
check('the ride marker lands on the cart', again.hit.includes('ride'), true);
check('and the marker is consumed so the next refresh does not re-ride',
      again.go === 0 && again.hit.includes('persist'), true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
