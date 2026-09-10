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

const cfg = {
  // The sensor tiers ARE their score rates now, written `1000dpi` -- the same
  // number the breakdown's size row charges against.
  zoomLevels: [1, 2, 4, 8, 16], resBonus: [1000, 1500, 3000, 6000],
  shutterTiers: [0.8, 0.55, 0.35, 0.2],
};

// The same shape src/index.js offers() builds, without booting the game.
const LADDERS = [
  ['zoom', cfg.zoomLevels, [400, 900, 1800, 3200], 'maxZoom', '×'],
  ['resolution', cfg.resBonus, [500, 1200, 2600], 'res', 'dpi'],
  ['speed', cfg.shutterTiers, [250, 700, 1600], 'shutterTier', 's'],
];
const FILM = 100;
const frames = (n) => ({ n, price: FILM * n });
const offersFor = (st) => [...LADDERS.map(([label, v, p, key, sfx]) => ({
  label, v, p, sfx, at: st[key], price: p[st[key]],
})), frames(1), frames(10)];

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(54),
              ok ? '' : '-> ' + JSON.stringify(got));
};

const render = (st) => {
  const state = { bank: 2140, film: 12,
                  maxZoom: 0, res: 0, shutterTier: 0, ...st };
  ui.showShop(state, cfg, offersFor(state), () => {}, () => {}, () => {});
  return nodes.card.innerHTML;
};

// --- a mid-run kit: the ladders must show where you are ---
const mid = render({ maxZoom: 1, res: 1, shutterTier: 1 });
const text = mid.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('        ' + text.slice(0, 220) + '\n');

check('the ladders are named', text,
      (t) => /zoom/.test(t) && /resolution/.test(t) && /speed/.test(t));
// No header row: it measured 35 bytes, and the columns read without one.
check('the table carries no header row', mid, (h) => !/current|Upgrade/.test(h));

// --- three columns: name, what you own, the one rung you can buy ---
check('the rung you are standing on is shown', mid, (h) => /<b class="p">2×<\/b>/.test(h));
check('and the sensor reads as its score rate', mid, (h) => /<b class="p">1500dpi<\/b>/.test(h));
check('the next rung is a button carrying its own price', mid,
      (h) => /<button data-i="0"[^>]*>4× \$900<\/button>/.test(h));
check('and the sensor button too', mid,
      (h) => /<button data-i="1"[^>]*>3000dpi \$1200<\/button>/.test(h));
// The whole point of three columns: tiers you cannot reach yet are not drawn.
check('rungs beyond the next are not on screen at all', mid, (h) => !/8×/.test(h));
check('nor their prices', mid, (h) => !/1800/.test(h) && !/3200/.test(h));
// A ragged row ends early and its rule stops short of the table edge instead of
// dividing the whole row, so every ladder must be the same width.
check('the table is three columns all the way down', mid, (h) => {
  const cells = [...h.matchAll(/<tr class="r">([\s\S]*?)<\/tr>/g)]
    .map((m) => (m[1].match(/<td/g) || []).length);
  console.log('        cells per ladder row: ' + cells.join(' '));
  return cells.length === 3 && new Set(cells).size === 1 && cells[0] === 3;
});

// --- film is a stock, not a ladder ---
// It buys frames at a flat price rather than climbing tiers, so it sits in the
// footer with the stock you are holding rather than in the ladder table.
check('the shop says how much film you are holding', text, (t) => / Film 12 /.test(t));
check('a single frame is offered at its price', mid, (h) => /\$100 <button[^>]*>\+1<\/button>/.test(h));
check('and ten frames at ten times it', mid, (h) => /\$1000 <button[^>]*>\+10<\/button>/.test(h));
check('film is not a ladder row', mid, (h) => !/<td class="d">[Ff]ilm<\/td>/.test(h));

check('one button per ladder, plus the two film quantities',
      (mid.match(/data-i="\d"/g) || []).length, 5);
// Money is marked as money everywhere it appears, so a price is never read as
// a tier value.
check('the bank and the roll are read together in the header', mid,
      (h) => /<h2>\$2140 · Film 12<\/h2>/.test(h));

// --- affordability ---
const broke = render({ bank: 0, maxZoom: 1, res: 1, shutterTier: 1 });
check('every button is disabled when the bank is empty',
      (broke.match(/<button data-i="\d+" disabled>/g) || []).length,
      (broke.match(/<button data-i="\d+"/g) || []).length);
const rich = render({ bank: 99999 });
check('nothing is disabled when the bank is full', rich, (h) => !/data-i="\d+" disabled/.test(h));

// --- an empty roll must not be rideable ---
// Film used to refill for free, so a ride was always worth taking. Now a ride
// with nothing in the camera earns nothing and photographs nothing, and the
// shop is the only place that can say so.
const dry = render({ film: 0, bank: 500 });
check('an empty roll cannot be ridden', dry, (h) => /id="e" disabled/.test(h));
// A greyed-out button with no reason on it is a dead end the player has to guess
// at, so the reason sits under both buttons in the loss colour.
check('and a line under the buttons says why', dry, (h) => /class="h m">no film</.test(h));
check('but can still be refilled, since the money is there', dry,
      (h) => /data-i="3"(?! disabled)/.test(h));
const loaded = render({ film: 1, bank: 0 });
check('and a single frame is enough to ride on', loaded, (h) => !/id="e" disabled/.test(h));
check('and then nothing says otherwise', loaded, (h) => !/no film/.test(h));

// --- a maxed ladder must not offer anything ---
const maxed = render({ maxZoom: 4, res: 3, shutterTier: 3, bank: 99999 });
check('a maxed ladder has no button at all', maxed, (h) => !/data-i="[012]"/.test(h));
check('and reads as standing on its top rung', maxed,
      (h) => h.includes('<b class="p">16×</b>') && h.includes('<b class="p">6000dpi</b>'));
// Film has no top: there is always more to buy, which is what stops a fully
// upgraded player being unable to spend their way out of an empty roll.
check('but film is still on sale when every ladder is maxed', maxed,
      (h) => /data-i="3"/.test(h) && /data-i="4"/.test(h));

// --- clicking ---
let bought = null, rode = false, menued = false;
const state = { bank: 2140, film: 12,
                maxZoom: 1, res: 0, shutterTier: 0 };
ui.showShop(state, cfg, offersFor(state), (i) => { bought = i; },
            () => { rode = true; }, () => { menued = true; });
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

// --- an empty roll never starts a ride ------------------------------------
// solo() is lifted out of src/index.js the way the pointer suite lifts
// primary(), so this cannot drift from what ships.
import fs from 'fs';
import { fileURLToPath } from 'url';
const src = fs.readFileSync(fileURLToPath(new URL('../../src/index.js', import.meta.url)), 'utf8');
const soloBody = /function solo\(\) \{\n([\s\S]*?)\n\}/.exec(src);
check('solo() is still there to test', !!soloBody, true);
const runSolo = (film, distance) => {
  const went = [];
  new Function('state', 'distance', 'showShop', 'ride', 'primary', soloBody[1])(
    { film }, distance,
    () => went.push('shop'), () => went.push('ride'), () => went.push('start'));
  return went[0];
};
check('an empty roll goes straight to the shop', runSolo(0, 0), 'shop');
check('and does so even after a ride has been ridden', runSolo(0, 800), 'shop');
check('film in hand still starts where it stands', runSolo(6, 0), 'start');
check('and still reloads into a fresh world once the cart has moved', runSolo(6, 800), 'ride');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
