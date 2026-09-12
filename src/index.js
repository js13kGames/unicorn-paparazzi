import { buildWorld, pathAt, elevAt } from './terrain.js';
import { createRenderer } from './render.js';
import { spawn, updateHerd, packInstances } from './unicorn.js';
import { createPhotoRig, frame as viewFrame } from './photo.js';
import { scorePhoto } from './score.js';
import * as ui from './ui.js';
import { TITLE, RIDE, RESULTS, DETAIL, SHOP, LOBBY } from './mode.js';
import * as net from './net.js';

export const CONFIG = {
  mapSize: 500,
  plainStickiness: 0.75,
  terrainSmooth: 2,       // [1,2,1] blur passes turning bands into slopes
  terrainDetail: 0.35,    // fine relief added back after blurring, in bands
  // Chance a land tile holds a unicorn, on the first ride. It climbs 5% a ride
  // from there, at boot, just below -- so a run that survives gets a fuller map
  // to photograph rather than only a dearer roll of film.
  unicornDensity: 0.003,
  // Chance a unicorn wears an off-biome color. At 0.08 the herd was so strictly
  // banded that blue and violet were ~3% each and locked to their own altitudes,
  // so the color bonus almost never fired: two colors in 10% of shots, four in
  // 0.1%, six never once in testing. Drift is the only thing that puts unlike
  // animals in one frame, and it is what makes the color bonus a reward for the
  // long lens -- you need six in shot before you can need six colors.
  driftChance: 0.35,
  poseWeights: [0.80, 0.10, 0.08, 0.02],
  // What each pose pays, over and above a plain standing shot: walking nothing,
  // then eating, sitting, neighing. Stated outright rather than derived from the
  // weights above by a gamma curve, which coupled two things that want tuning
  // separately -- how often a pose turns up, and what catching it is worth --
  // and could only ever pay strictly by rarity. Rarity is most of the story but
  // not all of it: a unicorn sitting down photographs better than the numbers
  // alone would say. Read as +10%, +30%, +90% on the breakdown.
  poseBonus: [1, 1.1, 1.3, 1.9],
  trackRadiusFrac: 0.25,
  // Seconds between frames, per motor drive. A second on the cheapest body, a
  // tenth on the best: what the ladder buys now is the burst -- the three frames
  // of a unicorn rearing rather than the one you happened to catch. It is no
  // longer the thing that makes film scarce, because film is priced to be scarce
  // on its own and a shutter that made you wait was a ride spent watching a dot.
  shutterTiers: [1, 0.5, 0.25, 0.1],
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
  // Five rungs, not six. Zoom trades cone width for reach, and past about 6x the
  // cone wins: an 8x frame held fewer subjects than a 6x one and measured as a
  // negative buy, which is a rung nobody should be sold.
  zoomLevels: [1, 1.5, 2.5, 4],
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

// Namespaced per the jam's shared-origin rule, and never localStorage.clear().
const SAVE_KEY = 'unicorn-paparazzi';
// The best photograph of the run lives under its own key rather than in the save
// proper. It is a JPEG data URL and persist() runs on every shutter press, so
// carrying it in there would rewrite a few hundred kilobytes mid-ride; this one
// is written once a ride, and only when the ride beat it.
// Built off the save's own key rather than spelled out: two twelve-character
// strings that differ in one letter cost twice what one does.
const PIC_KEY = SAVE_KEY + 'p';

// Both keys are read the same way, so there is one reader rather than one
// function per key. A key that was never written reads as an empty record.
const read = (k) => {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; }
};

const saved = read(SAVE_KEY);

// The herd has to be spawned before anything else can be drawn, so everything it
// depends on is read here -- which is why the save is loaded above worldgen and
// not, as it was, below it.
//
// A match is ridden on borrowed gear (see MP_GEAR) and on a borrowed WORLD as
// well: every rider in the room must spawn an identical herd, and rivals have
// not ridden the same number of times. So the map only thickens in solo. `c`
// with `g` is a match starting -- the same test the boot block below makes.
if (!(saved.c && saved.g)) CONFIG.unicornDensity *= 1.05 ** (saved.s | 0);

const seed = +location.hash.slice(1) || (Math.random() * 0x7fffffff) | 0;
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);
const photoRig = createPhotoRig(renderer.gl, canvas, renderer.draw);

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
      // What the run has earned all told, as opposed to what is left in the
      // bank. The shop spends the bank down, so it is no measure of how the run
      // went -- and how the run went is the whole of the game-over card. Older
      // saves have no `e`, which reads 0, which is the only honest answer for a
      // run whose takings were never counted.
      e: state.earned,
    }));
  } catch (e) { /* private browsing: the run just doesn't carry over */ }
}

const state = {
  mode: TITLE,
  bank: saved.b || 0,
  // 1, not 0: the free rung is where everyone starts. An older save that stored
  // an index into the previous ladder reads one rung low, which is a lens you
  // already paid for -- the save is local and pre-release, so it is not worth
  // bytes to migrate.
  // Clamped like `res` above: the lens ladder lost its top rung in the balance
  // pass, and a save made before that carries a tier this ladder no longer has --
  // which reads as an undefined focal length and a NaN field of view.
  maxZoom: Math.min(saved.z || 1, CONFIG.zoomLevels.length - 1),
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
  earned: saved.e || 0,       // gross takings of the whole run; see persist()
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
// Prices set so every ladder returns about the same points per dollar, measured
// at a mid-run loadout by test/tools/economy.mjs. Before this they were guesses,
// and dpi -- far and away the strongest buy once size stopped being a rounding
// error -- was also the cheapest thing in the shop.
//
// The motor drive is the exception, priced low rather than by measurement. It
// only pays once the drive train is passing scenery faster than the shutter can
// take it, which the sim can confirm happens but cannot size: it samples the lap
// every 18 units, so it cannot see what changes in less. Cheap enough not to be
// a trap either way, pending a finer sample.
const LADDERS = [
  // p[0] is the free rung nobody buys -- you start standing on it -- so the
  // prices are the same four they always were, shifted along by one.
  ['zoom', CONFIG.zoomLevels, [0, 900, 900], 'maxZoom', '×'],
  // Named for its unit rather than "resolution": the row already reads
  // `dpi 1500 [3000 $1200]`, so spelling the unit out on every value as well
  // said it three times over.
  ['dpi', CONFIG.resBonus, [1500, 4600, 9100], 'res', ''],
  // Named for the part rather than the effect: `speed` said nothing about which
  // of the two speeds in the shop it meant, and the cart is the other one.
  // 'flash', not 'shutter': what the row sells is the wait between one frame and
  // the next -- which is what stops the same valuable shot being taken five
  // times over -- and a flash recycling is exactly that wait, in a word the
  // payload already carries as an element id. 'shutter' was seven characters of
  // prose the packer had never seen; this is free.
  ['flash', CONFIG.shutterTiers, [150, 250, 350], 'shutterTier', 's'],
  // ...and the cart is simply how fast you are going, which is what the rider
  // experiences. The unit is what makes the number mean anything: `13` alone
  // could have been a tier, a rank or a multiplier.
  ['speed', CONFIG.cartTiers, [400, 550, 700], 'cartTier', 'm/s'],
];

// How fast the cart is running, in world units per second.
const pace = () => CONFIG.cartTiers[state.cartTier];

// Dollars a frame, on the first ride. A photograph has to beat this to have been
// worth taking, which is the whole reason the shutter is worth aiming -- and at
// $20 the first roll is something a beginner can actually restock.
const FILM = 20;

// ...and half as much again after every ride. A flat price meant a camera that
// had outgrown it could ride forever; rising, it eventually outruns any roll, so
// the game is "shoot the best frame you can, and stay in as long as you can
// afford to". It has to rise GEOMETRICALLY to do that: a photographer whose
// takings grow with their gear will outrun any straight line, and income
// compounds here, because every extra frame you can afford earns more frames
// still. 1.5x a ride catches it while still leaving the early rides cheap --
// which the old quadratic, starting at $1400, emphatically did not.
const price = () => FILM * 1.5 ** state.rides | 0;

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
const RIDE_SECONDS = 100;
let distance = 0;
let shutterQueued = false;
let clock = 0;

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
// The rung the wheel is on stays an integer -- the HUD, the shop ladder and the
// save all read state.zoom -- and this is the lens actually in front of the film,
// easing towards that rung instead of cutting to it.
//
// Eased on the ANGLE, not the zoom factor. Every rung roughly halves the angle,
// so each step takes about the same time; on the factor, 1x->1.2x would crawl
// and 8x->16x would lurch. Both readers take the eased value -- the frustum that
// gets drawn and the one the photograph is taken with -- so what you shot is
// always exactly what you were looking at, mid-zoom or not.
const aimFov = () => CONFIG.baseFov / CONFIG.zoomLevels[state.zoom];
let fovNow = CONFIG.baseFov;
const fov = () => fovNow;
state.zoom = Math.min(state.zoom, state.maxZoom);

// --- input ---------------------------------------------------------------

// Straight up and straight down are both degenerate for view(), which builds its
// basis from yaw and pitch alone -- so neither look path is allowed to reach
// them.
const LIM = Math.PI / 2 - 0.05;
const clampPitch = () => (cam.pitch = Math.max(-LIM, Math.min(LIM, cam.pitch)));

addEventListener('mousemove', (e) => {
  if (state.mode !== RIDE || document.pointerLockElement !== canvas) return;
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
  if (state.mode !== RIDE || e.alpha == null) return;
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
    if (state.mode !== RIDE || t.length < 2) return;
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
  if (e.ctrlKey || state.mode === RIDE) e.preventDefault();
  if (state.mode !== RIDE || !state.maxZoom) return;
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
  if (state.mode === TITLE) {
    state.mode = RIDE;
    ui.hidePanel();
    ui.setChrome(true);
    // The tap that starts the ride is the gesture iOS wants for the orientation
    // stream; a mouse wants the pointer instead.
    TOUCH ? askIMU() : lock();
  } else if (state.mode === RIDE) {
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

// The run's best photograph, kept across rides and across reloads so the
// game-over card has something to show. Written only when it is beaten, which is
// at most once a ride -- see PIC_KEY for why it is not simply in the save.
function keepBest(shot, photo) {
  if (!shot || shot.total <= read(PIC_KEY).n) return;
  try {
    localStorage.setItem(PIC_KEY, JSON.stringify({ p: photo.url, b: shot.b, n: shot.total }));
  } catch (e) { /* a full quota costs the picture, not the run */ }
}

function endRun() {
  state.mode = RESULTS;
  // One result per rider per ride: the total, and the best single frame. Both
  // are wanted twice over now -- on the wire, and by the bank -- so they are
  // worked out before anything spends them.
  let best = 0;
  for (let i = 1; i < state.scored.length; i++) {
    if (state.scored[i].total > state.scored[best].total) best = i;
  }
  const shot = state.scored[best];
  // Not `ride`: that name is the frame loop's ride PROGRESS, and two different
  // numbers under one name in one file is how a lifted-source test ends up
  // pinning the wrong line.
  const paid = state.scored.reduce((a, s) => a + s.total, 0);
  // Borrowed gear earns no money: a multiplayer ride would otherwise be the
  // cheapest way to farm the shop.
  // The ride counter sits inside the same guard for the same reason: a
  // borrowed-gear ride must not make film more expensive back home either -- nor
  // hang its photographs on a solo run's game-over card.
  if (!state.mp) {
    state.bank += paid;
    state.earned += paid;
    state.rides++;
    keepBest(shot, state.photos[best]);
  }
  persist();
  net.done(paid, state.photos.length ? state.photos[best].small : '',
           shot ? shot.b : []);
  ui.setChrome(false);
  document.exitPointerLock();
  showResults();
}

// A match result can be flipped between the winner and your own roll. It is one
// screen with two faces, not a mode of its own.
let ownRoll = 0;

function showResults() {
  state.mode = RESULTS;
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
  state.mode = DETAIL;
  ui.showPhoto(state.scored[i], showResults);
}

// The dead end: no frames left and not enough money to buy one. Nothing you can
// do from here changes either number, so the only honest offer is a fresh start.
// Phrased through the shop's own offer rather than restating its arithmetic: the
// dead end is "no frames, and the cheapest thing that would fix that is refused".
// `frames()` is a call the packer has already seen, which the long form was not.
const broke = () => !state.film && !frames().ok;

function showShop() {
  state.mode = SHOP;
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
  // Both keys: a wiped run that kept its best photograph would open the next
  // game-over card on a picture from a game nobody remembers playing.
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(PIC_KEY);
  } catch (e) { /* nothing to clear */ }
  home();
}

// --- the lobby -----------------------------------------------------------

// The multiplayer card, in or out of a room. No code is the way in -- name
// yourself, then make a room or walk into one -- and a code is that room, which
// is also how "join another" hops rooms: net.connect lets go of the old one.
function lobby(code, host) {
  state.mode = LOBBY;
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
  if (state.mode !== LOBBY) return;  // never yank a rider already on the track
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
  state.mode = TITLE;
  // Reset only when there is something to reset -- a wipe offered to a player
  // with nothing to wipe is a button that does nothing.
  //
  // Read LIVE, through read(SAVE_KEY), not from the `saved` snapshot at boot.
  // That is the whole trick: `saved` never refreshes, so gating on `saved.v` kept
  // the button hidden through a first session however far the player got -- and
  // a player who burned all ten frames on their first ride reached the dead end
  // with the one button that gets out of it missing. persist() has always run by
  // the time broke() can be true, so the dead end is still offered its way out.
  // The picture is read live for the same reason `saved.v` is: the dead end is
  // reached after a ride has already written one, and the boot snapshot predates
  // it.
  ui.showTitle(solo, lobby, restart, broke(), read(SAVE_KEY).v, read(PIC_KEY), state.earned);
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
  if (state.mode === LOBBY) {
    // One primary action, picked here rather than in the card: in a room it
    // starts the ride, out of one it mints the room.
    ui.showLobby(state.code, state.host, net.lobby(), state.name,
                 state.code ? host : create, lobby, back, rename);
  } else if (state.mode === RESULTS) showResults();
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
  // In the fixed step rather than the frame, so the lens travels at the same
  // rate on a 60Hz display and a 144Hz one.
  fovNow += (aimFov() - fovNow) * 0.2;
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
  while (state.mode === RIDE && acc >= STEP) { tick(); acc -= STEP; }

  packInstances(herd, world);
  // A ride is a fixed span of time, not a lap. Measured in laps, a faster cart
  // was a downgrade you paid for: the loop ended sooner, so the same roll of film
  // got fewer chances at it and passed less scenery. Measured in seconds, the
  // shutter sets how many chances you get and the drive train sets how much
  // country they are spread over, which is what both of those ladders are for.
  const ride = clock / RIDE_SECONDS;
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

  if (state.mode === RIDE) {
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
