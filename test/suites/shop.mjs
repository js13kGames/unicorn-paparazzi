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
  filmTiers: [15, 20, 30, 40, 50], shutterTiers: [0.8, 0.55, 0.35, 0.2],
};

// The same shape src/index.js offers() builds, without booting the game.
const LADDERS = [
  ['zoom', cfg.zoomLevels, [400, 900, 1800, 3200], 'maxZoom', '×'],
  ['photo', cfg.resNames, [500, 1200, 2600], 'res', ''],
  ['film', cfg.filmTiers, [300, 700, 1400, 2400], 'filmTier', ''],
  ['speed', cfg.shutterTiers, [250, 700, 1600], 'shutterTier', 's'],
];
const offersFor = (st) => LADDERS.map(([label, v, p, key, sfx]) => ({
  label, v, p, sfx, at: st[key], price: p[st[key]],
}));

let fails = 0;
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(54),
              ok ? '' : '-> ' + JSON.stringify(got));
};

const render = (st) => {
  const state = { bank: 2140,
                  maxZoom: 0, res: 0, filmTier: 0, shutterTier: 0, ...st };
  ui.showShop(state, cfg, offersFor(state), () => {}, () => {}, () => {});
  return nodes.card.innerHTML;
};

// --- a mid-run kit: the ladders must show where you are ---
const mid = render({ maxZoom: 1, res: 1, filmTier: 1, shutterTier: 1 });
const text = mid.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('        ' + text.slice(0, 220) + '\n');

check('every zoom tier is on screen', text, (t) => cfg.zoomLevels.every((v) => t.includes(v + '×')));
check('every sensor tier is on screen', text, (t) => cfg.resNames.every((v) => t.includes(' ' + v + ' ')));
check('every film tier is on screen', text, (t) => cfg.filmTiers.every((v) => t.includes(' ' + v + ' ')));
check('the ladders are named', text, (t) => /zoom/.test(t) && /photo/.test(t) && /film/.test(t) && /speed/.test(t));

// Owned tiers read as owned; the rung above is the only button on that row.
check('tiers you own are marked', mid, (h) => /<b class="pos">2×<\/b>/.test(h));
check('the tier below the current one is also owned', mid, (h) => /<b class="pos">1×<\/b>/.test(h));
check('the next rung is a button', mid, (h) => /<button data-i="0"[^>]*>4×<\/button>/.test(h));
check('rungs beyond the next are not buttons', mid, (h) => /<span class="wk">8×<\/span>/.test(h));
check('one button per ladder', (mid.match(/data-i="[0-3]"/g) || []).length, 4);

// Prices sit above every rung you do not own yet, so a saving target is visible.
check('the next rung shows its price', mid, (h) => h.includes('>900</small>'));
check('later rungs show their prices too', mid, (h) => h.includes('>1800</small>') && h.includes('>3200</small>'));
check('owned rungs show no price', mid, (h) => !/<small[^>]*>400<\/small>/.test(h));

// Ladders are different lengths (5 zoom tiers, 4 sensors), so short rows have
// to be padded out: an unpadded row ends early and its rule stops short of the
// table edge instead of dividing the whole row.
{
  const cells = [...mid.matchAll(/<tr class="rule g">([\s\S]*?)<\/tr>/g)]
    .map((m) => (m[1].match(/<td/g) || []).length);
  console.log('        cells per ladder row: ' + cells.join(' '));
  check('every ladder row is the same width', new Set(cells).size, 1);
  check('and that width is the widest ladder plus its name', cells[0], 6);
}

// --- affordability ---
const broke = render({ bank: 0, maxZoom: 1, res: 1, filmTier: 1, shutterTier: 1 });
check('every button is disabled when the bank is empty',
      (broke.match(/<button data-i="\d+" disabled>/g) || []).length,
      (broke.match(/<button data-i="\d+"/g) || []).length);
const rich = render({ bank: 99999 });
check('nothing is disabled when the bank is full', rich, (h) => !/data-i="\d+" disabled/.test(h));

// --- a maxed ladder must not offer anything ---
const maxed = render({ maxZoom: 4, res: 3, filmTier: 4, shutterTier: 3, bank: 99999 });
check('a maxed ladder has no button at all', maxed, (h) => !/data-i="[0-3]"/.test(h));
check('and every one of its tiers reads as owned', maxed,
      (h) => cfg.resNames.every((v) => h.includes('<b class="pos">' + v + '</b>')));
check('a maxed shop offers nothing at all', maxed, (h) => !/data-i=/.test(h));

// --- clicking ---
let bought = null, rode = false, restarted = false;
const state = { bank: 2140,
                maxZoom: 1, res: 0, filmTier: 0, shutterTier: 0 };
ui.showShop(state, cfg, offersFor(state), (i) => { bought = i; },
            () => { rode = true; }, () => { restarted = true; });
const click = (attrs) => nodes.card.onclick({
  target: { closest: (q) => (q === 'button' ? attrs : null) }, stopPropagation() {} });
click({ dataset: { i: '2' } });
check('clicking a rung buys that ladder', bought, 2);
click({ id: 'ride', dataset: {} });
check('ride again still fires', rode, true);
click({ id: 'restart', dataset: {} });
check('start over still fires', restarted, true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
