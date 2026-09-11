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
  // The first zoom rung is free -- everyone starts standing on 1.2x -- so p[0]
  // is a price nobody pays and the ladder is one longer than the money.
  zoomLevels: [1, 1.2, 2, 4, 8, 16], resBonus: [1000, 1500, 3000, 6000],
  shutterTiers: [0.8, 0.55, 0.35, 0.2],
  cartTiers: [8, 10, 13, 17],
};

// The same shape src/index.js offers() builds, without booting the game.
const LADDERS = [
  ['zoom', cfg.zoomLevels, [0, 400, 900, 1800, 3200], 'maxZoom', '×'],
  ['dpi', cfg.resBonus, [500, 1200, 2600], 'res', ''],
  ['speed', cfg.shutterTiers, [250, 700, 1600], 'shutterTier', 's'],
  ['cart', cfg.cartTiers, [400, 1000, 2200], 'cartTier', ''],
];
const FILM = 100;
// Film is appended after the ladders, so its button index is however many
// ladders there are. Derived, because spelling it out is what broke these
// checks when the cart ladder arrived.
const FILM_I = LADDERS.length;
// Mirrors index.js price(): a frame costs a hundred dollars per ride taken, and
// `|| 1` keeps the very first shop visit from handing out free film.
const price = (st) => FILM * (st.rides || 1);
const frames = (st) => ({ price: price(st), ok: st.bank >= price(st) });
// `ok` mirrors index.js: affordability is not just the price. With an empty
// roll an upgrade has to leave a frame's worth in the bank, or the shop sells
// you into the dead end -- nothing to shoot and no way to buy anything to shoot.
const offersFor = (st) => {
  const keep = st.film ? 0 : price(st);
  return [...LADDERS.map(([label, v, p, key, sfx]) => ({
    label, v, p, sfx, at: st[key], price: p[st[key]],
    ok: st.bank - p[st[key]] >= keep,
  })), frames(st)];
};

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(54),
              ok ? '' : '-> ' + JSON.stringify(got));
};

const render = (st) => {
  const state = { bank: 2140, film: 12,
                  maxZoom: 1, res: 0, shutterTier: 0, cartTier: 0, ...st };
  ui.showShop(state, cfg, offersFor(state), () => {}, () => {}, () => {});
  return nodes.card.innerHTML;
};

// --- a mid-run kit: the ladders must show where you are ---
const mid = render({ maxZoom: 2, res: 1, shutterTier: 1 });
const text = mid.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('        ' + text.slice(0, 220) + '\n');

check('the ladders are named', text,
      (t) => /zoom/.test(t) && /dpi/.test(t) && /speed/.test(t) && /cart/.test(t));
// No header row: it measured 35 bytes, and the columns read without one.
check('the table carries no header row', mid, (h) => !/current|Upgrade/.test(h));

// --- three columns: name, what you own, the one rung you can buy ---
// Bold, not green: .p is the gain colour, and where you stand on a ladder is
// not a win. It stays off every rung on this screen, film's included.
check('the rung you are standing on is shown', mid, (h) => /<b>2×<\/b>/.test(h));
check('and the sensor reads as its score rate', mid, (h) => /<b>1500<\/b>/.test(h));
check('and no rung is coloured as a gain', mid, (h) => !/class="p"/.test(h));
check('the next rung is a button carrying its own price', mid,
      (h) => /<button data-i="0"[^>]*>4× \$900<\/button>/.test(h));
check('and the sensor button too', mid,
      (h) => /<button data-i="1"[^>]*>3000 \$1200<\/button>/.test(h));
// The whole point of three columns: tiers you cannot reach yet are not drawn.
check('rungs beyond the next are not on screen at all', mid, (h) => !/8×/.test(h));
check('nor their prices', mid, (h) => !/1800/.test(h) && !/3200/.test(h));
// A ragged row ends early and its rule stops short of the table edge instead of
// dividing the whole row, so every row -- film included -- must be the same
// width, however many buttons the last cell is carrying.
check('the table is three columns all the way down', mid, (h) => {
  const cells = [...h.matchAll(/<tr class="r">([\s\S]*?)<\/tr>/g)]
    .map((m) => (m[1].match(/<td/g) || []).length);
  console.log('        rows x cells: ' + cells.join(' '));
  return cells.length === 5 && new Set(cells).size === 1 && cells[0] === 3;
});

// --- film is a stock, but it is still a row ---
// It buys frames at a flat price rather than climbing tiers, so its last cell
// holds both quantities instead of one next rung -- but it reads down the same
// three columns as the ladders: what it is, what you hold, what you can buy.
check('film is a row like the rest', mid, (h) => /<td class="d">film<\/td>/.test(h));
check('the shop says how much film you are holding', mid,
      (h) => /<td class="d">film<\/td><td class="n"><b>12<\/b>/.test(h));
check('a single frame is offered at its price', mid, (h) => /<button[^>]*>\+1 \$100<\/button>/.test(h));
// One quantity, since the price climbs: a bulk button with no bulk discount was
// a four-figure control that spent most of the game greyed out.
check('film is sold one frame at a time', mid,
      (h) => (h.match(/\+1 \$/g) || []).length === 1);
// The price is the ride count, and the shop is where the player finds that out:
// the buttons are the only place the rise is ever stated.
const later = render({ bank: 9000, rides: 4 });
check('a later ride quotes a dearer frame', later,
      (h) => /<button[^>]*>\+1 \$400<\/button>/.test(h));
check('and nothing else on the screen moved', later,
      (h) => /2× \$400<\/button>/.test(h));
// A rise the player cannot cover is where the run actually ends, and a greyed
// button with the price still on it is what says so.
const dear = render({ bank: 150, film: 0, rides: 4 });
check('a frame beyond the bank is offered but disabled', dear,
      (h) => /<button[^>]*disabled[^>]*>\+1 \$400<\/button>/.test(h));

check('one button per ladder, plus the one film quantity',
      (mid.match(/data-i="\d"/g) || []).length, FILM_I + 1);
// Money is marked as money everywhere it appears, so a price is never read as
// a tier value.
check('the header is the bank alone, since film has its own row', mid,
      (h) => /<h2>\$2140<\/h2>/.test(h));

// --- affordability ---
const broke = render({ bank: 0, maxZoom: 2, res: 1, shutterTier: 1 });
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
// at, so the reason sits under both buttons in the loss color.
check('and a line under the buttons says why', dry, (h) => /class="h m">no film</.test(h));
check('but can still be refilled, since the money is there', dry,
      (h) => new RegExp('data-i="' + FILM_I + '"(?! disabled)').test(h));
const loaded = render({ film: 1, bank: 0 });
check('and a single frame is enough to ride on', loaded, (h) => !/id="e" disabled/.test(h));
check('and then nothing says otherwise', loaded, (h) => !/no film/.test(h));

// --- the last frame's worth is not spendable ------------------------------
// The dead end the shop used to sell you: an empty roll, just enough money for
// a frame, and a lens on the shelf priced to take all of it. Buying the lens
// left nothing to photograph and nothing to buy film with, and the only screen
// left was the one that says you have lost.
const corner = render({ film: 0, bank: 450, res: 0, shutterTier: 0 });
check('with no film, an upgrade that eats the last frame is refused', corner,
      (h) => /data-i="0" disabled/.test(h));
// It reserves a frame, it does not freeze the bank: at $450 the $250 motor
// drive still leaves $200, which is two rides' worth of film.
check('while one that leaves a frame behind is still on sale', corner,
      (h) => /data-i="2"(?! disabled)/.test(h));
check('but film itself is always on sale -- it is the way out', corner,
      (h) => new RegExp('data-i="' + FILM_I + '"(?! disabled)').test(h));
// Exactly a frame's worth left over is fine: the rule reserves one frame, not
// one frame and a margin.
const exact = render({ film: 0, bank: 500, res: 0, shutterTier: 0 });
check('leaving exactly one frame in the bank is allowed', exact,
      (h) => /data-i="0"(?! disabled)/.test(h));
// And with a roll in the camera the reserve lifts -- your money is your own.
const stocked = render({ film: 1, bank: 450, res: 0, shutterTier: 0 });
check('with film in hand you may spend to the last dollar', stocked,
      (h) => /data-i="0"(?! disabled)/.test(h));

// --- a maxed ladder must not offer anything ---
const maxed = render({ maxZoom: 5, res: 3, shutterTier: 3, cartTier: 3, bank: 99999 });
check('a maxed ladder has no button at all', maxed, (h) => !/data-i="[012]"/.test(h));
check('and reads as standing on its top rung', maxed,
      (h) => h.includes('<b>16×</b>') && h.includes('<b>6000</b>'));
// Film has no top: there is always more to buy, which is what stops a fully
// upgraded player being unable to spend their way out of an empty roll.
check('but film is still on sale when every ladder is maxed', maxed,
      (h) => new RegExp('data-i="' + FILM_I + '"').test(h));

// --- clicking ---
let bought = null, rode = false, menued = false;
const state = { bank: 2140, film: 12,
                maxZoom: 2, res: 0, shutterTier: 0 };
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
