
const $ = (id) => document.getElementById(id);
const el = { hud: $('hud'), film: $('film'), bar: $('bar'),
             flash: $('flash'), panel: $('panel'), card: $('card'), vf: $('vf'),
             roll: $('roll') };

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
}

export function updateHud(state, cfg, lap, clock) {
  // The frame is the photograph now, so it outlines exactly what will be taken:
  // a fixed 16:9 rectangle, which needs its own inset on each axis.
  el.vf.style.inset = ((1 - state.fy) * 50).toFixed(1) + '% ' +
                      ((1 - state.fx) * 50).toFixed(1) + '%';
  el.bar.style.width = (Math.min(1, lap) * 100).toFixed(1) + '%';
  el.hud.textContent = 'lap ' + Math.floor(Math.min(1, lap) * 100) + '%' +
    (performance.now() < toastUntil ? '  ·  ' + el.hud.dataset.msg : '');
  el.film.innerHTML = 'Film Remaining <b>' + state.film + '</b><br><small>' +
    (clock < state.ready ? '⏳' : state.photos.length + '/' + cfg.filmTiers[state.filmTier]) +
    '</small>';
  el.film.className = 'sh' + (state.film <= 3 ? ' low' : '');
}


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

// Every card that has its own buttons stops the click reaching #panel, which
// otherwise reads any click in title mode as "start riding".
function onCard(fn) {
  el.card.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    fn(b);
  };
}

export function showTitle(onSolo, onMulti, onReset) {
  // The class centres the title and the buttons in a full-height column.
  // onReset is falsy when there is nothing saved, and then there is nothing to
  // offer to wipe.
  panel('<h1>Unicorn Paparazzi</h1><button id="go">Solo</button>' +
        '<p><button id="mp">Multiplayer</button></p>' +
        (onReset ? '<p><button id="restart">Reset</button></p>' : ''), 't');
  onCard((b) => (b.id === 'mp' ? onMulti() : b.id === 'restart' ? onReset() : onSolo()));
}

// Everyone in the room, with the code big enough to read out loud. The roster is
// live: net.js calls back on every arrival and departure and this redraws.
export function showLobby(code, host, riders, name, onStart, onJoin, onBack, onName) {
  // net.js hands these over ready to draw, yours already reading "You!", so
  // there is nothing here to work out about who is who.
  let rows = '';
  for (const nm of riders) rows += row3('class="rule"', '', nm, '');
  panel(
    '<h1>' + code + '</h1>' +
    '<h2>your code</h2>' +
    '<table>' + rows + '</table>' +
    // A guest has nothing to do but wait, so the whole join row goes with the
    // Start button. Hopping to another code from here would mean leaving anyway.
    '<p class="hint">' + (host
      ? '<button id="start"' + (riders.length > 1 ? '' : ' disabled') +
        '>Start Multiplayer Game</button>'
      : 'waiting for the host') + '</p>' +
    '<p class="hint">name <input id="n" value="' + name + '"></p>' +
    '<p class="hint">' + (host
      ? 'join <input id="j"> <button id="join">Join</button> '
      : '') + '<button id="back">Back</button></p>'
  );
  // Read at click time, never from the render: the change event fires on the way
  // out of a field, so by the time a button is clicked these are current.
  const val = (id) => (document.getElementById(id) || {}).value || '';
  // Both, or neither: a nameless rider is a riddle on everyone else's roster.
  const join = () => { if (val('n') && /^\d{4}$/.test(val('j'))) onJoin(val('j')); };
  // One handler for the whole card rather than one per field: every key typed in
  // here must stay out of the game's own listeners, or Space fires the shutter.
  el.card.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') join();
  };
  // On change, not on every keystroke: this reaches the wire and the save.
  document.getElementById('n').onchange = (e) => onName(e.target.value);
  onCard((b) => (b.id === 'start' ? val('n') && onStart()
                 : b.id === 'back' ? onBack() : join()));
}


const NONE = 'No clear unicorns';
// Only the first three need naming; every later index falls through to 'th',
// which is right all the way to 20th.
const ORD = ['st', 'nd', 'rd'];
// Both tables on the results screen are the same three columns -- a thumbnail, a
// label, a score -- and the lobby roster is that shape with the picture missing.
// One builder for all three: roadroller charges almost nothing for the second and
// third call sites once it has seen the first.
const row3 = (attrs, url, what, n) =>
  '<tr ' + attrs + '><td class="th">' + (url ? '<img src="' + url + '">' : '') +
  '</td><td>' + what + '</td><td class="n big"><b>' + n + '</b></td></tr>';

// One photograph, big, with score.js's compact breakdown under it. This draws
// your own shots and the winning shot alike -- and a rival's winning shot, whose
// rows came off the wire already sanitised by net.js.
//
// A row whose label starts with a space is a detail of the row above it.
export function photoCard(url, rows, heading, total) {
  let body = '';
  for (const [label, value] of rows) {
    // A leading space means "detail of the row above": dim it and indent it,
    // rather than ruling it off as a subject of its own.
    const sub = label[0] === ' ';
    body += '<tr class="' + (sub ? 'dim' : 'rule') + '"><td>' +
      (sub ? '&nbsp;' : '') + label + '</td><td class="n">' + value + '</td></tr>';
  }
  if (!body) body = '<tr><td colspan="2" class="dim">' + NONE + '</td></tr>';
  return '<h2>' + heading + '</h2>' +
    (url ? '<img src="' + url + '">' : '') +
    '<table>' + body +
    '<tr class="rule big"><td><b>total</b></td><td class="n"><b>' + total +
    '</b></td></tr></table>';
}

// The breakdown for one of your own shots, reached by clicking a row in the roll.
export function showPhoto(scored, onBack) {
  panel(
    '<h1>My Photos</h1>' +
    photoCard(scored.url, scored.b, scored.total + ' points', scored.total) +
    '<p class="hint"><button id="back">Back</button></p>'
  );
  onCard(onBack);
}

// The results screen, in three shapes:
//
//   solo                  your roll, the bank, and the way to the shop
//   match, still riding   who is not in yet, and nothing to read
//   match, everyone in    every rider's best photograph, ranked
//
// The two match views are named after the buttons that swap them, so "Results"
// and "My Photos" each earn their keep twice. `mine` is that swap: a sub-view,
// not a mode of its own.
export function showResults(state, scored, onPick, onNext, rivals, waiting, mine) {
  // Best first. It used to run worst-first so you ended on your best shot, but
  // this is a scoreboard now and the interesting one belongs at the top.
  const order = scored.map((s, i) => i).sort((a, b) => scored[b].total - scored[a].total);
  let rows = '';
  for (const i of order) {
    const s = scored[i];
    const what = s.subjects.length
      ? s.subjects.length + ' unicorn' + (s.subjects.length > 1 ? 's' : '') +
        (s.bonuses.length ? ' · ' + s.bonuses.map((b) => b.label).join(', ') : '')
      : NONE;
    rows += row3('class="row" data-i="' + i + '"', s.url, what, s.total);
  }
  if (!rows) rows = '<tr><td class="dim">' + NONE + '</td></tr>';
  const roll = '<table>' + rows + '</table>';

  // Solo: exactly what it always was.
  if (waiting === undefined) {
    panel('<h1>My Photos</h1><h2>bank ' + state.bank + '</h2>' + roll +
          '<p class="hint"><button id="shop">Shop</button></p>');
  } else {
    // Your own entry has to carry a photograph and a breakdown like everyone
    // else's, or winning would show a blank card. Rivals send their best shot;
    // this picks yours the same way endRun does, but at full thumbnail size
    // rather than the small copy that had to fit on the wire.
    const best = scored.reduce((a, s) => (a && a.total > s.total ? a : s), null);
    const all = [{ name: 'You!', n: scored.reduce((a, s) => a + s.total, 0),
                   p: best ? best.url : '', b: best ? best.b : [] }, ...rivals];
    all.sort((a, b) => b.n - a.n);
    let cards = '';
    all.forEach((r, i) => {
      cards += photoCard(r.p, r.b, i + 1 + (ORD[i] || 'th') + ' place: ' + r.name, r.n);
    });
    // Both buttons sit on every match screen, the waiting one included. A rider
    // who types the code mid-lap joins the roster and never reports, so `waiting`
    // can stall for good -- nobody may be trapped on a screen with no way out.
    panel(
      '<h1>' + (mine ? 'My Photos' : 'Results') + '</h1>' +
      (waiting ? '<h2>waiting for ' + waiting + '</h2>' : mine ? roll : cards) +
      '<p class="hint"><button id="mine">' + (mine ? 'Results' : 'My Photos') +
      '</button> <button id="shop">Rematch</button></p>'
    );
  }
  el.card.onclick = (e) => {
    e.stopPropagation();
    if (e.target.closest('#shop')) return onNext();
    if (e.target.closest('#mine')) return onPick(-1);
    const row = e.target.closest('.row');
    if (row) onPick(+row.dataset.i);
  };
}

// The run summary and the shop are one screen: you see what the roll earned and
// immediately spend it.
export function showShop(state, cfg, offers, onBuy, onRide, onMenu) {
  let rows = '';
  // Ladders are different lengths, so short ones have to be padded out to the
  // widest -- otherwise the row ends early and its rule stops short of the edge.
  const wide = Math.max(...offers.map((o) => o.v.length));
  offers.forEach((o, i) => {
    const price = (n) => '<small class="wk">' + n + '</small><br>';
    // Everything you own, the rung you can buy, and what is beyond.
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
    '<table>' + rows + '</table>' +
    '<p class="hint"><button id="ride">Ride again</button> ' +
    // Everything else you might want -- multiplayer, wiping the save -- lives on
    // the menu now, so the shop only has to be able to get you back there.
    '<button id="mp">Main Menu</button></p>'
  );
  el.card.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    if (b.id === 'ride') onRide();
    else if (b.id === 'mp') onMenu();
    else if (b.dataset.i !== undefined) onBuy(+b.dataset.i);
  };
}
