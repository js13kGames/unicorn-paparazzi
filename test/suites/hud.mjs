// The film counter broke because nothing ever asserted what it renders. Stub the DOM, drive ui.js, and read back what it actually writes.
const nodes = {};
const anims = {};
const node = (id) => (nodes[id] = nodes[id] || {
  id, style: {}, className: '', textContent: '', innerHTML: '', dataset: {},
  offsetWidth: 0, addEventListener() {}, onclick: null, children: [],
  appendChild(c) { this.children.push(c); },
  animate() { anims[id] = (anims[id] || 0) + 1; },
});
globalThis.Image = class { set src(v) { this._src = v; } get src() { return this._src; } };
globalThis.document = { getElementById: node, createElement: () => node('tmp') };
globalThis.performance = { now: () => 1000 };

// The hud reads the zoom off the ladder it is handed. It used to derive it as
// `1 << state.zoom`, which was true only while every rung was a power of two --
// the free 1.2x rung at the bottom is not one, so the ladder comes in on cfg.
import fs from 'fs';
import { fileURLToPath } from 'url';
const CONFIG_SRC = fs.readFileSync(fileURLToPath(new URL('../../src/index.js', import.meta.url)), 'utf8');

const ui = await import('../.mirror/ui.mjs');
const { TITLE, RIDE } = await import('../.mirror/mode.mjs');
const { frame } = await import('../.mirror/photo.mjs');

const state = {
  film: 12, bank: 740, res: 0, zoom: 0, maxZoom: 0, ready: 0,
  photos: [{}, {}, {}], fx: 1, fy: 1,
};
// index.js recomputes the frame every tick and hands it to the hud on `state`;
// do the same here so the viewfinder is driven by the real geometry.
const FOV = Math.PI / 3;
const setFrame = (winAspect) => {
  const f = frame(FOV, winAspect);
  state.fx = f.fx; state.fy = f.fy;
};
setFrame(16 / 9);

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(50),
    ok ? '' : '-> ' + JSON.stringify(got));
};

// index.js hands the ladder itself, not the whole config: `CONFIG.zoomLevels`
// is already written twice over there, so a third mention is cheaper than a new
// `cfg.zoomLevels` for the packer to learn.
const CFG = (0, eval)(/zoomLevels: (\[[^\]]*\])/.exec(CONFIG_SRC)[1]);
ui.updateHud(state, 0.4, 0, CFG);

const film = nodes.film.innerHTML;
console.log('  film box  : ' + JSON.stringify(film));
console.log('');

check('film box shows film remaining', film, (s) => /\b12\b/.test(s));
check('the ladder starts on a free rung barely wider than none',
      /zoomLevels: \[1, 1\.5, /.test(CONFIG_SRC), true);
// A new player owns that rung rather than buying it, or the wheel is dead until
// their first $400 and nothing says the camera has a zoom at all.
// (Clamped to the top of the ladder since the balance pass, so this looks for
// the default rather than for the whole expression.)
check('and a fresh camera already stands on it',
      /maxZoom: .*saved\.z \|\| 1/.test(CONFIG_SRC), true);
check('film box shows the zoom the lens is on', film, (s) => /×1\b/.test(s));
state.zoom = 1; ui.updateHud(state, 0.4, 0, CFG);
check('the free rung reads as the fraction it is, not as a power of two',
      nodes.film.innerHTML, (s) => s.includes('×' + CFG[1]));
state.zoom = CFG.length - 1; ui.updateHud(state, 0.4, 0, CFG);
check('and follows the lens up the ladder', nodes.film.innerHTML,
      (s) => s.includes('×' + CFG[CFG.length - 1]));
state.zoom = 0; ui.updateHud(state, 0.4, 0, CFG);
check('money stays off the film box', nodes.film.innerHTML, (s) => !s.includes('$'));
check('ride bar tracks progress', nodes.bar.style.width, '40.0%');

// --- the quota, live -------------------------------------------------------
// The one number that is worth money mid-ride. The bank is still a between-rides
// number and stays off the screen; what this ride has taken against what it owes
// is the whole of the tension.
//
// It sits in the LEFT column, under the ride progress. It spent a day under the
// film count on the right and was invisible there -- #roll, the thumbnail strip,
// starts at top:60px in that same corner, and a three-line film box reaches
// exactly that far, so the first photograph taken painted a thumbnail over it.
// Anything added to the right-hand box has to clear 60px or it will be covered.
ui.updateHud(state, 0.4, 0, CFG, [282, 3000]);
check('the quota reads as a score against a target', nodes.hud.innerHTML,
      (s) => s.includes('$282 / $3000'));
check('and sits under the ride progress, in the left column',
      nodes.hud.innerHTML.indexOf('$282') > nodes.hud.innerHTML.indexOf('ride '), true);
check('and stays out of the right-hand box the thumbnails cover',
      nodes.film.innerHTML, (s) => !s.includes('$'));
// At a glance: am I safe yet. Red short of the target, green once it is met.
check('short of the target it reads as a loss', nodes.hud.innerHTML,
      (s) => /class="m"/.test(s));
ui.updateHud(state, 0.4, 0, CFG, [3000, 3000]);
check('and exactly on it reads as a gain', nodes.hud.innerHTML,
      (s) => /class="p"/.test(s));
ui.updateHud(state, 0.4, 0, CFG, [4200, 3000]);
check('as does clearing it outright', nodes.hud.innerHTML, (s) => /class="p"/.test(s));
// A match sets no quota, and index.js passes 0 rather than a pair. A stray "$0 /
// $0" on a versus ride would read as a target nobody could ever miss.
ui.updateHud(state, 0.4, 0, CFG, 0);
check('a match shows no quota at all', nodes.hud.innerHTML, (s) => !s.includes('$'));
check('low-film warning off at 12', nodes.film.className, (c) => !/low/.test(c));
state.film = 2; ui.updateHud(state, 0.4, 0, CFG);
check('low-film warning on at 2', nodes.film.className, (c) => /low/.test(c));
state.film = 12;

check('the film counter says what it is counting', film, (t) => /film/.test(t));

// The flash fired once and then stuck on, because a reflow restarts a CSS
// transition but not a CSS animation. It must now fire on EVERY shot.
ui.flash();
check('flash fires on the first shot', anims.flash, 1);
ui.flash(); ui.flash(); ui.flash();
check('flash fires on every later shot too', anims.flash, 4);

// The viewfinder outlines the photograph, and the photograph is now the same
// shape on every camera. The inset used to shrink per tier and reach 0 at the
// top, which put the outline on the screen edge and left nowhere to watch a
// unicorn walk in from; buying a camera must not move the frame at all.
const insets = [];
for (let r = 0; r < 4; r++) { state.res = r; setFrame(16 / 9); ui.updateHud(state, 0.4, 0, CFG); insets.push(nodes.vf.style.inset); }
state.res = 0; setFrame(16 / 9);
console.log('        viewfinder inset per tier: ' + insets.join('  '));
const nums = insets.map(parseFloat);   // '15.0%' > '7.5%' is false as a string
check('viewfinder does not move when you buy a camera',
      nums.every((n) => n === nums[0]), true);
check('and always keeps a margin off the screen edge', nums[0] > 0, true);

// ...and it now needs an inset per axis, because the frame is a fixed 16:9
// rectangle that the window shape no longer stretches.
const shapes = [];
for (const a of [16 / 9, 4 / 3, 21 / 9, 9 / 16]) {
  setFrame(a); ui.updateHud(state, 0.4, 0, CFG);
  shapes.push(a.toFixed(2) + ' -> ' + nodes.vf.style.inset);
}
setFrame(16 / 9);
console.log('        viewfinder inset per window shape: ' + shapes.join('   '));
check('viewfinder carries a vertical and a horizontal inset',
      shapes.every((s) => /^\S+ -> [\d.]+% [\d.]+%$/.test(s)), true);

// The shutter recharges, so a burst of identical frames is not the best play.
state.ready = 5;
ui.updateHud(state, 0.4, 4, CFG);
check('film box shows the winding indicator', nodes.film.innerHTML, (t) => /·/.test(t));
ui.updateHud(state, 0.4, 6, CFG);
check('and returns to the zoom once wound', nodes.film.innerHTML, (t) => /×1\b/.test(t));
state.ready = 0;

// Film roll
ui.addThumb('data:image/jpeg;base64,x');
ui.addThumb('data:image/jpeg;base64,y');
check('film roll collects a thumbnail per shot', nodes.roll.children.length, 2);
check('thumbnails carry their data url', nodes.roll.children[1].src, 'data:image/jpeg;base64,y');

// Results list: worst first, every shot present, clicking yields the right index
const scored = [
  { total: 900, url: 'a', subjects: [{}], bonuses: [], b: [['azure', '900'], [' size', '+900']] },
  { total: 60,  url: 'b', subjects: [],   bonuses: [], b: [] },
  { total: 300, url: 'c', subjects: [{}, {}], bonuses: [{ label: '2 colors' }], b: [] },
];
let picked = null, shopped = false;
ui.showResults({ bank: 1260 }, scored,
               (i) => { picked = i; }, () => { shopped = true; });
const list = nodes.card.innerHTML;
const order = [...list.matchAll(/data-i="(\d)"/g)].map((m) => +m[1]);
check('results list is sorted best to worst', order.join(','), '0,2,1');
check('results list shows every shot', order.length, scored.length);
// The empty label is built out of the words the other rows already use rather
// than being prose of its own, so it reads "0 unicorns".
check('a frame with nothing big enough is labelled', list, (s) => s.includes('0 unicorns'));
check('bonuses appear in the row summary', list, (s) => s.includes('2 colors'));
check('bank is shown', list, (s) => s.includes('1260'));
nodes.card.onclick({ target: { closest: (q) => (q === '.o' ? { dataset: { i: '2' } } : null) }, stopPropagation() {} });
check('clicking a row opens that photo', picked, 2);
nodes.card.onclick({ target: { closest: (q) => (q === '#s' ? {} : null) }, stopPropagation() {} });
check('the shop button reaches the shop', shopped, true);

// Detail view must be able to get back
let backed = false;
ui.showPhoto(scored[0], () => { backed = true; });
check('detail view offers a way back', nodes.card.innerHTML, (s) => s.includes('id="k"'));
nodes.card.onclick({ target: { closest: (q) => (q === 'button' ? { id: 'k' } : null) }, stopPropagation() {} });
check('back returns to the results list', backed, true);

// The lost-pointer hint is a state, not a timed toast: it is on screen for
// exactly as long as riding without the lock is true, which is the whole moment
// the player needs it.
document.pointerLockElement = null;
ui.updateHud({ ...state, mode: RIDE }, 0.4, 0, CFG);
check('riding without the lock says so', nodes.hud.innerHTML, (s) => /click to look/.test(s));
document.pointerLockElement = nodes.c || {};
ui.updateHud({ ...state, mode: RIDE }, 0.4, 0, CFG);
check('and shuts up once the pointer is held', nodes.hud.innerHTML, (s) => !/click to look/.test(s));
document.pointerLockElement = null;
ui.updateHud({ ...state, mode: TITLE }, 0.4, 0, CFG);
check('a card on screen is not a lost pointer', nodes.hud.innerHTML, (s) => !/click to look/.test(s));
// A phone has no pointer to lose, so the hint could only ever be wrong there --
// it would sit on screen for the whole ride telling you to do the one thing the
// device cannot do.
ui.updateHud({ ...state, mode: RIDE, t: 1 }, 0.4, 0, CFG);
check('and a touch device is never told to click', nodes.hud.innerHTML, (s) => !/click to look/.test(s));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
