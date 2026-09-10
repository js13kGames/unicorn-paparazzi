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

const ui = await import('../.mirror/ui.mjs');
const { frame } = await import('../.mirror/photo.mjs');

const cfg = {
  zoomLevels: [1, 2, 4, 8, 16], resNames: ['low', 'med', 'high', 'ultra'],
  filmTiers: [15, 20, 30, 40, 50],
};
const state = {
  film: 12, filmTier: 0, res: 0, zoom: 0, maxZoom: 0, ready: 0,
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

ui.updateHud(state, cfg, 0.4, 0);

const film = nodes.film.innerHTML;
console.log('  film box  : ' + JSON.stringify(film));
console.log('');

check('film box shows film remaining', film, (s) => /\b12\b/.test(s));
check('film box shows shots taken', film, (s) => /\b3\b/.test(s));
check('film box shows roll capacity', film, (s) => /\b15\b/.test(s));
check('lap bar tracks progress', nodes.bar.style.width, '40.0%');
check('low-film warning off at 12', nodes.film.className, (c) => !/low/.test(c));
state.film = 2; ui.updateHud(state, cfg, 0.4, 0);
check('low-film warning on at 2', nodes.film.className, (c) => /low/.test(c));
state.film = 12;

check('the film counter says what it is counting', film, (t) => /Film Remaining/.test(t));

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
for (let r = 0; r < 4; r++) { state.res = r; setFrame(16 / 9); ui.updateHud(state, cfg, 0.4, 0); insets.push(nodes.vf.style.inset); }
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
  setFrame(a); ui.updateHud(state, cfg, 0.4, 0);
  shapes.push(a.toFixed(2) + ' -> ' + nodes.vf.style.inset);
}
setFrame(16 / 9);
console.log('        viewfinder inset per window shape: ' + shapes.join('   '));
check('viewfinder carries a vertical and a horizontal inset',
      shapes.every((s) => /^\S+ -> [\d.]+% [\d.]+%$/.test(s)), true);

// The shutter recharges, so a burst of identical frames is not the best play.
state.ready = 5;
ui.updateHud(state, cfg, 0.4, 4);
check('film box shows the winding indicator', nodes.film.innerHTML, (t) => /⏳/.test(t));
ui.updateHud(state, cfg, 0.4, 6);
check('and returns to the shot count once wound', nodes.film.innerHTML, (t) => /3\/15/.test(t));
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
  { total: 300, url: 'c', subjects: [{}, {}], bonuses: [{ label: '2 colours' }], b: [] },
];
let picked = null, shopped = false;
ui.showResults({ bank: 1260 }, scored,
               (i) => { picked = i; }, () => { shopped = true; });
const list = nodes.card.innerHTML;
const order = [...list.matchAll(/data-i="(\d)"/g)].map((m) => +m[1]);
check('results list is sorted best to worst', order.join(','), '0,2,1');
check('results list shows every shot', order.length, scored.length);
check('a frame with nothing big enough is labelled', list, (s) => s.includes('No clear unicorns'));
check('bonuses appear in the row summary', list, (s) => s.includes('2 colours'));
check('bank is shown', list, (s) => s.includes('1260'));
nodes.card.onclick({ target: { closest: (q) => (q === '.row' ? { dataset: { i: '2' } } : null) }, stopPropagation() {} });
check('clicking a row opens that photo', picked, 2);
nodes.card.onclick({ target: { closest: (q) => (q === '#shop' ? {} : null) }, stopPropagation() {} });
check('the shop button reaches the shop', shopped, true);

// Detail view must be able to get back
let backed = false;
ui.showPhoto(scored[0], () => { backed = true; });
check('detail view offers a way back', nodes.card.innerHTML, (s) => s.includes('id="back"'));
nodes.card.onclick({ target: { closest: (q) => (q === 'button' ? { id: 'back' } : null) }, stopPropagation() {} });
check('back returns to the results list', backed, true);

// toast surfaces through the hud line while it is live
ui.toast('no red attractor');
ui.updateHud(state, cfg, 0.4, 0);
check('toast appears in the hud', nodes.hud.textContent, (s) => /no red attractor/.test(s));
globalThis.performance = { now: () => 999999 };
ui.updateHud(state, cfg, 0.4, 0);
check('toast expires', nodes.hud.textContent, (s) => !/no red attractor/.test(s));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
