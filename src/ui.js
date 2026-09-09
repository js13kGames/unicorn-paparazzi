
const $ = (id) => document.getElementById(id);
const el = { hud: $('hud'), film: $('film'), bar: $('bar'),
             flash: $('flash'), panel: $('panel'), card: $('card'), vf: $('vf'),
             roll: $('roll'), belt: $('belt') };

// The roll of shots so far, newest nearest the counter. Column-reverse in CSS
// means appending puts the newest on top and older ones clip off the bottom.
export function addThumb(url) {
  const img = new Image();
  img.src = url;
  el.roll.appendChild(img);
}

export function setChrome(visible) {
  const d = visible ? '' : 'none';
  el.roll.style.display = d;
  el.vf.style.display = d;
  el.film.style.display = d;
  el.belt.style.display = visible ? 'flex' : 'none';
}

export function updateHud(state, cfg, lap, clock) {
  // The frame is the photograph now, so it outlines exactly what will be taken:
  // a fixed 16:9 rectangle, which needs its own inset on each axis.
  el.vf.style.inset = ((1 - state.fy) * 50).toFixed(1) + '% ' +
                      ((1 - state.fx) * 50).toFixed(1) + '%';
  el.bar.style.width = (Math.min(1, lap) * 100).toFixed(1) + '%';
  el.hud.textContent = 'lap ' + Math.floor(Math.min(1, lap) * 100) + '%' +
    (performance.now() < toastUntil ? '  ·  ' + el.hud.dataset.msg : '');
  el.film.innerHTML = '🎞 <b>' + state.film + '</b><br><small>' +
    (clock < state.ready ? '⏳' : state.photos.length + '/' + cfg.filmTiers[state.filmTier]) +
    '</small>';
  el.film.className = 'sh' + (state.film <= 3 ? ' low' : '');
  const z = cfg.zoomLevels[state.zoom];
  // The belt is the lure inventory: what you own, and the key that throws it.
  el.belt.innerHTML =
    slot(1, '🪝', state.weak) + slot(2, '🧲', state.strong) +
    '<i>🔍 ' + cfg.resNames[state.res] + ' ' + z + '×' +
    (state.maxZoom ? ' <b class="k">+</b><b class="k">-</b>' : '') + '</i>';
}

const slot = (key, icon, n) =>
  '<i class="' + (n ? '' : 'no') + '"><b class="k">' + key + '</b>' + icon + ' ' + n + '</i>';


let toastUntil = 0;
export function toast(msg) {
  el.hud.dataset.msg = msg;
  toastUntil = performance.now() + 2600;
}

export function flash() {
  // Web Animations, not a CSS class: reading offsetWidth restarts a transition
  // but not an animation, so the class-toggle version fired once and then sat at
  // "on" forever -- a white veil over the game after the first shot.
  el.flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
}

function panel(html, k) {
  el.card.className = k || '';
  el.card.innerHTML = html;
  el.panel.className = 'on';
}

export function hidePanel() {
  el.panel.className = '';
}

export function showTitle() {
  // The class centres the title and the button in a full-height column.
  panel('<h1>Unicorn Paparazzi</h1><button id="go">Start</button>', 't');
}


const NONE = 'No clear unicorns';
const sign = (n) => (n > 0 ? '+' : '') + n;
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim');

// The breakdown for one shot, reached by clicking a row in the results list.
export function showPhoto(scored, index, count, onBack) {
  let rows = '';
  if (!scored.subjects.length) {
    rows = '<tr><td colspan="2" class="dim">' + NONE + '</td></tr>';
  }
  const pct = (v) => (v * 100).toFixed(0) + '%';
  for (const s of scored.subjects) {
    rows +=
      '<tr class="rule"><td><b>' + s.colour + '</b>' +
      (s.horns ? ' <span class="pos">' + (s.horns + 1) + ' horns</span>' : '') + '</td>' +
      '<td class="n"><b>' + Math.round(s.subtotal) + '</b></td></tr>' +
      row('size', s.size, (s.cov * 100).toFixed(1) + '% of frame × ' + scored.resBonus + ' sensor') +
      (s.pose ? row('pose', s.pose, s.poseName) : '') +
      (s.cropLoss > 0.5 ? row('cropped', -s.cropLoss, pct(s.cEdge) + ' of outline cut') : '') +
      (s.envLoss > 0.5 ? row('scenery', -s.envLoss, pct(s.cEnv) + ' of outline') : '') +
      (s.occLoss > 0.5 ? row('crowded', -s.occLoss, pct(s.cOcc) + ' of outline') : '');
  }
  let bon = '';
  for (const b of scored.bonuses) {
    bon += '<tr><td>' + b.label +
      '</td><td class="n pos">×' + b.factor + '</td></tr>';
  }
  panel(
    '<h1>PHOTO ' + (index + 1) + ' / ' + count + '</h1>' +
    '<h2>' + scored.total + ' points</h2>' +
    '<img src="' + scored.url + '" alt="">' +
    '<table>' + rows +
    (scored.composition ? '<tr class="rule"><td>composition</td><td class="n">' +
      sign(scored.composition) + '</td></tr>' : '') +
    bon +
    (scored.bait ? '<tr><td class="neg">a lure is in shot</td><td class="n neg">-' +
      scored.bait + '</td></tr>' : '') +
    '<tr class="rule big"><td><b>photo total</b></td><td class="n"><b>' +
    scored.total + '</b></td></tr></table>' +
    '<p class="hint"><button id="back">Back to the roll</button></p>'
  );
  el.card.onclick = (e) => {
    e.stopPropagation();
    if (e.target.closest('#back')) onBack();
  };
}

// Every shot on the roll, worst first, so the best one is what you end on.
export function showResults(state, scored, reason, onPick, onShop) {
  const order = scored.map((s, i) => i).sort((a, b) => scored[a].total - scored[b].total);
  let rows = '';
  for (const i of order) {
    const s = scored[i];
    const what = s.subjects.length
      ? s.subjects.length + ' unicorn' + (s.subjects.length > 1 ? 's' : '') +
        (s.bonuses.length ? ' · ' + s.bonuses.map((b) => b.label).join(', ') : '')
      : NONE;
    rows += '<tr class="row" data-i="' + i + '"><td class="th"><img src="' + s.url + '"></td>' +
      '<td>' + what + '</td><td class="n big"><b>' + s.total + '</b></td></tr>';
  }
  if (!rows) rows = '<tr><td class="dim">No photographs.</td></tr>';
  panel(
    '<h1>ROLL DEVELOPED</h1>' +
    '<h2>' + reason + '  ·  bank ' + state.bank + '</h2>' +
    '<table>' + rows + '</table>' +
    '<p class="hint"><button id="shop">To the shop</button> — click a shot for detail.</p>'
  );
  el.card.onclick = (e) => {
    e.stopPropagation();
    if (e.target.closest('#shop')) return onShop();
    const row = e.target.closest('.row');
    if (row) onPick(+row.dataset.i);
  };
}

function row(label, n, how) {
  return '<tr><td class="dim">&nbsp;&nbsp;' + label +
    (how ? ' <span class="wk">' + how + '</span>' : '') +
    '</td><td class="n ' + cls(n) + '">' + sign(Math.round(n)) + '</td></tr>';
}

// The run summary and the shop are one screen: you see what the roll earned and
// immediately spend it.
export function showShop(state, cfg, offers, onBuy, onRide, onRestart) {
  let rows = '', kit = '';
  // Ladders are different lengths, so short ones have to be padded out to the
  // widest -- otherwise the row ends early and its rule stops short of the edge.
  const wide = Math.max(...offers.map((o) => (o.v ? o.v.length : 0)));
  offers.forEach((o, i) => {
    const price = (n) => '<small class="wk">' + n + '</small><br>';
    if (!o.v) {
      // A consumable: one row, buy as many as you like.
      kit += '<tr class="rule"><td>' + o.label + '</td>' +
        '<td class="n">×' + o.have + '</td><td class="n"><button data-i="' + i + '"' +
        (state.bank >= o.price ? '' : ' disabled') + '>' + o.price + '</button></td></tr>';
      return;
    }
    // A ladder: everything you own, the rung you can buy, and what is beyond.
    let cells = '';
    o.v.forEach((v, t) => {
      const label = v + o.sfx;
      cells += '<td class="n">' + (t <= o.at ? '<b class="pos">' + label + '</b>'
        : t === o.at + 1 ? price(o.p[t - 1]) + '<button data-i="' + i + '"' +
            (state.bank >= o.price ? '' : ' disabled') + '>' + label + '</button>'
        : price(o.p[t - 1]) + '<span class="wk">' + label + '</span>') + '</td>';
    });
    rows += '<tr class="rule g"><td class="dim">' + o.label + '</td>' + cells +
      '<td></td>'.repeat(wide - o.v.length) + '</tr>';
  });
  panel(
    '<h1>SHOP</h1>' +
    '<h2>bank ' + state.bank + '</h2>' +
    '<table>' + rows + '</table><table>' + kit + '</table>' +
    '<p class="hint"><button id="ride">Ride again</button> ' +
    '<button id="restart">Start over</button></p>'
  );
  el.card.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    if (b.id === 'ride') onRide();
    else if (b.id === 'restart') onRestart();
    else if (b.dataset.i !== undefined) onBuy(+b.dataset.i);
  };
}
