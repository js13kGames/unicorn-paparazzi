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
// The ids ui.js looks up at module load, which index.html always provides.
const STATIC = ['hud', 'film', 'bar', 'flash', 'panel', 'card', 'vf', 'roll', 'belt'];
// Everything else has to actually be in the card that was just rendered. A stub
// that hands back a node for any id at all cannot catch the bug where a screen
// stops drawing an element but still wires up a handler on it.
globalThis.document = {
  getElementById: (id) =>
    (STATIC.includes(id) || (nodes.card || {}).innerHTML.includes('id="' + id + '"')
      ? node(id) : null),
  createElement: () => node('tmp'),
};
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
// The dead end reads the run out, so it takes the run's best photograph -- the
// record index.js keeps under its own localStorage key -- and what the whole run
// earned. Every other state of this card ignores both.
const PIC = { p: 'best.jpg', b: [['violet', '820'], [' size', '+820']], n: 820 };
const showTitle = (reset, lost, saved = 1, pic = {}, earned = 0, missed = 0, paid = 0) =>
  ui.showTitle(() => hits.push('solo'), () => hits.push('mp'), reset, lost, saved,
               pic, earned, missed, 0, paid);

showTitle(0, 0, 0);
check('the title offers both ways in', /id="go"[\s\S]*id="mp"/.test(card()));
// Nothing on disk yet, so there is nothing to wipe and no button for it. What
// makes this safe is that index.js reads the save live rather than from its boot
// snapshot -- see save.mjs, where a stale read is what once walled in a
// first-session player who burned their whole roll.
check('but not Reset, with nothing yet to reset',
      card(), (h) => !h.includes('id="x"'));
click('mp');
check('the multiplayer button opens the lobby', hits.pop(), 'mp');
check('and the click never reaches the panel underneath', stopped);
click('go');
check('the other button rides alone', hits.pop(), 'solo');

showTitle(() => hits.push('reset'));
check('a returning player is offered Reset', card(), (h) => h.includes('>Reset<'));
click('x');
check('and it wipes rather than riding', hits.pop(), 'reset');

// --- the dead end --------------------------------------------------------
// A ride that came in under its quota. It is this card rather than one of its
// own, so what has to hold is that the two things you cannot afford are gone and
// the one thing that still works is not.
showTitle(() => hits.push('reset'), 1, 1, PIC, 4300, 3000, 2200);
const lost = card();
// The figures it names are what this ride made against what it needed, not the
// bank and not the whole run's take.
check('losing says why', lost, (h) => h.includes('missed $2200 / $3000'));
check('and says it is over as well as why',
      lost, (h) => h.includes('Game over'));
// The only reading the run ever gets: the best frame of the whole game, its
// breakdown intact, and the gross takings -- not the bank, which the shop has
// spent down and which says nothing about how the run went.
check('the run\'s best photograph is the card', lost, (h) => h.includes('<img src="best.jpg">'));
check('with its breakdown under it', lost, (h) => h.includes('violet') && h.includes('+820'));
check('and its score as the total', lost, (h) => h.includes('<b>820</b>'));
// Named: a lone dollar figure under a photograph could as easily have been the
// bank or the last ride's takings, and it was read as both in playtesting.
check('the takings are what is reported, not the bank',
      lost, (h) => h.includes('<h2>total earnings $4300</h2>'));
// A run whose best was never written -- an empty roll burned on nothing at all
// -- still has to render. photoCard already draws no <img> for an empty url.
showTitle(() => hits.push('reset'), 1);
check('a run with no photograph to show still draws',
      card(), (h) => !h.includes('<img') && h.includes('<h2>total earnings $0</h2>'));
showTitle(() => hits.push('reset'), 1, 1, PIC, 4300);
check('and takes away the ride you cannot pay for', lost, (h) => !h.includes('id="go"'));
check('and multiplayer with it, since the match is over too',
      lost, (h) => !h.includes('id="mp"'));
// persist() has run by the time the roll can be empty, so the dead end always
// arrives with a save behind it and this button is always there.
check('leaving Reset as the only way on', lost, (h) => h.includes('>Reset<'));
click('x');
check('which still wipes', hits.pop(), 'reset');

// --- the briefing --------------------------------------------------------
// What the game wants, said once, before every solo ride. You used to arrive on
// a moving cart with eight frames and a dollar figure in the corner and nothing
// anywhere had said to photograph the unicorns or what the figure was for.
ui.showBrief(3000);
const brief = card();
check('the briefing says what to do', brief, (h) => /pictures of unicorns/i.test(h));
check('and that better ones pay more', brief, (h) => /earn more/i.test(h));
check('and what this ride has to make', brief, (h) => h.includes('$3000'));
// The one rule the game will not teach you by playing: a dark unicorn anywhere
// in frame zeroes the photograph, so the shot that teaches it costs a frame and
// reads as a scoring bug. It is marked as a problem, not just a hint -- `h m`.
check('and it warns that dark unicorns void a photograph',
      brief, (h) => /dark unicorns earn \$0/.test(h) && /class="h m"/.test(h));
// THE load-bearing property: index.js binds a click anywhere on the panel to
// primary(), which starts the ride while the mode is still TITLE. A button here
// would call onCard(), which stopPropagation()s -- and the card would swallow
// the very click that is supposed to ride it away, stranding the player on a
// screen with no way off it.
check('and it carries no button to swallow the click that starts the ride',
      brief, (h) => !h.includes('<button'));

// --- the multiplayer card ------------------------------------------------
// One card, two states: no code is the way in (name yourself, then make a room
// or walk into one), a code is the room itself.
const seen = [];
const show = (code, host, riders, name = 'Ada') => {
  ui.showLobby(code, host, riders, name,
               () => seen.push(code ? 'start' : 'create'),
               (c) => seen.push('join:' + c), () => seen.push('back'),
               (v) => seen.push('name:' + v));
  // A browser fills the field in from the value attribute; the stub does not, so
  // do it here or every read comes back empty.
  const f = document.getElementById('n');
  if (f) f.value = name;
};

// --- out of a room: who you are, and the two doors ------------------------
show('', 0, []);
check('the way in names itself rather than a room',
      card(), (h) => h.includes('<h1>Multiplayer</h1>') && !h.includes('<h2>Join code'));
check('and there is no roster to draw yet', card(), (h) => !h.includes('<table>'));
check('both doors are offered at once, no toggle in between',
      card(), (h) => h.includes('>Create Game<') && h.includes('id="j"') && h.includes('id="o"'));
check('the name field carries what you are called',
      card(), (h) => h.includes('id="n"') && h.includes('value="Ada"'));
// Create and Start are the same button -- one primary action per state -- so
// out of a room it can only read as Create.
check('and it is Create out here, never Start', card(), (h) => !h.includes('Start'));

// The gate: what each door actually needs, live as you type rather than when you
// leave the field. Create needs a name; Join needs a name AND somewhere to go.
const n = document.getElementById('n');
const jf = document.getElementById('j');
n.value = ''; jf.value = '';
n.oninput();
check('a nameless rider cannot create', document.getElementById('a').disabled, true);
check('nor join', document.getElementById('o').disabled, true);
n.value = 'Ada';
n.oninput();
check('typing a name opens Create', document.getElementById('a').disabled, false);
// The old gate opened Join on the name alone, which lit a door the four-digit
// guard then quietly refused to let anyone walk through.
check('but Join needs a code as well as a name',
      document.getElementById('o').disabled, true);
jf.value = '12';
jf.oninput();
check('and half a code is not a code', document.getElementById('o').disabled, true);
jf.value = '1234';
jf.oninput();
check('four digits and a name opens Join', document.getElementById('o').disabled, false);

click('a');
check('Create mints a room without a code', seen.pop(), 'create');
check('and the click never reaches the panel', stopped);
click('o');
check('Join walks into the one you were given', seen.pop(), 'join:1234');
// Enter reaches join() past the button, so the four-digit guard stands there
// too rather than only on the button's disabled attribute.
nodes.card.onkeydown({ key: 'Enter', stopPropagation() {} });
check('and Enter does the same', seen.pop(), 'join:1234');
jf.value = 'abcd';
nodes.card.onkeydown({ key: 'Enter', stopPropagation() {} });
check('but Enter on a non-numeric code goes nowhere', seen.length, 0);
jf.value = '77';
nodes.card.onkeydown({ key: 'Enter', stopPropagation() {} });
check('and a short one likewise', seen.length, 0);
jf.value = '1234';
n.onchange({ target: { value: 'Bo' } });
check('the name is reported once, on change rather than per keystroke',
      seen.pop(), 'name:Bo');
click('k');
check('and Back is the way off multiplayer', seen.pop(), 'back');

// net.js hands the roster over already named, yours reading "You!", so there is
// nothing here to work out about which rider is which.
show('4821', 1, ['You!']);
check('the code is the headline, big enough to read out', /<h1>4821<\/h1>/.test(card()));
check('a lobby of one lists just you', card(), (h) => h.includes('You!'));
check('and the host cannot start alone', card(), (h) => /id="a" disabled/.test(h));

show('4821', 1, ['You!', 'rider bbbb']);
check('a second rider appears on the roster', card(), (h) => h.includes('rider bbbb'));
check('and now the host can start', card(), (h) => /id="a"(?! disabled)/.test(h));
click('a');
check('starting is routed to the host handler', seen.pop(), 'start');

// A code that is not four digits must not send you anywhere: the room name would
// simply be wrong and you would sit alone in it.
check('a room has no name field: you named yourself on the way in',
      card(), (h) => !h.includes('id="n"'));
// Once you are in a room, the way to another one is out of this one -- a join
// field under your own code just invites you to type the number you can see.
check('and no join field either', card(), (h) => !h.includes('id="j"'));
check('nor a Join button', card(), (h) => !h.includes('id="o"'));

// Space is the shutter everywhere else in the game; inside a text field it has
// to be a keystroke, so the card swallows the event rather than firing a photo.
let swallowed = false;
nodes.card.onkeydown({ key: ' ', stopPropagation: () => { swallowed = true; } });
check('typing in the lobby keeps Space away from the shutter', swallowed);

click('k');
check('back leaves the room', seen.pop(), 'back');

// --- the guest's screen --------------------------------------------------
show('4821', 0, ['You!', 'rider aaaa']);
check('a guest is told to wait instead of being offered the button',
      card(), (h) => h.includes('waiting for host') && !h.includes('id="a"'));
// join() has to survive the field it reads not being on the card at all.
nodes.card.onkeydown({ key: 'Enter', stopPropagation() {} });
check('and Enter with no code field does not throw', seen.length, 0);
check('but they can still walk out', card(), (h) => h.includes('id="k"'));
click('k');
check('and that still works', seen.pop(), 'back');

// --- the match result ----------------------------------------------------
// Three shapes, one function: solo, a match still waiting, and a match with
// everyone in. The last is the one that shows a photograph rather than a row.
const state = { bank: 700 };
const shot = (n, url) => ({ sum: n, pic: url, subjects: [], bonuses: [],
                            b: [['azure', '' + n], [' size', '+' + n]] });
const rival = (n, p, b = []) => ({ who: 'Bo', n, p, b });
let picked = null;
const results = (rivals, waiting, mine) => {
  picked = null;
  ui.showResults(state, [shot(100, 'lo.jpg'), shot(400, 'hi.jpg')],
                 (i) => { picked = i; }, () => {}, rivals, waiting, mine);
};

results(null, undefined);
check('alone, there is no board at all and the money still shows',
      card(), (h) => !h.includes('place:') && h.includes('$700'));
check('and the way on is the shop', card(), (h) => h.includes('id="s"'));

// --- still riding ---
results([rival(900, 'r.jpg')], 1);
check('while a rider is still out, the result is withheld',
      card(), (h) => h.includes('waiting for 1') && !h.includes('place:'));
check('and no scores are on show yet', card(), (h) => !h.includes('900'));
// A rider who types the code mid-ride never reports, so waiting can stall for
// good. Both ways off this screen have to work even then.
check('but both ways out are still offered',
      card(), (h) => h.includes('id="m"') && h.includes('id="s"'));
check('and the exit is a rematch, never the shop',
      card(), (h) => h.includes('Rematch') && !h.includes('Shop'));

// --- a rival won ---
results([rival(900, 'r.jpg', [['coral', '900']])], 0);
check('the winner is named, and placed', card(), (h) => h.includes('1st place: Bo'));
check('their photograph is the card, not a thumbnail',
      card(), (h) => h.includes('<img src="r.jpg"'));
check('and their breakdown came off the wire with them',
      card(), (h) => h.includes('coral') && h.includes('900'));
// Second place is a full card too, not a thumbnail and a number.
check('the runner-up gets a card of their own, ranked',
      card(), (h) => h.includes('<h2>2nd place: You!</h2>'));
check('with their own photograph on it', card(), (h) => h.includes('<img src="hi.jpg">'));
check('and their own breakdown under it', card(), (h) => h.includes('+400'));
check('nobody is listed twice', card().split('place: Bo').length - 1, 1);

// --- you won ---
results([rival(100, 'r.jpg')], 0);
check('winning says so', card(), (h) => h.includes('1st place: You!'));
// Your own entry used to be stubbed with no photo and no breakdown, so winning
// showed a blank card.
check('your own best shot is the photograph on it',
      card(), (h) => h.includes('<img src="hi.jpg"'));
check('and your own breakdown is under it', card(), (h) => h.includes('+400'));
// The leading space on a label is the whole contract between score.js and this
// renderer: it is what says "detail of the row above" rather than a subject.
check('a detail row is dimmed and indented under its subject',
      card(), (h) => h.includes('<tr class="d"><td>&nbsp; size'));
check('while a subject header is ruled off instead',
      card(), (h) => h.includes('<tr class="r"><td>azure'));

// --- your roll, on the same screen ---
results([rival(100, 'r.jpg')], 0, 1);
check('Photos swaps the cards for your roll',
      card(), (h) => h.includes('data-i="0"') && h.includes('data-i="1"') && !h.includes('place:'));
check('and it is titled after the button that opened it',
      card(), (h) => h.includes('<h1>Photos</h1>'));
check('the button turns into the way back', card(), (h) => h.includes('>Results<'));
// The whole point of the view: yours, and only yours.
check('and no rival appears on it at all',
      card(), (h) => !h.includes('Bo') && !h.includes('r.jpg'));
// Rows are keyed by rank now, not raw shot index, so best-first means rank 0
// (hi.jpg, the higher score) leads rank 1 (lo.jpg) -- the opposite ordering of
// the raw indices those two shots happen to have been passed in at.
check('your own roll is best first',
      card().indexOf('data-i="0"') < card().indexOf('data-i="1"'));
click('m');
check('the toggle reports itself as the -1 pick', picked, -1);

results([rival(100, '')], 0);
nodes.card.onclick({ stopPropagation() {},
  target: { closest: (q) => (q === '.o' ? { dataset: { i: '1' } } : null) } });
check('and a shot in the roll still opens on its index', picked, 1);

// --- gains, losses and multipliers are colored ---------------------------
// The breakdown is a wall of numbers; the sign is the fastest thing to read.
// A plain subtotal must stay neutral -- naively testing the character after the
// first would paint "43" red, since its tail parses as 3.
{
  const card = ui.photoCard('', [
    ['red neighing', '366'], [' 8.5% × 1000dpi', '+85'], [' pose', '+90%'],
    [' obscured', '-20'], [' bicorn', '+50%'], ['green', '43'],
    ['framing', '+11%'], ['2 colors · 2 × 20%', '+40%'],
  ], 'a heading', 911);
  const cls = {};
  for (const m of card.matchAll(/<td>(?:&nbsp;)?([^<]*)<\/td><td class="([^"]*)">([^<]*)</g)) {
    cls[m[3]] = m[2];
  }
  console.log('        ' + Object.entries(cls).map(([v, c]) => v + '=' + c).join('  '));
  check('a gain is green', cls['+85'], 'n p');
  check('a loss is red', cls['-20'], 'n m');
  // Every adjustment is a signed percentage now -- pose, horns, framing and the
  // colour bonus alike -- so the sign is the whole of the colouring contract and
  // photoCard has no multiplier case left to get wrong.
  check('a pose gain is green', cls['+90%'], 'n p');
  check('and a horn gain with it', cls['+50%'], 'n p');
  check('framing above parity is green', cls['+11%'], 'n p');
  check('a plain subtotal is left alone', cls['366'], 'n');
  check('and so is one whose tail looks like a small number', cls['43'], 'n');
}
{
  const card = ui.photoCard('', [['framing', '-38%']], 'h', 1);
  check('framing below parity is red',
        /<td class="n m">-38%</.test(card), true);
  // Exactly parity prints unsigned, so it earns neither color.
  check('framing at parity is left alone',
        /<td class="n">0%</.test(ui.photoCard('', [['framing', '0%']], 'h', 1)), true);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
