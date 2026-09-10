// The shop used to show only the next rung of each upgrade, so nothing on the
// screen ever said what camera you were carrying. It now draws each ladder in
// full. These checks pin what the player can actually read and click.
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
  zoomLevels: [1, 2, 4, 8, 16], resNames: ['low', 'med', 'high', 'ultra'],
  shutterTiers: [0.8, 0.55, 0.35, 0.2],
};

// The same shape src/index.js offers() builds, without booting the game.
const LADDERS = [
  ['zoom', cfg.zoomLevels, [400, 900, 1800, 3200], 'maxZoom', '×'],
  ['photo', cfg.resNames, [500, 1200, 2600], 'res', ''],
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

check('every zoom tier is on screen', text, (t) => cfg.zoomLevels.every((v) => t.includes(v + '×')));
check('every sensor tier is on screen', text, (t) => cfg.resNames.every((v) => t.includes(' ' + v + ' ')));
check('the ladders are named', text, (t) => /zoom/.test(t) && /photo/.test(t) && /speed/.test(t));

// --- film is a stock, not a ladder ---
// It buys frames at a flat price rather than climbing tiers, so it sits in the
// footer with the stock you are holding rather than in the ladder table.
check('the shop says how much film you are holding', text, (t) => / Film 12 /.test(t));
check('a single frame is offered at its price', mid, (h) => /\$100 <button[^>]*>\+1<\/button>/.test(h));
check('and ten frames at ten times it', mid, (h) => /\$1000 <button[^>]*>\+10<\/button>/.test(h));
check('film is not a ladder row', mid, (h) => !/<td class="d">[Ff]ilm<\/td>/.test(h));

// Owned tiers read as owned; the rung above is the only button on that row.
check('tiers you own are marked', mid, (h) => /<b class="p">2×<\/b>/.test(h));
check('the tier below the current one is also owned', mid, (h) => /<b class="p">1×<\/b>/.test(h));
check('the next rung is a button', mid, (h) => /<button data-i="0"[^>]*>4×<\/button>/.test(h));
check('rungs beyond the next are not buttons', mid, (h) => /<span class="w">8×<\/span>/.test(h));
check('one button per ladder, plus the two film quantities',
      (mid.match(/data-i="\d"/g) || []).length, 5);

// Prices sit above every rung you do not own yet, so a saving target is visible.
check('the next rung shows its price', mid, (h) => h.includes('>$900</small>'));
check('later rungs show their prices too', mid, (h) => h.includes('>$1800</small>') && h.includes('>$3200</small>'));
check('owned rungs show no price', mid, (h) => !/<small[^>]*>\$400<\/small>/.test(h));
// Money is marked as money everywhere it appears, so a price is never read as
// a tier value.
check('the bank is a dollar amount', mid, (h) => h.includes('<h2>$2140</h2>'));
check('no bare price survives anywhere', mid,
      (h) => !/<small class="w">\d/.test(h));

// Ladders are different lengths (5 zoom tiers, 4 sensors), so short rows have
// to be padded out: an unpadded row ends early and its rule stops short of the
// table edge instead of dividing the whole row.
{
  const cells = [...mid.matchAll(/<tr class="r g">([\s\S]*?)<\/tr>/g)]
    .map((m) => (m[1].match(/<td/g) || []).length);
  console.log('        cells per ladder row: ' + cells.join(' '));
  check('every ladder row is the same width', new Set(cells).size, 1);
  check('and that width is the widest ladder plus its name', cells[0], 6);
}

// --- affordability ---
const broke = render({ bank: 0, maxZoom: 1, res: 1, shutterTier: 1 });
check('every button is disabled when the bank is empty',
      (broke.match(/<button data-i="\d+" disabled>/g) || []).length,
      (broke.match(/<button data-i="\d+"/g) || []).length);
const rich = render({ bank: 99999 });
check('nothing is disabled when the bank is full', rich, (h) => !/data-i="\d+" disabled/.test(h));

// --- an empty roll must not be rideable ---
// Film used to refill for free, so a lap was always worth taking. Now a lap
// with nothing in the camera earns nothing and photographs nothing, and the
// shop is the only place that can say so.
const dry = render({ film: 0, bank: 500 });
check('an empty roll cannot be ridden', dry, (h) => /id="e" disabled/.test(h));
check('but can still be refilled, since the money is there', dry,
      (h) => /data-i="3"(?! disabled)/.test(h));
const loaded = render({ film: 1, bank: 0 });
check('and a single frame is enough to ride on', loaded, (h) => !/id="e" disabled/.test(h));

// --- a maxed ladder must not offer anything ---
const maxed = render({ maxZoom: 4, res: 3, shutterTier: 3, bank: 99999 });
check('a maxed ladder has no button at all', maxed, (h) => !/data-i="[012]"/.test(h));
check('and every one of its tiers reads as owned', maxed,
      (h) => cfg.resNames.every((v) => h.includes('<b class="p">' + v + '</b>')));
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

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
