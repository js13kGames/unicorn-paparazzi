import { COLOR_NAMES } from './unicorn.js';

const $ = (id) => document.getElementById(id);
const el = { hud: $('hud'), film: $('film'), zoom: $('zoom'), bar: $('bar'),
             flash: $('flash'), panel: $('panel'), card: $('card'), vf: $('vf') };

export function setChrome(visible) {
  el.vf.style.display = visible ? '' : 'none';
  el.film.style.display = visible ? '' : 'none';
  el.zoom.style.display = visible ? '' : 'none';
}

export function updateHud(state, cfg, lap) {
  el.bar.style.width = (Math.min(1, lap) * 100).toFixed(1) + '%';
  el.hud.textContent = 'lap ' + Math.floor(Math.min(1, lap) * 100) + '%';
  el.film.innerHTML = '<b>' + state.film + '</b> film';
  el.film.className = 'sh' + (state.film <= 3 ? ' low' : '');
  const z = cfg.zoomLevels[state.zoom];
  el.zoom.textContent = cfg.resNames[state.res] + '  ·  ' + z + '×' +
    (state.maxZoom > 0 ? '  (wheel to zoom)' : '');
}

export function flash() {
  el.flash.className = '';
  // Force a reflow so the transition restarts even on rapid shots.
  void el.flash.offsetWidth;
  el.flash.className = 'on';
}

function panel(html) {
  el.card.innerHTML = html;
  el.panel.className = 'on';
}

export function hidePanel() {
  el.panel.className = '';
}

export function showTitle(cfg) {
  panel(
    '<h1>UNICORN SNAP</h1>' +
    '<h2>Photograph the herds from the cart</h2>' +
    '<ul>' +
    '<li>Move the mouse to look around — the cart drives itself</li>' +
    '<li>Click or press Space to take a photograph</li>' +
    '<li>You have ' + cfg.startFilm + ' shots and one lap of the track</li>' +
    '<li>Bigger, rarer, better-framed unicorns score more</li>' +
    '<li>Get all six colours in one frame to win</li>' +
    '</ul>' +
    '<p class="hint">Click anywhere to begin.</p>'
  );
}

const sign = (n) => (n > 0 ? '+' : '') + n;
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim');

// One photo at a time, so the player can see why each shot earned what it did.
export function showPhoto(scored, index, count, running) {
  let rows = '';
  if (!scored.subjects.length) {
    rows = '<tr><td colspan="2" class="dim">No unicorns in frame.</td></tr>';
  }
  for (const s of scored.subjects) {
    rows +=
      '<tr class="rule"><td><b>' + s.colour + (s.adult ? '' : ' foal') + '</b> ' +
      '<span class="dim">' + s.poseName + ' · ' +
      (s.coverage * 100).toFixed(1) + '% of frame</span></td>' +
      '<td class="n"><b>' + Math.round(s.subtotal) + '</b></td></tr>' +
      row('size', s.size) + row('pose', s.pose) +
      (s.crop ? row('cropped by edge', s.crop) : '') +
      (s.baby ? row('foal bonus', s.baby) : '');
  }
  let bon = '';
  for (const b of scored.bonuses) {
    bon += '<tr><td class="' + (b.rainbow ? 'pos' : '') + '">' + b.label +
      '</td><td class="n pos">×' + b.factor + '</td></tr>';
  }
  panel(
    '<h1>PHOTO ' + (index + 1) + ' / ' + count + '</h1>' +
    '<h2>Bank ' + running + '</h2>' +
    '<img src="' + scored.url + '" alt="">' +
    '<table>' + rows +
    '<tr class="rule"><td>composition</td><td class="n">' + sign(scored.composition) + '</td></tr>' +
    bon +
    '<tr class="rule big"><td><b>photo total</b></td><td class="n"><b>' +
    scored.total + '</b></td></tr></table>' +
    '<p class="hint">Click or press Space for the next photo.</p>'
  );
}

function row(label, n) {
  return '<tr><td class="dim">&nbsp;&nbsp;' + label + '</td><td class="n ' + cls(n) + '">' +
    sign(Math.round(n)) + '</td></tr>';
}

export function showSummary(state, reason, best) {
  let b = '';
  if (best) {
    b = '<img src="' + best.url + '" alt=""><p class="dim">Best shot: ' + best.total + '</p>';
  }
  panel(
    '<h1>' + (state.won ? 'RAINBOW! YOU WIN' : 'ROLL DEVELOPED') + '</h1>' +
    '<h2>' + reason + '</h2>' + b +
    '<table><tr><td>photographs taken</td><td class="n">' + state.photos.length + '</td></tr>' +
    '<tr><td>unicorns catalogued</td><td class="n">' + state.catalogued.size + ' / 6</td></tr>' +
    '<tr class="rule big"><td><b>bank</b></td><td class="n"><b>' + state.bank +
    '</b></td></tr></table>' +
    '<p class="hint">The photography shop opens in step 4. Reload for a new map.</p>'
  );
}

export { COLOR_NAMES };
