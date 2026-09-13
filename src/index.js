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
  // Chance a land tile holds a unicorn, on the first ride; climbs 5% a ride at
  // boot, below.
  unicornDensity: 0.0027,
  // Chance a unicorn wears an off-biome color. Drift is the only thing that puts
  // unlike colors in one frame, so it is what makes the color bonus reachable.
  driftChance: 0.35,
  poseWeights: [0.80, 0.10, 0.08, 0.02],
  // What each pose pays over a plain standing shot: +20/40/80%, deliberately not
  // derived from poseWeights -- how often a pose turns up and what it is worth
  // want tuning separately.
  poseBonus: [1, 1.2, 1.4, 1.8],
  trackRadiusFrac: 0.25,
  shutterTiers: [1, 0.5, 0.25, 0.1],   // seconds between frames, per motor drive
  eyeHeight: 2.4,
  baseFov: Math.PI / 3,
  // The first rung is free, so a new player nudging the wheel sees the lens exists.
  // Re-fit with `node test/tools/economy.mjs --sweep` if the density moves.
  zoomLevels: [1, 1.5, 2.5, 4, 8],
  // What one frame-share of unicorn is worth on each sensor. These double as the
  // sensor's NAME, written `1000dpi`: not pixel counts, but the number the score
  // is made of, so `1.2% x 1000dpi  +12` multiplies out exactly on the card.
  resBonus: [1000, 1500, 3000, 6000],
  // Fraction of the frame a unicorn must fill to be counted as a subject.
  minCoverage: 0.002,
  // How steeply a cut outline costs you. Crop and scenery decay exponentially;
  // being behind another unicorn is a linear reduction. cropK is steep because a
  // close shot that cut the outline used to outscore a clean one on size alone.
  cropK: 4,
  envK: 2.0,
  occK: 0.9,
};

const canvas = document.getElementById('c');

// Namespaced per the jam's shared-origin rule, and never localStorage.clear().
const SAVE_KEY = 'unicorn-paparazzi';
// The run's best photo lives under its own key: it is a JPEG data URL, and
// persist() runs on every shutter press, so keeping it in the save proper would
// rewrite a few hundred kilobytes mid-ride.
const PIC_KEY = SAVE_KEY + 'p';

// A key that was never written reads as an empty record.
const read = (k) => {
  try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; }
};

const saved = read(SAVE_KEY);

// The map only thickens in solo: every rider in a match must spawn an identical
// herd, and rivals have not ridden the same number of times. `c` with `g` is a
// match starting -- the same test the boot block below makes.
if (!(saved.c && saved.g)) CONFIG.unicornDensity *= 1.05 ** (saved.s | 0);

// Solo levels are fixed: level n is the same world and herd on every run, which
// is what makes a speck on the horizon worth learning. The hash stays the first
// term -- it is the whole of the shared-seed channel for a match (host picks ->
// relay -> hash -> reload), and `#1234` still forces a world by hand.
const seed = +location.hash.slice(1) || 4242 + (saved.s | 0);
const world = buildWorld(seed, CONFIG);
const herd = spawn(world, CONFIG, seed);
const renderer = createRenderer(canvas, world, herd);
const photoRig = createPhotoRig(renderer.gl, canvas, renderer.draw);

const SAVE_VERSION = 4;

// Frames in the camera, every ride, for everyone. Eight because the ride is 100
// seconds and the slowest shutter is a second: a roll you can afford to waste one
// of. Declared here because the state literal below reads it.
const FRAMES = 8;

// A multiplayer ride is taken on borrowed gear, so it must never write gear or
// bank back into the save. One guard covers every call site.
function persist() {
  if (state.mp) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      t: state.sh,
     
      g: state.go, c: state.room, h: state.owner, n: state.who,
      b: state.bank, z: state.mz, r: state.rs,
      // The level reached. No SAVE_VERSION bump: an older save has no `s`, which
      // reads 0, which is where it would have started. Do not reuse the letter
      // `d` for anything new -- saves in the wild still carry a cart tier there.
      s: state.rides,
      // Whether the last ride missed its quota, which is the only way a run ends.
      // It has to survive the reload between the ride and the shop.
      q: state.dead,
      // What the run earned all told, as opposed to what is left in the bank --
      // the shop spends the bank down, so it is no measure of how the run went.
      e: state.earned,
      y: state.trophies,
      k: state.lastPaid,
    }));
  } catch (e) { /* private browsing: the run just doesn't carry over */ }
}

const state = {
  phase: TITLE,
  bank: saved.b || 0,
  // 1, not 0: the free rung is where everyone starts. Clamped because a save from
  // a build with more tiers indexes off the end of the ladder, which reads as an
  // undefined focal length and a NaN field of view.
  mz: Math.min(saved.z || 1, CONFIG.zoomLevels.length - 1),
  rs: Math.min(saved.r || 0, 3),   // clamped for the same reason
  // A capacity, not a stock: every ride is a page load, so the initialiser IS the
  // refill.
  film: FRAMES,
  lens: 0,
  armed: 0,
  fx: 1, fy: 1,          // photo frame's share of the canvas, set every frame
  sh: saved.t || 0,
  // Rides finished, which is the level number: it picks the seed, sets the quota,
  // and thickens the herd.
  rides: saved.s || 0,
  // Set when a ride comes in under its quota, read by broke(). A run ends here.
  dead: saved.q || 0,
  earned: saved.e || 0,       // gross takings of the whole run; see persist()
  trophies: saved.y || 0,     // cosmetic once the shop has nothing left to sell
  lastPaid: saved.k || 0,     // what the last (failed) ride earned; see endRun()
  room: '',              // the lobby we are in, '' when playing alone
  owner: 0,
  who: saved.n || '',   // what other riders see us called
  photos: [],
  scored: [],
};

// A match is settled by photography, not by who has ridden farther, so it ignores
// the save and everyone rides the same loadout. Top camera because tier 1 encodes
// photos at JPEG quality 0.3, and a match is settled by looking at them.
const MP_GEAR = { mz: 4, rs: 3, sh: 1 };

// The save carries two separate facts. `c` alone means "you belong to this
// lobby", which is what Rematch and a stray refresh come back to. `c` with `g`
// means a ride is starting right now. So only `g` is consumed here: dropping out
// of the match entirely is something you have to actually ask for.
const mpCode = saved.c || '';
if (mpCode && saved.g) {
  state.room = mpCode;
  state.owner = saved.h || 0;
  state.go = 0;
  persist();                       // still the REAL gear: state.mp is not set yet
  Object.assign(state, MP_GEAR);
  state.mp = 1;                    // from here persist() is a no-op
}

// Every upgrade is a ladder: tier values, the price of each step, the state key
// holding how far up it you are, and a suffix. p[i] buys tier i+1, so p is always
// one shorter than v. Prices are set so every ladder returns about the same points
// per dollar at a mid-run loadout, measured by test/tools/economy.mjs -- except
// the motor drive, priced low by hand because the sim samples the lap every 18
// units and cannot see what a faster shutter buys inside that.
const LADDERS = [
  // p[0] is the free rung nobody buys -- you start standing on it.
  ['zoom', CONFIG.zoomLevels, [0, 900, 900, 1400], 'mz', '×'],
  ['dpi', CONFIG.resBonus, [1500, 4600, 9100], 'rs', ''],
  ['flash', CONFIG.shutterTiers, [150, 250, 350], 'sh', 's'],
];

// How fast the cart runs, in world units per second. Fixed, not a ladder: a level
// is a thing you learn, and a cart that ran it at a different speed every run was
// working against that.
const pace = 10;

const offers = () => {
  const list = LADDERS.map(([label, v, p, key, sfx]) => ({
    legend: label, v, p, sfx, at: state[key], price: p[state[key]],
    ok: state.bank >= p[state[key]],
    buy: () => state[key]++,
  }));
  // Only once every real ladder is maxed, so a cosmetic is never offered instead
  // of a real upgrade. `v` is rebuilt from the live count each call, which keeps
  // the button on offer forever instead of maxing out.
  if (LADDERS.every(([, v, , key]) => state[key] >= v.length - 1)) {
    list.push({
      legend: 'trophy', v: [state.trophies, state.trophies + 1], p: [5000], sfx: '',
      at: 0, price: 5000, ok: state.bank >= 5000,
      buy: () => state.trophies++,
    });
  }
  return list;
};

// What this ride must earn to reach the next. Geometric because takings compound
// with gear. Fitted with `node test/tools/economy.mjs --sweep`: $250 x 1.45^n
// spreads the skill bands widest -- 6 rides for a careless player, 12 for a
// careful one -- and only closes on the player around ride ten.
const GOAL = 250, GROWTH = 1.45;
const goal = (n) => GOAL * GROWTH ** n | 0;

const cam = { x: 0, y: 0, z: 0, yaw: 0, tilt: 0 };
const RIDE_SECONDS = 100;
let distance = 0;
let shutterQueued = false;
let clock = 0;

// Start the ride looking along the track rather than at a random compass point.
{
  const a = pathAt(world.route, 0), b = pathAt(world.route, 4);
  cam.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

// The photograph's own vertical fov; what the screen shows is derived from it per
// frame, so window shape changes what you see AROUND the frame, not the frame.
// state.lens is the integer rung the wheel is on; fovNow eases towards it.
//
// Eased on the ANGLE, not the zoom factor: every rung roughly halves the angle, so
// each step takes about the same time. Both the drawn frustum and the photographed
// one read the eased value, so what you shot is what you were looking at.
const aimFov = () => CONFIG.baseFov / CONFIG.zoomLevels[state.lens];
let fovNow = CONFIG.baseFov;
const fov = () => fovNow;
state.lens = Math.min(state.lens, state.mz);

// --- input ---------------------------------------------------------------

// Straight up and straight down are both degenerate for view(), which builds its
// basis from yaw and pitch alone -- so neither look path is allowed to reach
// them.
const LIM = Math.PI / 2 - 0.05;
const clampPitch = () => (cam.tilt = Math.max(-LIM, Math.min(LIM, cam.tilt)));

addEventListener('mousemove', (e) => {
  if (state.phase !== RIDE || document.pointerLockElement !== canvas) return;
  cam.yaw -= e.movementX * 0.0022;
  cam.tilt -= e.movementY * 0.0022;
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
  if (state.phase !== RIDE || e.alpha == null) return;
  const D = Math.PI / 180;
  const a = e.alpha * D, b = e.beta * D, g = e.gamma * D;
  const cg = Math.cos(g), sg = Math.sin(g), sb = Math.sin(b);
  const x = -sg * Math.cos(a) - cg * sb * Math.sin(a);
  const y = -sg * Math.sin(a) + cg * sb * Math.cos(a);
  const yaw = Math.atan2(-x, y);
  // The first reading is the origin, so only the CHANGE from it is ever used:
  // the ride starts looking down the track, and alpha's drift and the
  // absolute/relative split between platforms stop mattering.
  if (yawOff === undefined) yawOff = cam.yaw - yaw;
  cam.yaw = yaw + yawOff;
  cam.tilt = Math.asin(-cg * Math.cos(b));
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
    if (state.phase !== RIDE || t.length < 2) return;
    multi = 1;
    const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    if (!pinch) pinch = d;
    const step = d > pinch * 1.3 ? 1 : d < pinch * 0.77 ? -1 : 0;
    if (step) { pinch = d; zoomBy(step); }
  });
}

// Wheel, +/- and pinch all work the lens, so they share one clamp.
const zoomBy = (n) => (state.lens = Math.max(0, Math.min(state.mz, state.lens + n)));

// A trackpad pinch arrives as ctrl+wheel, which is also the browser's page zoom,
// so cancelling it needs a non-passive listener. Ordinary wheel is swallowed only
// while riding, so the shop panel can still scroll.
addEventListener('wheel', (e) => {
  if (e.ctrlKey || state.phase === RIDE) e.preventDefault();
  if (state.phase !== RIDE || !state.mz) return;
  zoomBy(e.deltaY > 0 ? -1 : 1);
}, { passive: false });

// Safari sends pinch as its own gesture events rather than ctrl+wheel; cancelling
// the start cancels the whole sequence, so the other two need no listener.
addEventListener('gesturestart', (e) => e.preventDefault());

// Chrome rejects this promise if the lock was exited very recently, and an
// unhandled rejection would show up as a console error.
const lock = () => Promise.resolve(canvas.requestPointerLock()).catch(() => {});

function primary() {
  if (state.phase === TITLE) {
    state.phase = RIDE;
    ui.hidePanel();
    ui.setChrome(true);
    // The tap that starts the ride is the gesture iOS wants for the orientation
    // stream; a mouse wants the pointer instead.
    TOUCH ? askIMU() : lock();
  } else if (state.phase === RIDE) {
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
  if (state.film <= 0 || clock < state.armed) return;
  state.armed = clock + CONFIG.shutterTiers[state.sh];
  state.film--;
  // No persist(): the roll refills every ride, so nothing here outlives the page.
  // Tell the room the moment the roll runs out, so the others know when every roll
  // in it is empty.
  if (state.mp && !state.film) net.noFilm();
  ui.flash();
  const photo = photoRig.capture(cam, fov(), herd, state.fx, state.fy, state.rs, state.mp);
  const scored = scorePhoto(photo, CONFIG, state);
  state.photos.push(photo);
  state.scored.push(scored);
  ui.addThumb(photo.pic);
}

// The run's best photograph, kept across rides and across reloads so the
// game-over card has something to show. Written only when it is beaten, which is
// at most once a ride -- see PIC_KEY for why it is not simply in the save.
function keepBest(shot, photo) {
  if (!shot || shot.sum <= read(PIC_KEY).n) return;
  try {
    localStorage.setItem(PIC_KEY, JSON.stringify({ p: photo.pic, b: shot.b, n: shot.sum }));
  } catch (e) { /* a full quota costs the picture, not the run */ }
}

function endRun() {
  state.phase = RESULTS;
  // One result per rider per ride: the total and the best single frame, both
  // wanted twice over (on the wire, and by the bank).
  let best = 0;
  for (let i = 1; i < state.scored.length; i++) {
    if (state.scored[i].sum > state.scored[best].sum) best = i;
  }
  const shot = state.scored[best];
  // Not `ride` -- that name is the frame loop's ride PROGRESS.
  const paid = state.scored.reduce((a, s) => a + s.sum, 0);
  // Borrowed gear earns no money, or a match would be the cheapest way to farm the
  // shop. The level counter is inside the guard for the same reason: a match must
  // not advance a solo run, nor end it by missing a quota it never set.
  if (!state.mp) {
    state.bank += paid;
    state.earned += paid;
    keepBest(shot, state.photos[best]);
    // Checked against the level just ridden, before the counter moves on.
    // `lastPaid` is for the game-over card: it answers "missed by how much" after
    // the run has moved on from `paid`.
    if (paid < goal(state.rides)) { state.dead = 1; state.lastPaid = paid; }
    state.rides++;
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
  state.phase = RESULTS;
  const rivals = net.others();
  // Everyone on the roster except the riders who have reported, and except us.
  // A rider who closes the tab leaves the roster, so this reaches zero and the
  // crown settles rather than waiting on someone who is never coming back.
  const waiting = Math.max(0, net.lobby().length - rivals.length - 1);
  ui.showResults(state, state.scored, showDetail,
                 state.mp ? home : showShop, rivals,
                 state.mp ? waiting : undefined, ownRoll,
                 // The quota of the ride just ridden -- a level behind the counter,
                 // since endRun tests it and THEN increments.
                 state.mp ? 0 : goal(state.rides - 1));
}

function showDetail(pos) {
  // -1 is the My photos / Result toggle rather than a shot.
  if (pos < 0) { ownRoll = !ownRoll; return showResults(); }
  state.phase = DETAIL;
  // `pos` is a rank, not a shot index, so < / > walk the list as ranked on screen.
  const order = state.scored.map((s, i) => i).sort((a, b) => state.scored[b].sum - state.scored[a].sum);
  ui.showPhoto(state.scored[order[pos]], showResults, showDetail, pos, order.length);
}

// The dead end: the last ride missed its quota, and nothing in the shop fixes
// that, so the only offer left is a fresh start.
const broke = () => state.dead;

function showShop() {
  state.phase = SHOP;
  if (broke()) return title();
  ui.showShop(state, CONFIG, offers(), buy, ride, title, goal(state.rides),
              // "If available": the roll only exists on the page load that shot
              // it, so a shop reached at boot or after a reload offers no way back.
              state.scored.length ? showResults : 0);
}

function buy(i) {
  const o = offers()[i];
  // A maxed ladder has no price, and `ok` already refuses it; the price test just
  // guards against selling a tier past the top for nothing.
  if (!o || !o.price || !o.ok) return;
  state.bank -= o.price;
  o.buy();
  persist();
  showShop();
}

// A new ride needs a fresh world and every GL buffer with it. The save holds all
// that carries over, so reloading is cheaper in bytes than tearing the scene down.
function ride() {
  state.go = 1;
  persist();
  home();
}

// Drop the seed, THEN reload. Assigning the bare path only changes the fragment,
// which is a same-document navigation and never reloads. Clearing the hash is also
// what stops a seed adopted for one ride sticking to every later one.
const home = () => { location.hash = ''; location.reload(); };

function restart() {
  // Both keys, or the next game-over card opens on a photo from the wiped run.
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
  state.phase = LOBBY;
  state.room = code || '';
  // Taken, not inferred: booting back into a lobby has to restore whoever was host.
  state.owner = code && host || 0;
  if (code) net.connect(code, state.who, start, refresh);
  refresh();
}

// The only place a room is minted -- deliberately not on entering the card, so you
// are never broadcasting a room before you have a name.
const create = () => lobby('' + (1000 + (Math.random() * 9000 | 0)), 1);

// The ride begins with a reload, because the world has to be rebuilt from the new
// seed either way. The hash carries the seed across it and the save carries the
// code, so everyone reconnects to the same room on the other side.
function start(s) {
  if (state.phase !== LOBBY) return;  // never yank a rider already on the track
  state.go = 1;
  persist();
  // Same trap as home(): a fragment-only change never reloads, and the ride does
  // not begin until the world is rebuilt.
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
  state.who = net.setName(v);
  persist();
}

// Walking out has to close the socket, or the host keeps counting a ghost. Back is
// the way off multiplayer entirely, from either state of the card.
function back() {
  net.close();
  state.room = '';
  persist();               // and stop booting into a lobby that was walked out of
  title();
}

function title() {
  state.phase = TITLE;
  // Read LIVE, not from the boot `saved` snapshot, which never refreshes: gating
  // Reset on `saved.v` hid it for a whole first session, so a player who reached
  // the dead end on their first ride had no way out of it. Same for the picture,
  // which a ride has already written by the time this card can show.
  ui.showTitle(solo, lobby, restart, broke(), read(SAVE_KEY).v, read(PIC_KEY), state.earned,
               goal(state.rides - 1), state.trophies, state.lastPaid);
}

// What the ride is for, and what it has to earn, before every solo ride.
const brief = () => ui.showBrief(goal(state.rides));

// Solo from a ridden world goes back to the shop, not into another ride -- the run
// has upgrades sitting unbought. A fresh boot can just brief and start where it
// stands, rather than paying for a second worldgen.
const solo = () => (distance ? showShop() : brief());

// Whatever screen is up, redraw it: the roster and the results board both move
// on their own as riders arrive, finish and leave.
function refresh() {
  if (state.phase === LOBBY) {
    // One primary action, picked here rather than in the card: in a room it
    // starts the ride, out of one it mints the room.
    ui.showLobby(state.room, state.owner, net.lobby(), state.who,
                 state.room ? host : create, lobby, back, rename);
  } else if (state.phase === RESULTS) showResults();
}

// --- loop ----------------------------------------------------------------

ui.setChrome(false);
// A multiplayer ride rejoins the room its code names, so rivals' results land on
// the board as they finish -- while you are still riding, or after.
if (mpCode) net.connect(mpCode, state.who, start, refresh);
// `g` is a one-shot "Ride again" marker, consumed here so a stray refresh reopens
// the shop instead -- costing the ride but not the bank. A match skips the brief
// card entirely, or a click would hold one rider behind the others.
//
// The dead end is asked FIRST: every branch below it is a way back into a run that
// is already over, and only the third reaches showShop, so a save carrying a lobby
// code or a Ride again marker used to walk straight past the game-over card.
if (broke()) title();
else if (saved.g) { state.go = 0; persist(); state.mp ? primary() : brief(); }
else if (saved.c) lobby(saved.c, saved.h);
else if (saved.v) showShop();
else title();

// The simulation advances in whole steps of this, never in wall-clock time.
// updateHerd draws from one shared RNG stream inside dt-gated branches, so the
// number and ORDER of draws is a function of the tick count alone -- which is what
// lets a 60Hz and a 144Hz machine ride an identical ride. `clock` is always
// exactly tickCount * STEP.
const STEP = 1 / 60;
let acc = 0;

function tick() {
  // In the fixed step rather than the frame, so the lens travels at the same
  // rate on a 60Hz display and a 144Hz one.
  fovNow += (aimFov() - fovNow) * 0.2;
  clock += STEP;
  distance += pace * STEP;
  updateHerd(herd, world, CONFIG, STEP);
}

let last = performance.now();
function frame(now) {
  // Capped so a long stall cannot spin this loop; the cost is that the dropped
  // ticks are simply lost, which a networked ride would have to resync.
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (state.phase === RIDE && acc >= STEP) { tick(); acc -= STEP; }

  packInstances(herd, world);
  // A ride is a fixed span of time, not a lap: measured in laps, a faster cart
  // would be a downgrade you paid for.
  const ride = clock / RIDE_SECONDS;
  // The cart alone is smoothed across the leftover accumulator so it does not
  // judder above the tick rate. Presentation only: never fed back into the sim.
  const p = pathAt(world.route, distance + pace * acc);
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

  if (state.phase === RIDE) {
    // Gated to RIDE: once the ride ends `state.rides` moves on to a higher quota,
    // and one more update would flash the just-met quota red as it jumped.
    ui.updateHud(state, ride, clock, CONFIG.zoomLevels, state.mp ? 0 :
                 [state.scored.reduce((a, s) => a + s.sum, 0), goal(state.rides)]);
    if (ride >= 1) endRun();
    // Solo, an empty roll ends the ride at once. In a match the cart runs on with
    // a dead shutter until every roll in the room is empty, so the first rider to
    // burn their film is not thrown off the track while the others shoot.
    else if (state.film <= 0 && (!state.mp || net.allSpent())) endRun();
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
