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
           film: grab('film'), shutterTier: grab('shutterTier'), rides: grab('rides'),
           cartTier: grab('cartTier') };
};

const old = restore({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0] });
check('an old save keeps its bank', old.bank === 4200, String(old.bank));
check('an old save keeps its upgrades', old.maxZoom === 2 && old.res === 1);
// `f` held a tier index (0-4) before v4 and holds a frame count from v4 on.
// Read the old meaning with the new one and a veteran boots with three frames.
check('a pre-v4 save is handed a fresh roll, not its old tier index',
      old.film === 10, String(old.film));
check('and v3 -- the version that actually shipped -- is handed one too',
      restore({ v: 3, b: 900, f: 3 }).film === 10);
const v4 = restore({ v: 4, b: 0, f: 7 });
check('a v4 save keeps its actual stock', v4.film === 7, String(v4.film));
// The obvious `saved.f || 10` would quietly refill an empty roll forever, which
// is the whole failure state gone.
const dry = restore({ v: 4, b: 0, f: 0 });
check('and an empty roll stays empty rather than falling back', dry.film === 0, String(dry.film));

const fresh = restore({});
check('a fresh player starts at zero everywhere but the roll',
      // ...but the zoom starts on the free rung, not at nothing: index 1 is the
      // 1.2x step every camera owns so the wheel does something on day one.
      !fresh.bank && fresh.maxZoom === 1 && !fresh.res && !fresh.shutterTier);
check('and a fresh player is staked ten frames', fresh.film === 10, String(fresh.film));
// The ride counter is what film costs, so a save from before it existed has to
// read as "one ride's worth" rather than zero -- zero would be free film, which
// is the failure state sold back to anyone with an old save.
check('a fresh player has taken no rides', fresh.rides === 0, String(fresh.rides));
// The drive train took no SAVE_VERSION bump, so every save ever written is
// missing `d` -- and every one of them was standing on rung 0 when it was
// written, which is exactly what a missing key reads as.
check('a fresh player is on the slowest cart', fresh.cartTier === 0, String(fresh.cartTier));
check('and so is every save written before the cart could be bought',
      restore({ v: 4, b: 900, f: 3 }).cartTier === 0);
check('a save that has bought one keeps it', restore({ v: 4, d: 2 }).cartTier === 2);
check('a save from before the counter existed reads as none taken',
      restore({ v: 4, b: 900, f: 3 }).rides === 0);
check('and one that has been ridden keeps its count',
      restore({ v: 4, s: 6 }).rides === 6);

// res indexes resBonus/resNames directly, so an out-of-range save used to give a
// NaN score rather than a visible failure.
check('a camera tier beyond the ladder is clamped', restore({ r: 9 }).res, 3);
check('and a legitimate top tier survives', restore({ r: 3 }).res, 3);

// --- the dead end --------------------------------------------------------
// "No frames, and not enough money for one" is the whole failure condition, and
// both halves of it are off-by-one bait: a <= would strand a player who can
// still afford a frame, and dropping the film test would end a run mid-roll.
// Lifted from the real source rather than restated.
const FILM = +/^const FILM = (\d+);/m.exec(src)[1];
// price() now sits between FILM and everything that spends it, so every fragment
// lifted out below has to be handed it too -- run without it they throw, which
// is how this suite found out the shape had changed.
const priceSrc = /^const price = .+$/m.exec(src)[0];
const econ = 'const FILM = ' + FILM + ';' + priceSrc + ';';
const framesSrc = /^const frames = .+$/m.exec(src)[0];
const brokeSrc = /^const broke = .+$/m.exec(src)[0];
check('the dead-end test is still there to test', !!brokeSrc && FILM > 0);
// broke() is phrased through frames(1) now, so it has to be lifted with it --
// which is the point: there is one definition of what a frame costs, not two.
// Ride 0, not 1: `rides` is rides FINISHED, so the untouched save that walks
// into the first shop is on 0 and pays the base price. The old default of 1
// happened to read the same only while the curve started its multiplier there.
const isBroke = (film, bank, rides = 0) =>
  new Function('state', econ + framesSrc + ';' + brokeSrc + ';return broke()')(
    { film, bank, rides });
check('no frames and no money is the dead end', isBroke(0, 0) === true);
check('a penny short of a frame is still the dead end',
      isBroke(0, FILM - 1) === true);
check('but exactly the price of a frame is not', isBroke(0, FILM) === false);
check('and frames in hand are never the dead end, however broke',
      isBroke(1, 0) === false);
// ...and the bar rises with every ride, which is the only reason the dead end is
// reachable at all: a flat price that a good camera has outgrown is not an end.
// The curve is geometric now, so these are phrased through the lifted price()
// rather than through a multiple of FILM -- restating the shape here is what
// made them fail the moment it changed.
const priceAt = (rides) =>
  new Function('state', econ + 'return price()')({ rides });
check('the dead end moves up with the ride count',
      isBroke(0, priceAt(3) - 1, 3) === true, String(priceAt(3)));
check('and is cleared by the price of a frame at that ride',
      isBroke(0, priceAt(3), 3) === false);
// ...and it rises faster than a straight line, or income outruns it forever.
check('and it climbs faster than linearly',
      priceAt(4) > priceAt(2) * 2, priceAt(2) + ' -> ' + priceAt(4));

// --- what the shop sells -------------------------------------------------
const mk = (held, rides = 0) => {
  const state = { film: held, rides };
  const o = new Function('state', econ + framesSrc + ';return frames()')(state);
  o.buy();
  return { price: o.price, film: state.film };
};
check('a single frame costs the price of a frame', mk(0).price === FILM);
check('buying puts exactly one frame in the roll', mk(2).film === 3);
// The whole point of the change: the same frame costs more after every ride.
check('a frame costs the risen price for the ride count',
      mk(0, 4).price === priceAt(4), String(mk(0, 4).price));
// Before the first ride the multiplier is 1.5^0, which is exactly the base price
// -- so the first roll is the cheapest one and nothing is ever free.
check('the first frame is never free', mk(0, 0).price === FILM,
      String(mk(0, 0).price));
// ...and it really does climb from there rather than sitting flat for a ride.
check('and the second ride already costs more', mk(0, 1).price > FILM,
      String(mk(0, 1).price));
// The roll of ten is gone: with the price climbing it was a four-figure button
// that spent most of its life greyed out. Nothing should be able to quietly
// reintroduce a bulk quantity without this suite saying so.
check('film is sold one frame at a time', !/frames\(\d/.test(src));

// The shop is where the dead end is discovered -- it is what the end of a run
// and a plain reload both land on -- so the routing out of it is the thing that
// actually decides whether losing is reachable at all.
const shopSrc = /^function showShop\(\)[\s\S]*?^}$/m.exec(src)[0];
const routed = (film, bank) => {
  let to = null;
  const state = { film, bank };
  new Function('state', 'broke', 'ui', 'CONFIG', 'offers', 'buy', 'ride', 'title', 'SHOP',
               shopSrc + ';showShop()')(
    state, () => !state.film && state.bank < FILM,
    { showShop: () => { to = 'shop'; } }, {}, () => [], 0, 0,
    () => { to = 'title'; }, SHOP);
  return to;
};
check('a player who cannot buy a frame is sent to the dead end',
      routed(0, 0) === 'title', String(routed(0, 0)));
check('one who can afford a frame still gets the shop', routed(0, FILM) === 'shop');
check('and so does one with film already in hand', routed(3, 0) === 'shop');

// The title carries the dead end too, because a lobby you walk out of lands
// there rather than on the shop. If it stopped asking, Solo would ride a whole
// ride with a dead shutter.
const titleSrc = /^function title\(\)[\s\S]*?^}$/m.exec(src)[0];
const titled = (film, bank) => {
  let lost;
  const state = { film, bank };
  new Function('state', 'broke', 'ui', 'solo', 'lobby', 'saved', 'restart',
               'read', 'SAVE_KEY', 'PIC_KEY', 'TITLE', titleSrc + ';title()')(
    state, () => !state.film && state.bank < FILM,
    { showTitle: (a, b, c, d) => { lost = d; } }, 0, 0, { v: 4 }, 0,
    // Both the save and the best photograph are read live off their own keys,
    // so title() needs the reader and both keys handed to it here.
    (k) => (k === 'saf' ? { v: 4 } : {}), 'saf', 'pic', TITLE);
  return !!lost;
};
check('the title shows the dead end when there is no way to buy a frame',
      titled(0, 0) === true);
check('and does not when there is', titled(0, FILM) === false);
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
               'read', 'SAVE_KEY', 'PIC_KEY', 'TITLE', titleSrc + ';title()')(
    { film: 1, bank: 0 }, () => false,
    { showTitle: (a, b, c, d, e) => { saw = e; } }, 0, 0, 0,
    () => ({}), 'saf', 'pic', TITLE);
  check('so a player with nothing saved is offered no wipe', !saw);
}

// A frame is money now, so it has to leave the save the instant it is spent.
// Without this a reload mid-ride hands the frames back and the roll is free.
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
check('and writes it to the save there and then, not at the end of the ride',
      shot(5).saved[0] === 4, JSON.stringify(shot(5).saved));
check('a shutter with no film left writes nothing', shot(0).saved.length === 0);

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
              bank: 900, maxZoom: 2, res: 1, film: 7, cartTier: 2 };
const w = persisted(kit);
check('the save writes the roll under `f`', w.f === 7, JSON.stringify(w));
check('and the bank under `b`', w.b === 900);
check('and stamps the version it was written by', w.v === VERSION);
check('what is written comes back as what it was', restore(w).film === 7);
check('and the cart rung rides along under `d`', w.d === 2, JSON.stringify(w));
check('which also comes back as what it was', restore(w).cartTier === 2);
// Borrowed gear must never reach the save, or a match would overwrite the roll
// it was lent.
check('a multiplayer ride writes nothing at all', persisted({ ...kit, mp: 1 }) === null);

// Where the money actually moves. The film offers go through this same function
// as the ladders, so what has to hold is that the bank falls by exactly the
// price and the roll rises by exactly what was bought -- and that neither
// happens when it cannot be afforded.
const buySrc = /^function buy\(i\)[\s\S]*?^}$/m.exec(src)[0];
const framesOf = (state) =>
  new Function('state', econ + framesSrc + ';return frames()')(state);
const spend = (bank, film, rides = 1) => {
  const state = { bank, film, rides };
  new Function('state', 'offers', 'persist', 'showShop', buySrc + ';buy(0)')(
    state, () => [framesOf(state)], () => {}, () => {});
  return state;
};
// Priced off the lifted price() rather than off a remembered $100, so these say
// "the till charges what the shop quoted" in a way that survives a retune.
const one = priceAt(1);
check('buying a frame costs exactly the price of a frame',
      spend(one + 400, 0).bank === 400, String(spend(one + 400, 0).bank));
check('and puts exactly one frame in the roll', spend(one + 400, 0).film === 1);
check('the exact price is affordable', spend(one, 0).film === 1);
// A pound short has to buy nothing at all -- not a frame on credit, and not a
// negative bank, which would read as a fortune next time it is compared.
// The till charges what the shop quoted, and the shop quotes the current ride.
check('the till charges the risen price, not the base one',
      spend(priceAt(5) + 500, 0, 5).bank === 500,
      String(spend(priceAt(5) + 500, 0, 5).bank));
const short = spend(one - 1, 0);
check('a pound short buys nothing', short.film === 0 && short.bank === one - 1,
      JSON.stringify(short));

// buy() is the till, and it does not trust the card it was handed: the shop
// greys an upgrade that would eat your last frame's worth, but the guard has to
// stand here too, or the only thing between the player and the dead end is a
// disabled attribute.
const sell = (offer) => {
  const state = { bank: 450, film: 0, rides: 1 };
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
check('and rides the fixed loadout, whatever the save held',
      mp.state.res > 0 && mp.state.maxZoom > 0 && mp.state.film === 10);
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

// The ride counter rides inside endRun's solo-only payout guard, because a
// borrowed-gear ride must not make film dearer back home either. Lifted from the
// source so the two can never come apart.
const payout = /^ {2}if \(!state\.mp\) \{[\s\S]*?^ {2}\}$/m.exec(src);
check('the solo-only settle-up is still one guarded block', !!payout);
// Four things hang off that one guard now: the bank, the lifetime takings, the
// ride counter, and the best photograph the game-over card is built from. Every
// one of them has to stay out of a borrowed-gear ride, so they are tested
// together through the lifted block rather than one at a time.
const settle = (state) => {
  state.earned = state.earned || 0;
  state.photos = state.photos || [{ url: 'best.jpg' }];
  const paid = state.scored.reduce((a, s) => a + s.total, 0);
  new Function('state', 'paid', 'shot', 'best', 'keepBest', payout[0])(
    state, paid, state.scored[0], 0, (s) => { state.kept = s; });
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
