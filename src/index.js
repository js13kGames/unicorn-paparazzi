import { buildWorld, pathAt, elevAt } from './terrain.js';
import { createRenderer } from './render.js';
import { spawn, updateHerd, packInstances } from './unicorn.js';
import { createPhotoRig, frame as viewFrame } from './photo.js';
import { scorePhoto } from './score.js';
import * as ui from './ui.js';
import * as net from './net.js';

export const CONFIG = {
  mapSize: 500,
  plainStickiness: 0.75,
  terrainSmooth: 2,       // [1,2,1] blur passes turning bands into slopes
  terrainDetail: 0.35,    // fine relief added back after blurring, in bands
  unicornDensity: 0.003,
  driftChance: 0.08,      // chance a unicorn wears an off-biome color
  poseWeights: [0.80, 0.10, 0.08, 0.02],
  trackRadiusFrac: 0.25,
  shutterTiers: [0.8, 0.55, 0.35, 0.2],  // seconds between frames, per motor drive
  // World units per second, per drive train. A faster cart covers more of the
  // loop between one frame and the next, so the same roll of film sees more of
  // the map -- and more of the combinations that are only worth photographing
  // together. Pinned for everyone in a match; see MP_GEAR.
  cartTiers: [8, 10, 13, 17],
  eyeHeight: 2.4,
  baseFov: Math.PI / 3,
  // The first rung is free and barely a zoom at all: a new player who nudges the
  // wheel sees the frame tighten by a fifth and learns the lens is there. Without
  // it the control is dead until the first $400, and nothing on screen says the
  // camera has a zoom to buy. Everything above it is the ladder as it was.
  zoomLevels: [1, 1.2, 2, 4, 8, 16],
  // What one frame-share of unicorn is worth on each sensor: 1 / 1.5 / 3 / 6 of
  // the base rate. Size is coverage x this, so a subject filling a tenth of the
  // frame scores 100 on the cheapest camera and 600 on the best.
  //
  // These double as the sensor's NAME, written `1000dpi`. They are not pixel
  // counts -- the photograph is the same size at every tier -- but they are the
  // number the score is actually made of, which `low/med/high/ultra` never was:
  // the breakdown reads `1.2% x 1000dpi  +12` and multiplies out exactly.
  resBonus: [1000, 1500, 3000, 6000],
  // Fraction of the frame a unicorn must fill to be counted as a subject.
  minCoverage: 0.002,
  // How steeply a cut outline costs you. Crop and scenery decay exponentially;
  // being behind another unicorn is a linear reduction.
  cropK: 2.5,
  envK: 2.0,
  occK: 0.9,
};

const canvas = document.getElementById('c');

const seed = +location.hash.slice(1) || (Math.random() * 0x7fffffff) | 0;
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);
const photoRig = createPhotoRig(renderer.gl, canvas, renderer.draw);

// Namespaced per the jam's shared-origin rule, and never localStorage.clear().
const SAVE_KEY = 'u13k_uni_saf';

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}

const SAVE_VERSION = 4;

// A multiplayer ride is taken on borrowed gear, so it must never write gear or bank back
// into the save. One guard covers every call site.
function persist() {
  if (state.mp) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      t: state.shutterTier,
     
      g: state.go, c: state.code, h: state.host, n: state.name,
      b: state.bank, z: state.maxZoom, r: state.res, f: state.film,
      // No SAVE_VERSION bump: a save from before the escalating price simply
      // has no `s`, which reads 0, which prices film at $100 -- exactly what
      // that save already expected. A bump would cost bytes and change nothing.
      s: state.rides, d: state.cartTier,
    }));
  } catch (e) { /* private browsing: the run just doesn't carry over */ }
}

const saved = loadSave();

const state = {
  mode: 'title',
  bank: saved.b || 0,
  // 1, not 0: the free rung is where everyone starts. An older save that stored
  // an index into the previous ladder reads one rung low, which is a lens you
  // already paid for -- the save is local and pre-release, so it is not worth
  // bytes to migrate.
  maxZoom: saved.z || 1,
  // Clamped: a save from a build with more tiers would index off the end of
  // resBonus, which is a NaN score rather than a visible failure.
  res: Math.min(saved.r || 0, 3),
  // A stock, not a capacity: it is spent, bought and carried like the bank. `f`
  // held a tier index before v4, so anything older -- or nothing at all -- is
  // handed a fresh roll rather than having its tier read as a frame count.
  film: saved.v > 3 ? saved.f : 10,
  zoom: 0,
  ready: 0,
  fx: 1, fy: 1,          // photo frame's share of the canvas, set every frame
  shutterTier: saved.t || 0,
  // No SAVE_VERSION bump, for the same reason as `s` below: a save from before
  // the drive train simply has no `d`, which reads 0, which is the rung every
  // one of those saves was already standing on.
  cartTier: saved.d || 0,
  // Rides finished, and so the price of a frame: film costs $100 x this. It is
  // the only number in the save that only ever goes up, and the reason a solo
  // game ends -- see price() below.
  rides: saved.s || 0,
  code: '',              // the lobby we are in, '' when playing alone
  host: 0,
  name: saved.n || '',   // what other riders see us called
  photos: [],
  scored: [],
};

// A multiplayer ride is settled by photography, not by who has ridden farther,
// so it ignores the save entirely and everyone rides the same loadout. Tune here.
// The top camera, because a match is settled by looking at the photographs and
// tier 1 encodes them at JPEG quality 0.3. Everyone is equal either way, so this
// only makes the pictures sharp and the numbers bigger.
const MP_GEAR = { maxZoom: 3, res: 3, film: 10, shutterTier: 1, cartTier: 1 };

// The save carries two separate facts. `c` alone means "you belong to this
// lobby", which is what Rematch and a stray refresh come back to. `c` with `g`
// means a ride is starting right now. So only `g` is consumed here: dropping out
// of the match entirely is something you have to actually ask for.
const mpCode = saved.c || '';
if (mpCode && saved.g) {
  state.code = mpCode;
  state.host = saved.h || 0;
  state.go = 0;
  persist();                       // still the REAL gear: state.mp is not set yet
  Object.assign(state, MP_GEAR);
  state.mp = 1;                    // from here persist() is a no-op
}

// Every upgrade is a ladder: the tier values, the price of each step, the state
// key holding how far up it you are, and a suffix for the values. p[i] buys
// tier i+1, so p is always one shorter than v. The shop draws the whole ladder
// -- the old list showed only the next rung, so nothing on screen ever said
// what camera you were actually carrying.
const LADDERS = [
  // p[0] is the free rung nobody buys -- you start standing on it -- so the
  // prices are the same four they always were, shifted along by one.
  ['zoom', CONFIG.zoomLevels, [0, 400, 900, 1800, 3200], 'maxZoom', '×'],
  // Named for its unit rather than "resolution": the row already reads
  // `dpi 1500 [3000 $1200]`, so spelling the unit out on every value as well
  // said it three times over.
  ['dpi', CONFIG.resBonus, [500, 1200, 2600], 'res', ''],
  ['speed', CONFIG.shutterTiers, [250, 700, 1600], 'shutterTier', 's'],
  // `speed` is already the shutter's, so this one is named for the thing that
  // moves rather than the movement.
  ['cart', CONFIG.cartTiers, [400, 1000, 2200], 'cartTier', ''],
];

// How fast the cart is running, in world units per second.
const pace = () => CONFIG.cartTiers[state.cartTier];

// Dollars a frame. A photograph has to beat this to have been worth taking,
// which is the whole reason the shutter is worth aiming.
const FILM = 100;

// ...and it is a hundred dollars MORE after every ride. A flat price meant a
// camera that had outgrown it could ride forever; rising, it eventually outruns
// any roll, so the game is "shoot the best frame you can, and stay in as long as
// you can afford to". `|| 1` covers the first shop visit -- and every save
// written before this existed -- which would otherwise be handing out free film.
const price = () => FILM * (state.rides || 1);

// Film is not a ladder -- there are no tiers to climb, only frames to stock up
// on -- but it is shaped like one here so buy() stays a single function: an
// offer is anything with a price and a way to spend it.
//
// One frame at a time, since the price began climbing. The roll of ten was a
// bulk button with no bulk discount, and at $400 a frame it was a $4000 control
// that spent most of the game greyed out -- the quantity, the multiplication and
// the label that had to name it all went with it.
const frames = () => ({ price: price(), ok: state.bank >= price(), buy: () => state.film++ });

// `ok` is affordability, and it is not simply "can I cover the price". With an
// empty roll the last $100 is not money, it is the next ride: spend it on a
// lens and the shop has sold you into the dead end, with nothing to photograph
// and no way to buy anything to photograph it with. So while there is no film,
// an upgrade has to leave a frame's worth behind. Film itself is exempt -- it
// IS the way out -- and once there is a roll in the camera the reserve lifts
// and you may spend to the last dollar.
const offers = () => {
  const keep = state.film ? 0 : price();
  return [...LADDERS.map(([label, v, p, key, sfx]) => ({
    label, v, p, sfx, at: state[key], price: p[state[key]],
    ok: state.bank - p[state[key]] >= keep,
    buy: () => state[key]++,
  })), frames()];
};

const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let distance = 0;
let shutterQueued = false;
let clock = 0;          // seconds of ride time, always tickCount * STEP

// Start the ride looking along the track rather than at a random compass point.
{
  const a = pathAt(world.path, 0), b = pathAt(world.path, 4);
  cam.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

// The photograph's own vertical fov. What the screen shows is derived from it
// per frame, so the window's shape changes how much you can see AROUND the
// frame and nothing about the frame itself.
const fov = () => CONFIG.baseFov / CONFIG.zoomLevels[state.zoom];
state.zoom = Math.min(state.zoom, state.maxZoom);

// --- input ---------------------------------------------------------------

// Straight up and straight down are both degenerate for view(), which builds its
// basis from yaw and pitch alone -- so neither look path is allowed to reach
// them.
const LIM = Math.PI / 2 - 0.05;
const clampPitch = () => (cam.pitch = Math.max(-LIM, Math.min(LIM, cam.pitch)));

addEventListener('mousemove', (e) => {
  if (state.mode !== 'ride' || document.pointerLockElement !== canvas) return;
  cam.yaw -= e.movementX * 0.0022;
  cam.pitch -= e.movementY * 0.0022;
  clampPitch();
});

// A phone has no pointer lock, so none of the desktop input set applies: the
// look cannot be mouse deltas, and the shutter cannot be a click that only
// counts while locked. This one test picks the whole alternative.
const TOUCH = matchMedia('(pointer:coarse)').matches;
state.t = TOUCH;

// You aim a phone the way you aim a camera: the lens is the back of the device,
// which is the -Z axis of the frame alpha/beta/gamma describe. Roll is dropped
// on the floor -- view() cannot express it, and a photograph does not want it.
let yawOff;
if (TOUCH) addEventListener('deviceorientation', (e) => {
  if (state.mode !== 'ride' || e.alpha == null) return;
  const D = Math.PI / 180;
  const a = e.alpha * D, b = e.beta * D, g = e.gamma * D;
  const cg = Math.cos(g), sg = Math.sin(g), sb = Math.sin(b);
  const x = -sg * Math.cos(a) - cg * sb * Math.sin(a);
  const y = -sg * Math.sin(a) + cg * sb * Math.cos(a);
  const yaw = Math.atan2(-x, y);
  // The first reading is the origin. A ride starts looking down the track
  // rather than snapping to wherever the compass thinks north is -- and alpha's
  // drift, and the absolute/relative split between platforms, stop mattering
  // because only the change from that first reading is ever used.
  if (yawOff === undefined) yawOff = cam.yaw - yaw;
  cam.yaw = yaw + yawOff;
  cam.pitch = Math.asin(-cg * Math.cos(b));
  clampPitch();
});

// iOS hands out the orientation stream only on request, and only from inside a
// gesture. Every tap that starts or continues a ride is one, and asking again
// once granted resolves without prompting, so this needs no state of its own.
const askIMU = () => DeviceOrientationEvent.requestPermission?.().catch(() => {});

// Two fingers work the lens, measured against the span the pinch started at and
// re-based on every step, so one long slow pinch walks the whole ladder. `multi`
// outlives the gesture: letting go of a pinch also fires a click, and that click
// must not cost a frame of film.
let pinch = 0, multi = 0;
if (TOUCH) {
  addEventListener('touchstart', (e) => { if (e.touches.length < 2) multi = pinch = 0; });
  addEventListener('touchmove', (e) => {
    const t = e.touches;
    if (state.mode !== 'ride' || t.length < 2) return;
    multi = 1;
    const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    if (!pinch) pinch = d;
    const step = d > pinch * 1.3 ? 1 : d < pinch * 0.77 ? -1 : 0;
    if (step) { pinch = d; zoomBy(step); }
  });
}

// A trackpad pinch reaches the page as ctrl+wheel, which is also the browser's
// page-zoom gesture -- so reaching for the lens would zoom the whole document
// instead. Cancelling that needs a non-passive listener. Ordinary wheel is only
// swallowed while riding, so the shop panel can still scroll.
// Three things work the lens -- the wheel, the +/- keys and a pinch -- and all
// three want the same clamp, so they share one.
const zoomBy = (n) => (state.zoom = Math.max(0, Math.min(state.maxZoom, state.zoom + n)));

addEventListener('wheel', (e) => {
  if (e.ctrlKey || state.mode === 'ride') e.preventDefault();
  if (state.mode !== 'ride' || !state.maxZoom) return;
  zoomBy(e.deltaY > 0 ? -1 : 1);
}, { passive: false });

// Safari sends pinch as its own gesture events rather than ctrl+wheel. Cancelling
// the start cancels the whole sequence, so `gesturechange` and `gestureend` --
// 24 bytes of vocabulary the packer had never seen before -- were paying for
// nothing.
addEventListener('gesturestart', (e) => e.preventDefault());

// Chrome rejects this promise if the lock was exited very recently, and an
// unhandled rejection would show up as a console error.
const lock = () => Promise.resolve(canvas.requestPointerLock()).catch(() => {});

function primary() {
  if (state.mode === 'title') {
    state.mode = 'ride';
    ui.hidePanel();
    ui.setChrome(true);
    // The tap that starts the ride is the gesture iOS wants for the orientation
    // stream; a mouse wants the pointer instead.
    TOUCH ? askIMU() : lock();
  } else if (state.mode === 'ride') {
    // Escape releases the pointer but leaves you riding, so a click has to hand
    // the mouse back. Without this it fell through to the shutter, and the only
    // way to look around again was to spend a frame of film. A tap has no lock
    // to get back, so it always shoots -- unless it is the tail of a pinch.
    if (TOUCH) multi || (askIMU(), shutterQueued = true);
    else if (document.pointerLockElement === canvas) shutterQueued = true;
    else lock();
  }
}


canvas.addEventListener('click', primary);
document.getElementById('panel').addEventListener('click', primary);
addEventListener('keydown', (e) => {
  // Leave the browser's own shortcuts alone: cmd+- is a page zoom, and without
  // this it would work the lens on the way past.
  if (e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') { e.preventDefault(); primary(); return; }
  // +/- work the zoom as well as the wheel, which is awkward on a trackpad.
  if (e.key === '+' || e.key === '=') zoomBy(1);
  else if (e.key === '-') zoomBy(-1);
});

// --- photographs ---------------------------------------------------------

function takePhoto() {
  if (state.film <= 0 || clock < state.ready) return;
  state.ready = clock + CONFIG.shutterTiers[state.shutterTier];
  state.film--;
  persist();
  // Tell the room the moment the roll runs out, so the others can know when
  // every roll in it is empty.
  if (state.mp && !state.film) net.noFilm();
  ui.flash();
  const photo = photoRig.capture(cam, fov(), herd, state.fx, state.fy, state.res, state.mp);
  const scored = scorePhoto(photo, CONFIG, state);
  state.photos.push(photo);
  state.scored.push(scored);
  ui.addThumb(photo.url);
}

function endRun() {
  state.mode = 'results';
  // Borrowed gear earns no money: a multiplayer ride would otherwise be the
  // cheapest way to farm the shop.
  // The ride counter sits inside the same guard for the same reason: a
  // borrowed-gear ride must not make film more expensive back home either.
  if (!state.mp) { for (const s of state.scored) state.bank += s.total; state.rides++; }
  persist();
  // One result per rider per ride: the total, and the best single frame.
  let best = 0;
  for (let i = 1; i < state.scored.length; i++) {
    if (state.scored[i].total > state.scored[best].total) best = i;
  }
  net.done(state.scored.reduce((a, s) => a + s.total, 0),
           state.photos.length ? state.photos[best].small : '',
           state.scored.length ? state.scored[best].b : []);
  ui.setChrome(false);
  document.exitPointerLock();
  showResults();
}

// A match result can be flipped between the winner and your own roll. It is one
// screen with two faces, not a mode of its own.
let ownRoll = 0;

function showResults() {
  state.mode = 'results';
  const rivals = net.others();
  // Everyone on the roster except the riders who have reported, and except us.
  // A rider who closes the tab leaves the roster, so this reaches zero and the
  // crown settles rather than waiting on someone who is never coming back.
  const waiting = Math.max(0, net.lobby().length - rivals.length - 1);
  ui.showResults(state, state.scored, showDetail,
                 state.mp ? home : showShop, rivals,
                 state.mp ? waiting : undefined, ownRoll);
}

function showDetail(i) {
  // -1 is the My photos / Result toggle rather than a shot.
  if (i < 0) { ownRoll = !ownRoll; return showResults(); }
  state.mode = 'detail';
  ui.showPhoto(state.scored[i], showResults);
}

// The dead end: no frames left and not enough money to buy one. Nothing you can
// do from here changes either number, so the only honest offer is a fresh start.
// Phrased through the shop's own offer rather than restating its arithmetic: the
// dead end is "no frames, and the cheapest thing that would fix that is refused".
// `frames()` is a call the packer has already seen, which the long form was not.
const broke = () => !state.film && !frames().ok;

function showShop() {
  state.mode = 'shop';
  if (broke()) return title();
  ui.showShop(state, CONFIG, offers(), buy, ride, title);
}

function buy(i) {
  const o = offers()[i];
  // A maxed ladder has no price at all, and `NaN >= keep` is false -- so `ok`
  // already refuses it, and the price test only guards against selling a tier
  // past the top of the ladder for nothing.
  if (!o || !o.price || !o.ok) return;
  state.bank -= o.price;
  o.buy();
  persist();
  showShop();
}

// A new ride needs a fresh world, which means rebuilding every GL buffer. The
// save already holds everything that carries over, so a reload is both cheaper
// in bytes and less likely to leak GPU resources than tearing the scene down.
function ride() {
  state.go = 1;
  persist();
  home();
}

// Drop the seed, then reload. Assigning the bare path instead LOOKS like it
// reloads and does not: a URL that differs only in its fragment is a
// same-document navigation, so coming back from a ride at #4242 would have
// scrolled and stayed put. Clearing the hash first is also what stops a seed
// adopted for one ride sticking to every later one.
const home = () => { location.hash = ''; location.reload(); };

function restart() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
  home();
}

// --- the lobby -----------------------------------------------------------

// The multiplayer card, in or out of a room. No code is the way in -- name
// yourself, then make a room or walk into one -- and a code is that room, which
// is also how "join another" hops rooms: net.connect lets go of the old one.
function lobby(code, host) {
  state.mode = 'lobby';
  state.code = code || '';
  // Taken rather than inferred: booting back into a lobby after a match has to
  // restore whoever was host, and "was a code passed in" cannot tell you that.
  state.host = code && host || 0;
  if (code) net.connect(code, state.name, start, refresh);
  refresh();
}

// The only place a room is minted. It used to happen inside lobby() on a missing
// code, which meant the way IN to multiplayer was already a room you were
// hosting -- broadcasting before you had so much as a name.
const create = () => lobby('' + (1000 + (Math.random() * 9000 | 0)), 1);

// The ride begins with a reload, because the world has to be rebuilt from the new
// seed either way. The hash carries the seed across it and the save carries the
// code, so everyone reconnects to the same room on the other side.
function start(s) {
  if (state.mode !== 'lobby') return;  // never yank a rider already on the track
  state.go = 1;
  persist();
  // Same trap as home(): setting href to pathname + '#' + s only changes the
  // fragment, which the browser handles in-document and never reloads. The ride
  // does not begin until the world is rebuilt, so ask for the reload outright.
  location.hash = s;
  location.reload();
}

// The host picks the seed and tells the room before taking it themselves.
function host() {
  const s = (Math.random() * 0x7fffffff) | 0;
  net.go(s);
  start(s);
}

// The name outlives the lobby: it is yours, not the room's, so it goes in the
// save and rides the reload into the ride with everything else.
function rename(v) {
  state.name = net.setName(v);
  persist();
}

// Walking out has to close the socket, or the host keeps counting a ghost. Back
// is the way off multiplayer entirely, from either state of the card: it is one
// page now, so stepping back from the room to the way into it would be stepping
// back onto the same page.
function back() {
  net.close();
  state.code = '';
  persist();               // and stop booting into a lobby that was walked out of
  title();
}

function title() {
  state.mode = 'title';
  // Reset only when there is something to reset -- a wipe offered to a player
  // with nothing to wipe is a button that does nothing.
  //
  // Read LIVE, through loadSave(), not from the `saved` snapshot taken at boot.
  // That is the whole trick: `saved` never refreshes, so gating on `saved.v` kept
  // the button hidden through a first session however far the player got -- and
  // a player who burned all ten frames on their first ride reached the dead end
  // with the one button that gets out of it missing. persist() has always run by
  // the time broke() can be true, so the dead end is still offered its way out.
  ui.showTitle(solo, lobby, restart, broke(), loadSave().v);
}

// The menu is reachable from the shop without a reload, and by then the world
// has been ridden -- the film is spent and the cart is round the track. A fresh
// boot has not, so it can just start where it stands rather than paying for a
// second worldgen.
function solo() {
  // An empty roll is not a ride: the shutter would be dead for the whole track
  // and the only thing waiting at the end is the shop. So go there now. broke()
  // has already turned this card into the dead end when there is no money
  // either, so reaching here means the frames are affordable.
  if (!state.film) showShop();
  else if (distance) ride();
  else primary();
}

// Whatever screen is up, redraw it: the roster and the results board both move
// on their own as riders arrive, finish and leave.
function refresh() {
  if (state.mode === 'lobby') {
    // One primary action, picked here rather than in the card: in a room it
    // starts the ride, out of one it mints the room.
    ui.showLobby(state.code, state.host, net.lobby(), state.name,
                 state.code ? host : create, lobby, back, rename);
  } else if (state.mode === 'results') showResults();
}

// --- loop ----------------------------------------------------------------

ui.setChrome(false);
// A multiplayer ride rejoins the room its code names, so rivals' results land on
// the board as they finish -- while you are still riding, or after.
if (mpCode) net.connect(mpCode, state.name, start, refresh);
// Three ways in. A first run, or one after "Start over" wipes the save, stops on
// the title. "Ride again" leaves a one-shot marker and reloads to rebuild the
// world, so it lands straight on the cart -- consuming the marker here means an
// actual refresh does not do the same. That refresh reopens the shop instead, so
// a stray reload mid-ride costs the ride but not the bank.
if (saved.g) { state.go = 0; persist(); primary(); }
else if (saved.c) lobby(saved.c, saved.h);
else if (saved.v) showShop();
else title();

// The simulation advances in whole steps of this and never in wall-clock time.
// updateHerd draws from one RNG stream shared by the whole herd, from inside
// dt-gated branches, so the number and ORDER of draws -- and therefore every
// unicorn -- is a function of the tick count and nothing else. Fixing the step is
// what lets two machines at 60Hz and 144Hz ride an identical ride. `clock` is the
// authoritative tick clock: it is always exactly tickCount * STEP.
const STEP = 1 / 60;
let acc = 0;

function tick() {
  clock += STEP;
  distance += pace() * STEP;
  updateHerd(herd, world, CONFIG, STEP);
}

let last = performance.now();
function frame(now) {
  // Capped so a long stall cannot spin this loop; the cost is that the dropped
  // ticks are simply lost, which a networked ride would have to resync.
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (state.mode === 'ride' && acc >= STEP) { tick(); acc -= STEP; }

  packInstances(herd, world);
  const ride = distance / world.path.length;
  // The cart alone is smoothed across the leftover accumulator, so it does not
  // judder on a display faster than the tick rate. Presentation only -- this
  // never feeds back into the simulation.
  const p = pathAt(world.path, distance + pace() * acc);
  cam.x = p.x;
  // Ride the rails: the ground where there is ground, the span where there is not.
  cam.y = Math.max(elevAt(world, p.x, p.z), p.y) + CONFIG.eyeHeight;
  cam.z = p.z;

  const f = viewFrame(fov(), canvas.width / canvas.height);
  state.fx = f.fx; state.fy = f.fy;
  renderer.draw(cam, f.fov);

  // The capture reads the drawing buffer, so it has to happen in this same
  // frame, right after the visible draw.
  if (shutterQueued) {
    shutterQueued = false;
    takePhoto();
  }

  ui.updateHud(state, ride, clock, CONFIG.zoomLevels);

  if (state.mode === 'ride') {
    if (ride >= 1) endRun();
    // Solo, an empty roll ends the ride. In a match it must not: everyone rides
    // the same track at the same speed off the same tick clock, so letting the
    // cart run on with a dead shutter is what makes them all finish together --
    // and what stops the first rider to burn their film being thrown off the
    // track while the others are still shooting.
    // Solo, an empty roll ends the ride at once. In a match it must not: the
    // first rider to burn their film would be thrown off the track while the
    // others kept shooting. So the cart runs on with a dead shutter until every
    // roll in the room is empty -- at which point there is nothing left to ride
    // for, and everyone stops together.
    else if (state.film <= 0 && (!state.mp || net.allSpent())) endRun();
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
