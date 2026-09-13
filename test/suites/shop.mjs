// The shop is three columns: what the ladder is, the rung you are on, and the
// one rung you can buy with its price inside the button. It used to draw every
// tier, which was a table of markup for something read once. These checks pin
// what the player can actually read and click.
const nodes = {};
const node = (id) => (nodes[id] = nodes[id] || {
  id, style: {}, className: '', textContent: '', innerHTML: '', dataset: {},
  addEventListener() {}, appendChild() {}, animate() {},
});
globalThis.Image = class {};
globalThis.document = { getElementById: node };
globalThis.performance = { now: () => 0 };

const ui = await import('../.mirror/ui.mjs');

// The tiers, the prices and the film curve are all lifted out of src/index.js
// rather than copied. They were copied, and then the balance pass moved every
// one of them; a suite that carries its own numbers checks that the shop renders
// *something*, not that it renders the game.
const SRC = await (await import('fs')).promises.readFile(
  new URL('../../src/index.js', import.meta.url), 'utf8');
const lift = (re, what) => {
  const m = re.exec(SRC);
  if (!m) throw new Error('shop.mjs could not lift ' + what + ' out of src/index.js');
  return m[1];
};
const cfg = (0, eval)('(' + lift(/export const CONFIG = (\{[\s\S]*?\n\});/, 'CONFIG') + ')');
// The first zoom rung is free -- everyone starts standing on it -- so p[0] is a
// price nobody pays and that ladder is one longer than the money.
const LADDERS = ((C) =>
  eval(lift(/const LADDERS = (\[[\s\S]*?\n\]);/, 'LADDERS').replace(/CONFIG\./g, 'C.')))(cfg);
// The quota curve itself, lifted whole rather than reconstructed from a power.
// It was reconstructed once, and when the shape changed the pattern quietly
// stopped matching and left this suite checking a curve the game no longer had.
const goalSrc = lift(/^(const GOAL = .+\nconst goal = .+)$/m, 'goal()');
const goal = new Function('n', goalSrc + ';return goal(n)');
// The prices these checks quote all come off the lifted ladders. Spelling them
// out is what made thirteen of them fail the moment the balance pass landed.
const L = Object.fromEntries(LADDERS.map((l) => [l[0], { v: l[1], p: l[2] }]));
const P = (name, tier) => '$' + L[name].p[tier];
// `ok` mirrors index.js: affordability is not just the price. With an empty
// roll an upgrade has to leave a frame's worth in the bank, or the shop sells
// you into the dead end -- nothing to shoot and no way to buy anything to shoot.
// Mirrors index.js: every ladder is simply "can I cover the price" now. The
// reserve that used to sit here -- with an empty roll, an upgrade had to leave a
// frame's worth behind -- went with the film economy.
const offersFor = (st) => LADDERS.map(([label, v, p, key, sfx]) => ({
  legend: label, v, p, sfx, at: st[key], price: p[st[key]],
  ok: st.bank >= p[st[key]],
}));

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(54),
              ok ? '' : '-> ' + JSON.stringify(got));
};

const render = (st, onPhotos) => {
  // `rides` is the level, and so the quota the screen has to quote: without a
  // default the curve is handed undefined and the line reads "$NaN".
  const state = { bank: 2140, film: 8, rides: 0,
                  mz: 1, rs: 0, sh: 0, ...st };
  ui.showShop(state, cfg, offersFor(state), () => {}, () => {}, () => {},
              goal(state.rides), onPhotos);
  return nodes.card.innerHTML;
};

// --- a mid-run kit: the ladders must show where you are ---
const mid = render({ mz: 2, rs: 1, sh: 1 });
const text = mid.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('        ' + text.slice(0, 220) + '\n');

// Named for the effect rather than the part: the wait between frames is the
// `flash` recycling, a word the payload already carries as an element id, where
// `shutter` was seven characters the packer had never seen.
check('the ladders are named', text,
      (t) => /zoom/.test(t) && /dpi/.test(t) && /flash/.test(t));
check('the recovery ladder is a time', text, (t) => /0\.5s/.test(t));
// The cart ran at a tier you bought until levels became fixed things to learn,
// and a cart that ran them at a different speed each run worked against that.
check('the cart ladder is gone', text, (t) => !/speed|m\/s|cart/.test(t));
// No header row: it measured 35 bytes, and the columns read without one.
check('the table carries no header row', mid, (h) => !/current|Upgrade/.test(h));

// --- three columns: name, what you own, the one rung you can buy ---
// Bold, not green: .p is the gain colour, and where you stand on a ladder is
// not a win. It stays off every rung on this screen, film's included.
check('the rung you are standing on is shown', mid,
      (h) => h.includes('<b>' + L.zoom.v[2] + '×</b>'));
check('and the sensor reads as its score rate', mid, (h) => /<b>1500<\/b>/.test(h));
check('and no rung is coloured as a gain', mid, (h) => !/class="p"/.test(h));
check('the next rung is a button carrying its own price', mid,
      (h) => h.includes('<button data-i="0">' + L.zoom.v[3] + '× ' + P('zoom', 2) + '</button>'));
check('and the sensor button too', mid,
      (h) => h.includes('<button data-i="1" disabled>' + L.dpi.v[2] + ' ' + P('dpi', 1) + '</button>'));
// The whole point of three columns: tiers you cannot reach yet are not drawn.
check('rungs beyond the next are not on screen at all', mid,
      (h) => !h.includes(L.zoom.v[4] + '×'));
check('nor their prices', mid, (h) => !h.includes(P('dpi', 2)));
// A ragged row ends early and its rule stops short of the table edge instead of
// dividing the whole row, so every row -- film included -- must be the same
// width, however many buttons the last cell is carrying.
check('the table is three columns all the way down', mid, (h) => {
  const cells = [...h.matchAll(/<tr class="r">([\s\S]*?)<\/tr>/g)]
    .map((m) => (m[1].match(/<td/g) || []).length);
  console.log('        rows x cells: ' + cells.join(' '));
  return cells.length === LADDERS.length && new Set(cells).size === 1 && cells[0] === 3;
});

// --- the quota is asked on the briefing, not here --------------------------
// The briefing card comes between this screen and the cart, so saying it in both
// places was saying it twice -- and moving the string rather than copying it is
// what kept that card near free. See the briefing checks in lobby.mjs.
check('the shop does not ask for the quota', mid,
      (h) => !h.includes('this ride'));
const later = render({ rides: 4 });
check('the level still reaches the curve', goal(4) > goal(0), true);
check('and the shop itself is unchanged by it', later,
      (h) => h.includes(L.zoom.v[2] + '\u00d7 ' + P('zoom', 1) + '</button>'));

check('one button per ladder, and nothing else',
      (mid.match(/data-i="\d"/g) || []).length, LADDERS.length);
check('the header is the bank', mid, (h) => /<h2>\$2140<\/h2>/.test(h));

// --- the way back to the roll --------------------------------------------
// The roll only exists on the page load that shot it, so index.js hands over a
// handler only when there is one to go back to. No handler, no button: a Photos
// button opening an empty table is worse than no button at all.
let back = 0;
const withRoll = render({}, () => { back = 1; });
check('a shop opened off a ride offers the way back to the roll',
      withRoll, (h) => h.includes('<button id="s">Photos</button>'));
nodes.card.onclick({ target: { closest: (q) => (q === 'button' ? { id: 's', dataset: {} } : null) },
                     stopPropagation() {} });
check('and the button is wired to it', back, 1);
check('a shop opened with no roll offers none',
      render({}), (h) => !h.includes('id="s"'));

// --- affordability ---
const broke = render({ bank: 0, mz: 2, rs: 1, sh: 1 });
check('every button is disabled when the bank is empty',
      (broke.match(/<button data-i="\d+" disabled>/g) || []).length,
      (broke.match(/<button data-i="\d+"/g) || []).length);
const rich = render({ bank: 99999 });
check('nothing is disabled when the bank is full', rich, (h) => !/data-i="\d+" disabled/.test(h));

// --- the ride is always offered -----------------------------------------
// Two whole sections used to live here: an empty roll could not be ridden, and
// the shop had to reserve a frame's worth of the bank so it could not sell you
// into a dead end with nothing to shoot and no way to buy anything to shoot
// with. Film refills to eight every ride now, so neither dead end exists and
// neither rule has anything left to guard.
const skint = render({ bank: 0 });
check('a ride is offered however empty the bank', skint, (h) => !/id="e" disabled/.test(h));
check('and nothing tells the player they are stuck', skint, (h) => !/class="h m"/.test(h));
// The reserve is gone with it: your money is your own, down to the last dollar.
const exact = render({ bank: L.zoom.p[1], rs: 0, sh: 0 });
check('a lens priced at the whole bank is still on sale', exact,
      (h) => /data-i="0"(?! disabled)/.test(h));

// --- a maxed ladder must not offer anything ---
const top = L.zoom.p.length;   // the rung past the last price is the top one
const maxed = render({ mz: top, rs: 3, sh: 3, bank: 99999 });
check('a maxed ladder has no button at all', maxed, (h) => !/data-i="[012]"/.test(h));
check('and reads as standing on its top rung', maxed,
      (h) => h.includes('<b>' + L.zoom.v[top] + '\u00d7</b>') &&
             h.includes('<b>' + L.dpi.v[3] + '</b>'));
// Every ladder maxed is now the end of the shop: there is nothing left to buy at
// all, which film used to stop from ever happening.
check('and with every ladder maxed nothing is on sale', maxed,
      (h) => !/data-i="\d"(?! disabled)/.test(h));

// --- clicking ---
let bought = null, rode = false, menued = false;
const state = { bank: 2140, film: 8, rides: 0,
                mz: 2, rs: 0, sh: 0 };
ui.showShop(state, cfg, offersFor(state), (i) => { bought = i; },
            () => { rode = true; }, () => { menued = true; }, goal(0));
const click = (attrs) => nodes.card.onclick({
  target: { closest: (q) => (q === 'button' ? attrs : null) }, stopPropagation() {} });
click({ dataset: { i: '2' } });
check('clicking a rung buys that ladder', bought, 2);
click({ dataset: { i: '4' } });
check('clicking a film quantity buys through the same handler', bought, 4);
click({ id: 'e', dataset: {} });
check('ride again still fires', rode, true);
// Wiping the save moved to the menu, so the shop's second button is the way
// back to it and nothing else.
click({ id: 'mp', dataset: {} });
check('main menu still fires', menued, true);
check('and the shop no longer offers to wipe the save',
      nodes.card.innerHTML.includes('restart'), false);

// --- where solo() sends you ----------------------------------------------
// Lifted out of src/index.js the way the pointer suite lifts primary(), so this
// cannot drift from what ships. It used to have a third case, for a roll with no
// frames in it; a ride always starts with eight now, so it could not be reached.
import fs from 'fs';
import { fileURLToPath } from 'url';
const src = fs.readFileSync(fileURLToPath(new URL('../../src/index.js', import.meta.url)), 'utf8');
const soloSrc = /^(const solo = .+)$/m.exec(src);
check('solo() is still there to test', !!soloSrc, true);
const runSolo = (distance) => {
  const went = [];
  new Function('distance', 'ride', 'brief',
               soloSrc[1] + ';solo()')(
    distance, () => went.push('ride'), () => went.push('brief'));
  return went[0];
};
// A fresh boot briefs where it stands rather than paying for a second worldgen;
// the click that dismisses the briefing is what starts the cart.
check('a fresh boot briefs where it stands', runSolo(0), 'brief');
check('and a world already ridden reloads into a fresh one', runSolo(800), 'ride');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
