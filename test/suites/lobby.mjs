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
    // Cards route clicks two ways -- some read closest('button') and switch on
    // the id, some ask for closest('#thing') directly. Answer both.
    target: { closest: (sel) => (sel === 'button' || sel === '#' + id ? { id } : null) },
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

// --- the match result ----------------------------------------------------
// Three shapes, one function: solo, a match still waiting, and a match with
// everyone in. The last is the one that shows a photograph rather than a row.
const state = { bank: 700 };
const shot = (n, url) => ({ total: n, url, subjects: [], bonuses: [],
                            b: [['azure', '' + n], [' size', '+' + n]] });
let picked = null;
const results = (rivals, waiting, mine) => {
  picked = null;
  ui.showResults(state, [shot(100, 'lo.jpg'), shot(400, 'hi.jpg')], 'You completed the lap.',
                 (i) => { picked = i; }, () => {}, rivals, waiting, mine);
};

results(null, undefined);
check('alone, there is no board at all and the bank still shows',
      card(), (h) => !h.includes('winner') && h.includes('bank 700'));
check('and the way on is the shop', card(), (h) => h.includes('id="shop"'));

// --- still riding ---
results([{ i: 'bbbb2222', n: 900, p: 'r.jpg', b: [] }], 1);
check('while a rider is still out, the result is withheld',
      card(), (h) => h.includes('waiting for 1') && !h.includes('winner'));
check('and no scores are on show yet', card(), (h) => !h.includes('900'));
// A rider who types the code mid-lap never reports, so waiting can stall for
// good. Both ways off this screen have to work even then.
check('but both ways out are still offered',
      card(), (h) => h.includes('id="mine"') && h.includes('id="shop"'));
check('and the exit is a rematch, never the shop',
      card(), (h) => h.includes('Rematch') && !h.includes('Shop'));

// --- a rival won ---
results([{ i: 'bbbb2222', n: 900, p: 'r.jpg', b: [['coral', '900']] }], 0);
check('the winner is named', card(), (h) => h.includes('winner rider bbbb'));
check('their photograph is the card, not a thumbnail',
      card(), (h) => h.includes('<img src="r.jpg"'));
check('and their breakdown came off the wire with them',
      card(), (h) => h.includes('coral') && h.includes('900'));
// Second place is a full card too, not a thumbnail and a number.
check('the runner-up gets a card of their own, ranked',
      card(), (h) => h.includes('<h2>2. you</h2>'));
check('with their own photograph on it', card(), (h) => h.includes('<img src="hi.jpg">'));
check('and their own breakdown under it', card(), (h) => h.includes('+400'));
check('nobody is listed twice', card().split('rider bbbb').length - 1, 1);

// --- you won ---
results([{ i: 'bbbb2222', n: 100, p: 'r.jpg', b: [] }], 0);
check('winning says so', card(), (h) => h.includes('winner you'));
// Your own entry used to be stubbed with no photo and no breakdown, so winning
// showed a blank card.
check('your own best shot is the photograph on it',
      card(), (h) => h.includes('<img src="hi.jpg"'));
check('and your own breakdown is under it', card(), (h) => h.includes('+400'));
// The leading space on a label is the whole contract between score.js and this
// renderer: it is what says "detail of the row above" rather than a subject.
check('a detail row is dimmed and indented under its subject',
      card(), (h) => h.includes('<tr class="dim"><td>&nbsp; size'));
check('while a subject header is ruled off instead',
      card(), (h) => h.includes('<tr class="rule"><td>azure'));

// --- your roll, on the same screen ---
results([{ i: 'bbbb2222', n: 100, p: 'r.jpg', b: [] }], 0, 1);
check('My Photos swaps the cards for your roll',
      card(), (h) => h.includes('data-i="0"') && h.includes('data-i="1"') && !h.includes('winner'));
check('and it is titled after the button that opened it',
      card(), (h) => h.includes('<h1>My Photos</h1>'));
check('the button turns into the way back', card(), (h) => h.includes('>Results<'));
// The whole point of the view: yours, and only yours.
check('and no rival appears on it at all',
      card(), (h) => !h.includes('rider bbbb') && !h.includes('r.jpg'));
check('your own roll is best first',
      card().indexOf('data-i="1"') < card().indexOf('data-i="0"'));
click('mine');
check('the toggle reports itself as the -1 pick', picked, -1);

results([{ i: 'bbbb2222', n: 100, p: '', b: [] }], 0);
nodes.card.onclick({ stopPropagation() {},
  target: { closest: (q) => (q === '.row' ? { dataset: { i: '1' } } : null) } });
check('and a shot in the roll still opens on its index', picked, 1);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
