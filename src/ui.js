
// Element ids are written into HTML strings, and terser cannot see into a string
// -- it renames variables and leaves "id=\"shop\"" exactly as typed. So unlike
// everything else in this file, these are hand-shortened. Measured at 11 bytes.
//
//   a start (host)   e ride again   k back    m my photos / results
//   o join           s shop / rematch         x reset
//   go solo          mp multiplayer / menu    j code field   n name field
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

export function updateHud(state, ride, clock) {
  // The frame is the photograph now, so it outlines exactly what will be taken:
  // a fixed 16:9 rectangle, which needs its own inset on each axis.
  el.vf.style.inset = ((1 - state.fy) * 50).toFixed(1) + '% ' +
                      ((1 - state.fx) * 50).toFixed(1) + '%';
  el.bar.style.width = (Math.min(1, ride) * 100).toFixed(1) + '%';
  // Losing the pointer is otherwise invisible -- you find out by taking a photo
  // you did not mean to take. This used to be a 2.6s toast fired from the
  // pointerlockchange event, which meant the one moment it mattered -- sitting
  // unlocked, wondering why the camera will not turn -- was the moment it had
  // already expired. It is a state now, so it is on screen for exactly as long
  // as it is true.
  el.hud.textContent = 'ride ' + Math.floor(Math.min(1, ride) * 100) + '%' +
    (state.mode === 'ride' && !document.pointerLockElement ? '  ·  click to look' : '');
  // Under the frame count: the lens, or a winding dot while the shutter is
  // still recovering. The bank used to read here, but money is a between-rides
  // number -- what you actually want mid-ride is which zoom you are on, and the
  // lens has no other readout. CONFIG.zoomLevels is [1, 2, 4, 8, 16], so the
  // level is just the index shifted; the shop suite holds that ladder to it.
  el.film.innerHTML = 'Film <b>' + state.film + '</b><br><small>' +
    (clock < state.ready ? '·' : '×' + (1 << state.zoom)) + '</small>';
  el.film.className = 'sh' + (state.film <= 3 ? ' low' : '');
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

export function showTitle(onSolo, onMulti, onReset, lost) {
  // The class centres the title and the buttons in a full-height column.
  // onReset is falsy when there is nothing saved, and then there is nothing to
  // offer to wipe.
  //
  // `lost` is the dead end -- no film and no money for any -- and it is this
  // card rather than one of its own, because everything it needs to say is
  // already here and only the two things you can no longer do come off.
  panel('<h1>Unicorn Paparazzi</h1>' +
        (lost ? '<h2>Out of film</h2>'
              : '<p><button id="go">Solo</button></p>' +
                '<p><button id="mp">Multiplayer</button></p>') +
        (onReset ? '<p><button id="x">Reset</button></p>' : ''), 't');
  onCard((b) => (b.id === 'mp' ? onMulti() : b.id === 'x' ? onReset() : onSolo()));
}

// Everyone in the room, with the code big enough to read out loud. The roster is
// live: net.js calls back on every arrival and departure and this redraws.
export function showLobby(code, host, riders, name, onStart, onJoin, onBack, onName) {
  // net.js hands these over ready to draw, yours already reading "You!", so
  // there is nothing here to work out about who is who.
  let rows = '';
  for (const nm of riders) rows += row3('class="r"', '', nm, '');
  panel(
    '<h1>' + code + '</h1>' +
    '<h2>code</h2>' +
    '<table>' + rows + '</table>' +
    // A guest has nothing to do but wait, so the whole join row goes with the
    // Start button. Hopping to another code from here would mean leaving anyway.
    '<p class="h">' + (host
      ? '<button id="a"' + (riders.length > 1 ? '' : ' disabled') +
        '>Start Game</button>'
      : 'waiting for host') + '</p>' +
    '<p class="h">name <input id="n" value="' + name + '"></p>' +
    '<p class="h">' + (host
      ? 'join <input id="j"> <button id="o">Join</button> '
      : '') + '<button id="k">Back</button></p>'
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
  onCard((b) => (b.id === 'a' ? val('n') && onStart()
                 : b.id === 'k' ? onBack() : join()));
}


const NONE = 0 + ' unicorns';
// Only the first three need naming; every later index falls through to 'th',
// which is right all the way to 20th.
const ORD = ['st', 'nd', 'rd'];
// Both tables on the results screen are the same three columns -- a thumbnail, a
// label, a score -- and the lobby roster is that shape with the picture missing.
// One builder for all three: roadroller charges almost nothing for the second and
// third call sites once it has seen the first.
const row3 = (attrs, url, what, n) =>
  '<tr ' + attrs + '><td class="i">' + (url ? '<img src="' + url + '">' : '') +
  '</td><td>' + what + '</td><td class="n b"><b>' + n + '</b></td></tr>';

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
    // A gain reads green and a loss red. A multiplier is judged against parity
    // -- x2 is a gain, and framing rides below x100% as often as above it. Only
    // a signed or multiplied value is coloured, so plain totals stay neutral.
    const k = value[0];
    const c = k === '-' ? ' m'
      : k !== '+' && k !== '×' ? ''
      : parseFloat(value.slice(1)) < (value.slice(-1) === '%' ? 100 : 1) ? ' m' : ' p';
    body += '<tr class="' + (sub ? 'd' : 'r') + '"><td>' +
      (sub ? '&nbsp;' : '') + label + '</td><td class="n' + c + '">' + value + '</td></tr>';
  }
  if (!body) body = '<tr><td colspan="2" class="d">' + NONE + '</td></tr>';
  return '<h2>' + heading + '</h2>' +
    (url ? '<img src="' + url + '">' : '') +
    '<table>' + body +
    '<tr class="r b"><td><b>total</b></td><td class="n"><b>' + total +
    '</b></td></tr></table>';
}

// The breakdown for one of your own shots, reached by clicking a row in the roll.
export function showPhoto(scored, onBack) {
  panel(
    '<h1>Photos</h1>' +
    photoCard(scored.url, scored.b, scored.total + ' points', scored.total) +
    '<p class="h"><button id="k">Back</button></p>'
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
// and "Photos" each earn their keep twice. `mine` is that swap: a sub-view,
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
    rows += row3('class="o" data-i="' + i + '"', s.url, what, '$' + s.total);
  }
  if (!rows) rows = '<tr><td class="d">' + NONE + '</td></tr>';
  const roll = '<table>' + rows + '</table>';
  // The money reads under the roll, not over it: the photographs are what you
  // came to look at, and the bank is what they add up to. What this ride paid
  // rides along with it -- the roll is priced in dollars now, so the two totals
  // belong on the same line. A borrowed-gear ride earns nothing and never gets
  // here: the match view draws cards instead.
  const ride = scored.reduce((a, s) => a + s.total, 0);
  const earned = '<h2>$' + state.bank + ' · $' + ride + ' this ride</h2>';

  // Solo: the roll, what it paid, and the way to the shop.
  if (waiting === undefined) {
    panel('<h1>Photos</h1>' + roll + earned +
          '<p class="h"><button id="s">Shop</button></p>');
  } else {
    // Your own entry has to carry a photograph and a breakdown like everyone
    // else's, or winning would show a blank card. Rivals send their best shot;
    // this picks yours the same way endRun does, but at full thumbnail size
    // rather than the small copy that had to fit on the wire.
    const best = scored.reduce((a, s) => (a && a.total > s.total ? a : s), null);
    const all = [{ name: 'You!', n: ride,
                   p: best ? best.url : '', b: best ? best.b : [] }, ...rivals];
    all.sort((a, b) => b.n - a.n);
    let cards = '';
    all.forEach((r, i) => {
      cards += photoCard(r.p, r.b, i + 1 + (ORD[i] || 'th') + ' place: ' + r.name, r.n);
    });
    // Both buttons sit on every match screen, the waiting one included. A rider
    // who types the code mid-ride joins the roster and never reports, so `waiting`
    // can stall for good -- nobody may be trapped on a screen with no way out.
    panel(
      '<h1>' + (mine ? 'Photos' : 'Results') + '</h1>' +
      (waiting ? '<h2>waiting for ' + waiting + '</h2>' : mine ? roll : cards) +
      '<p class="h"><button id="m">' + (mine ? 'Results' : 'Photos') +
      '</button> <button id="s">Rematch</button></p>'
    );
  }
  el.card.onclick = (e) => {
    e.stopPropagation();
    if (e.target.closest('#s')) return onNext();
    if (e.target.closest('#m')) return onPick(-1);
    const row = e.target.closest('.o');
    if (row) onPick(+row.dataset.i);
  };
}

// The run summary and the shop are one screen: you see what the roll earned and
// immediately spend it.
export function showShop(state, cfg, offers, onBuy, onRide, onMenu) {
  // Three columns: what the ladder is, the rung you are standing on, and the one
  // rung you can buy with its price inside the button. The whole ladder used to
  // be drawn, which was a table of markup for something read once -- and a maxed
  // ladder now simply has no button rather than a row of dimmed text.
  let rows = '', film = '';
  offers.forEach((o, i) => {
    const btn = (label) => '<button data-i="' + i + '"' +
      (state.bank >= o.price ? '' : ' disabled') + '>' + label + '</button>';
    // A filmless offer is a quantity of frames rather than a rung. Film is not a
    // ladder and does not belong in the ladder table, so it goes to the footer.
    if (!o.v) return void (film += ' $' + o.price + ' ' + btn('+' + o.n));
    const next = o.at + 1;
    rows += '<tr class="r"><td class="d">' + o.label +
      '</td><td class="n"><b class="p">' + o.v[o.at] + o.sfx + '</b></td><td class="n">' +
      (next < o.v.length ? btn(o.v[next] + o.sfx + ' $' + o.price) : '') + '</td></tr>';
  });
  panel(
    '<h1>SHOP</h1>' +
    // Money and film are the two things you spend, so they are read together.
    '<h2>$' + state.bank + ' · Film ' + state.film + '</h2>' +
    // A `current`/`Upgrade` header row here measured at 35 bytes -- a tenth of
    // everything the three-column rebuild saved -- and the columns read without
    // it: a name, the rung you own in green, and a button naming what it buys
    // and what it costs. Restore it here if the budget ever allows.
    '<table>' + rows + '</table>' +
    '<p class="h">Film' + film + '</p>' +
    // A ride with an empty roll earns nothing and cannot be photographed, so it
    // is only offered once there is film to shoot it on. Disabled, it says what
    // is missing rather than dangling a greyed-out "Ride again" with no reason
    // given -- and what is missing is on sale in the row directly above it.
    '<p class="h"><button id="e"' + (state.film ? '>Ride again' : ' disabled>No film') +
    '</button> ' +
    // Everything else you might want -- multiplayer, wiping the save -- lives on
    // the menu now, so the shop only has to be able to get you back there.
    '<button id="mp">Menu</button></p>'
  );
  el.card.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    if (b.id === 'e') onRide();
    else if (b.id === 'mp') onMenu();
    else if (b.dataset.i !== undefined) onBuy(+b.dataset.i);
  };
}
