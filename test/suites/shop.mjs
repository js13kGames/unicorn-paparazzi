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
const FILM = +lift(/const FILM = (\d+);/, 'FILM');
// The curve itself, lifted whole rather than reconstructed from a power. It was
// reconstructed, and when the shape changed the pattern quietly stopped matching
// and left this suite checking a curve the game no longer had.
const priceSrc = lift(/^(const price = .+)$/m, 'price()');
// Film is appended after the ladders, so its button index is however many
// ladders there are. Derived, because spelling it out is what broke these
// checks when the cart ladder arrived.
const FILM_I = LADDERS.length;
// index.js's own price(), run against a stubbed state -- so film gets dearer
// here in exactly the way it does in the game, whatever shape that is.
const priceOf = new Function('state', 'FILM', priceSrc + ';return price()');
const price = (st) => priceOf(st, FILM);
const frames = (st) => ({ price: price(st), ok: st.bank >= price(st) });
// The prices these checks quote all come off the lifted ladders. Spelling them
// out is what made thirteen of them fail the moment the balance pass landed.
const L = Object.fromEntries(LADDERS.map((l) => [l[0], { v: l[1], p: l[2] }]));
const P = (name, tier) => '$' + L[name].p[tier];
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
  // `rides` is part of the state the shop prices film off, so it has a default
  // like every other field: without one the curve is handed undefined and the
  // film button reads "$NaN".
  const state = { bank: 2140, film: 12, rides: 0,
                  maxZoom: 1, res: 0, shutterTier: 0, cartTier: 0, ...st };
  ui.showShop(state, cfg, offersFor(state), () => {}, () => {}, () => {});
  return nodes.card.innerHTML;
};

// --- a mid-run kit: the ladders must show where you are ---
const mid = render({ maxZoom: 2, res: 1, shutterTier: 1 });
const text = mid.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('        ' + text.slice(0, 220) + '\n');

// Named for the part rather than the effect: `speed` used to be the shutter's
// and `cart` the drive train's, which told you which component you were buying
// and nothing about what it did. Now `speed` is the one the rider actually
// experiences -- in m/s, because a bare `13` could be a tier, a rank or a
// multiplier -- and the wait between frames is the `flash` recycling, a word the
// payload already carries as an element id.
check('the ladders are named', text,
      (t) => /zoom/.test(t) && /dpi/.test(t) && /flash/.test(t) && /speed/.test(t));
check('and the cart ladder is a speed with a unit on it', text, (t) => /8m\/s/.test(t));
check('while the recovery ladder is a time', text, (t) => /0\.5s/.test(t));
check('and nothing is called a cart any more', text, (t) => !/cart/.test(t));
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
  return cells.length === 5 && new Set(cells).size === 1 && cells[0] === 3;
});

// --- film is a stock, but it is still a row ---
// It buys frames at a flat price rather than climbing tiers, so its last cell
// holds both quantities instead of one next rung -- but it reads down the same
// three columns as the ladders: what it is, what you hold, what you can buy.
check('film is a row like the rest', mid, (h) => /<td class="d">film<\/td>/.test(h));
check('the shop says how much film you are holding', mid,
      (h) => /<td class="d">film<\/td><td class="n"><b>12<\/b>/.test(h));
check('a single frame is offered at its price', mid,
      (h) => h.includes('+1 $' + price({ rides: 0 }) + '</button>'));
// One quantity, since the price climbs: a bulk button with no bulk discount was
// a four-figure control that spent most of the game greyed out.
check('film is sold one frame at a time', mid,
      (h) => (h.match(/\+1 \$/g) || []).length === 1);
// The price is the ride count, and the shop is where the player finds that out:
// the buttons are the only place the rise is ever stated.
const later = render({ bank: price({ rides: 4 }) * 2, rides: 4 });
check('a later ride quotes a dearer frame', later,
      (h) => h.includes('+1 $' + price({ rides: 4 }) + '</button>'));
check('and it really is dearer than the first ride',
      price({ rides: 4 }) > price({ rides: 0 }), true);
check('and nothing else on the screen moved', later,
      (h) => h.includes(L.zoom.v[2] + '× ' + P('zoom', 1) + '</button>'));
// A rise the player cannot cover is where the run actually ends, and a greyed
// button with the price still on it is what says so.
// A pound short of the quoted price, derived rather than remembered: a bank
// spelled out here is a number that stops meaning "short" the moment the film
// curve is retuned, and quietly starts testing nothing.
const dear = render({ bank: price({ rides: 4 }) - 1, film: 0, rides: 4 });
check('a frame beyond the bank is offered but disabled', dear,
      (h) => h.includes('disabled>+1 $' + price({ rides: 4 }) + '</button>'));

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
// Enough for a frame and nothing else -- the money has to be measured against
// what a frame now costs, not against a remembered $500.
const dry = render({ film: 0, bank: price({ rides: 0 }) });
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
const FRAME = price({ rides: 0 });
const corner = render({ film: 0, bank: L.zoom.p[1] + FRAME - 1, res: 0, shutterTier: 0 });
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
const exact = render({ film: 0, bank: L.zoom.p[1] + FRAME, res: 0, shutterTier: 0 });
check('leaving exactly one frame in the bank is allowed', exact,
      (h) => /data-i="0"(?! disabled)/.test(h));
// And with a roll in the camera the reserve lifts -- your money is your own.
const stocked = render({ film: 1, bank: L.zoom.p[1], res: 0, shutterTier: 0 });
check('with film in hand you may spend to the last dollar', stocked,
      (h) => /data-i="0"(?! disabled)/.test(h));

// --- a maxed ladder must not offer anything ---
const top = L.zoom.p.length;   // the rung past the last price is the top one
const maxed = render({ maxZoom: top, res: 3, shutterTier: 3, cartTier: 3, bank: 99999 });
check('a maxed ladder has no button at all', maxed, (h) => !/data-i="[012]"/.test(h));
check('and reads as standing on its top rung', maxed,
      (h) => h.includes('<b>' + L.zoom.v[top] + '×</b>') &&
             h.includes('<b>' + L.dpi.v[3] + '</b>'));
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
