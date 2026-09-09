// The lobby and the versus board are pure string-building, so stub the DOM the
// way hud.mjs does and read back what they actually render. What matters here is
// the routing (which button does what) and the crown, because both are easy to
// get subtly wrong and neither shows up in any other suite.
const nodes = {};
const node = (id) => (nodes[id] = nodes[id] || {
  id, style: {}, className: '', textContent: '', innerHTML: '', dataset: {},
  value: '', onclick: null, onkeydown: null, addEventListener() {}, children: [],
  appendChild(c) { this.children.push(c); },
  animate() {},
});
globalThis.Image = class {};
globalThis.document = { getElementById: node, createElement: () => node('tmp') };
globalThis.performance = { now: () => 0 };

const ui = await import('../.mirror/ui.mjs');

let fails = 0;
const check = (name, got, want = true) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(58), ok ? '' : '-> ' + JSON.stringify(got));
};

const card = () => nodes.card.innerHTML;
// The panel listener in index.js reads any click in title mode as "start
// riding", so every card that has buttons of its own must stop the click. Record
// whether it did.
let stopped = false;
const click = (id) => {
  stopped = false;
  nodes.card.onclick({
    stopPropagation: () => { stopped = true; },
    target: { closest: (sel) => (sel === 'button' ? { id } : null) },
  });
};

// --- the title -----------------------------------------------------------
const hits = [];
ui.showTitle(() => hits.push('solo'), () => hits.push('mp'));
check('the title offers both ways in', /id="go"[\s\S]*id="mp"/.test(card()));
click('mp');
check('the multiplayer button opens the lobby', hits.pop(), 'mp');
check('and the click never reaches the panel underneath', stopped);
click('go');
check('the other button rides alone', hits.pop(), 'solo');

// --- the lobby -----------------------------------------------------------
const seen = [];
const show = (code, host, riders, mine) =>
  ui.showLobby(code, host, riders, mine, () => seen.push('start'),
               (c) => seen.push('join:' + c), () => seen.push('back'));

show('4821', 1, ['aaaa1111'], 'aaaa1111');
check('the code is the headline, big enough to read out', /<h1>4821<\/h1>/.test(card()));
check('a lobby of one lists just you', card(), (h) => /aaaa \(you\)/.test(h));
check('and the host cannot start alone', card(), (h) => /id="start" disabled/.test(h));

show('4821', 1, ['aaaa1111', 'bbbb2222'], 'aaaa1111');
check('a second rider appears on the roster', card(), (h) => h.includes('rider bbbb'));
check('and now the host can start', card(), (h) => /id="start"(?! disabled)/.test(h));
click('start');
check('starting is routed to the host handler', seen.pop(), 'start');

show('4821', 0, ['aaaa1111', 'bbbb2222'], 'bbbb2222');
check('a guest is told to wait instead of being offered the button',
      card(), (h) => h.includes('waiting for the host') && !h.includes('id="start"'));

// Typing a code and joining. A code that is not four digits must not send you
// anywhere -- the room name would simply be wrong and you would sit alone.
nodes.j.value = '77';
click('join');
check('a short code is refused', seen.length, 0);
nodes.j.value = 'abcd';
click('join');
check('and a non-numeric one too', seen.length, 0);
nodes.j.value = '1234';
click('join');
check('four digits joins that room', seen.pop(), 'join:1234');
nodes.j.onkeydown({ key: 'Enter', stopPropagation() {} });
check('and Enter does the same', seen.pop(), 'join:1234');

// Space is the shutter everywhere else in the game; inside the code field it has
// to be a keystroke, so the field swallows the event rather than firing a photo.
let swallowed = false;
nodes.j.onkeydown({ key: ' ', stopPropagation: () => { swallowed = true; } });
check('the code field keeps Space away from the shutter', swallowed);

click('back');
check('back leaves the lobby', seen.pop(), 'back');

// --- the versus board ----------------------------------------------------
const state = { bank: 700 };
const shot = (n) => ({ total: n, url: '', subjects: [], bonuses: [] });
const results = (rivals, waiting) =>
  ui.showResults(state, [shot(100), shot(400)], 'You completed the lap.',
                 () => {}, () => {}, rivals, waiting);

results(null, undefined);
check('alone, there is no board at all and the bank still shows',
      card(), (h) => !h.includes('winner') && h.includes('bank 700'));
check('and the way on is the shop', card(), (h) => h.includes('id="shop"'));

// Our own two shots total 500, so a rival on 900 beats us and a rival on 100 does not.
results([{ i: 'bbbb2222', n: 900, p: '' }], 1);
check('a rival ahead of us takes the top row',
      card(), (h) => h.indexOf('rider bbbb') < h.indexOf('<b>you</b>'));
check('while riders are still out the crown is only provisional',
      card(), (h) => h.includes('leader') && !h.includes('winner'));
check('and it says how many are still on the track', card(), (h) => h.includes('riding: 1'));

results([{ i: 'bbbb2222', n: 100, p: '' }], 0);
check('once everyone is in the crown settles', card(), (h) => h.includes('winner'));
check('and it sits on our row when we won',
      card(), (h) => h.indexOf('<b>you</b>') < h.indexOf('rider bbbb'));
check('a multiplayer lap shows no bank, because it never paid one',
      card(), (h) => !h.includes('bank'));
// The shop is where both kinds of lap end -- a multiplayer one reloads into it,
// since its world and its borrowed gear are spent -- so the label is the same.
check('and a multiplayer lap ends at the same door', card(), (h) => h.includes('id="shop"'));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
