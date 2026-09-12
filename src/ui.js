import { RIDE } from './mode.js';

// Element ids are written into HTML strings, and terser cannot see into a string
// -- it renames variables and leaves "id=\"shop\"" exactly as typed. So unlike
// everything else in this file, these are hand-shortened. Measured at 11 bytes.
//
//   a start (host)   e ride again   k back    m my photos / results
//   o join           s shop / rematch         x reset
//   a create / start -- the primary action, whichever state the card is in
//   go solo          mp multiplayer / menu
//   j code field     n name field (out of a room only)
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

export function updateHud(state, ride, clock, zoom) {
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
  // as it is true. A phone never has a pointer to lose, so `state.t` keeps the
  // hint off a screen where it could only ever be wrong.
  el.hud.textContent = 'ride ' + Math.floor(Math.min(1, ride) * 100) + '%' +
    (state.mode === RIDE && !state.t && !document.pointerLockElement ? '  ·  click to look' : '');
  // Under the frame count: the lens, or a winding dot while the shutter is
  // still recovering. The bank used to read here, but money is a between-rides
  // number -- what you actually want mid-ride is which zoom you are on, and the
  // lens has no other readout. The ladder is read rather than derived: it used
  // to be `1 << state.zoom`, which was true only while every rung was a power of
  // two, and the free 1.2x rung is not one.
  el.film.innerHTML = 'film <b>' + state.film + '</b><br><small>' +
    (clock < state.ready ? '·' : '×' + zoom[state.zoom]) + '</small>';
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

// A code that is not four digits must not send you anywhere: the room name would
// simply be wrong and you would sit alone in it. Both the Join button and the
// Enter key ask this.
const four = (v) => /^\d{4}$/.test(v);

// Read at click time, never from the render: the change event fires on the way
// out of a field, so by the time a button is clicked these are current. A field
// that is not on the card at all reads as empty rather than throwing.
const val = (id) => ($(id) || {}).value || '';

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

// The browser tab's name. It lives here rather than in a <title> tag because
// the same words are on the card below: inside the packed payload the second
// copy is nearly free, while in the shell it was 32 characters of plain text.
document.title = 'Unicorn Paparazzi';

export function showTitle(onSolo, onMulti, onReset, lost, saved, pic, earned) {
  // `lost` is the dead end -- no film and no money for any -- and it is this
  // card rather than one of its own, because the one button that gets out of it
  // is already here and the rest of the menu simply comes off.
  //
  // It is the only reading the run ever gets, so it is where the run is read
  // out: the best photograph of the whole game with its breakdown intact, and
  // what the whole game took. The bank would be the wrong number -- the shop has
  // spent most of it, and what you spent is not what you earned.
  //
  // `saved` is whether there is a run on disk to wipe. index.js reads it live
  // rather than from its boot snapshot, so the dead end -- which can only be
  // reached after a run has been written -- still gets the button.
  //
  // The 't' class centres a title and two buttons in a full-height column, which
  // is the menu and not this: the dead end carries a photograph and a table, and
  // a 6em headline over them crowds both off the screen.
  panel((lost ? '<h1>Game over</h1>' +
                '<h2>out of film</h2>' +
                photoCard(pic.p, pic.b || [], 'Best picture', pic.n || 0) +
                // Bare, and in the shop's own markup: under the run's best
                // photograph and over the only button left, a figure in dollars
                // is the run's takings and can hardly be anything else.
                '<h2>$' + earned + '</h2>'
              : '<h1>Unicorn Paparazzi</h1>' +
                '<p><button id="go">Solo</button></p>' +
                '<p><button id="mp">Multiplayer</button></p>') +
        (saved ? '<p class="h"><button id="x">Reset</button></p>' : ''), lost ? '' : 't');
  onCard((b) => (b.id === 'mp' ? onMulti() : b.id === 'x' ? onReset() : onSolo()));
}

// The whole of multiplayer, in one card with two states. Out of a room it is the
// way in: who you are, and the two doors -- make one, or walk into someone
// else's. In a room it is the roster, live, redrawn by net.js on every arrival
// and departure. `code` is the switch: empty means no room yet.
//
// One card rather than two because almost all of it is shared -- the code field,
// Join, Back, the Enter key, the four-digit guard and the click router are
// written once here and serve both states. A second screen would have been a
// second copy of that scaffolding for the sake of one headline.
export function showLobby(code, host, riders, name, onGo, onJoin, onBack, onName) {
  // net.js hands these over ready to draw, yours already reading "You!", so
  // there is nothing here to work out about who is who.
  let rows = '';
  for (const nm of riders) rows += row3('class="r"', '', nm, '');
  panel(
    // The headline is the room's number, or the name of the card when there is
    // no room yet -- one pair of tags either way rather than one per state.
    '<h1>' + (code || 'Multiplayer') + '</h1>' +
    (code
      // What the number is FOR: the thing you read out to whoever is joining.
      ? '<h2>Join code</h2><table>' + rows + '</table>'
      : '<p class="h">name <input id="n" value="' + name + '"></p>') +
    // Create and Start are the same button: one primary action per state, so
    // they share an id, a callback and every byte of markup around the label.
    // A guest has no primary action at all -- only the wait.
    '<p class="h">' + (!code || host
      ? '<button id="a"' + (!code || riders.length > 1 ? '' : ' disabled') +
        '>' + (code ? 'Start' : 'Create') + ' Game</button>'
      : 'waiting for host') + '</p>' +
    // Only on the way in. Once you are in a room the way to another one is out
    // of this one, and a join field sitting under your own code invites you to
    // type the number you are already looking at.
    (code ? '' : '<p class="h">code <input id="j"> <button id="o">Join Game</button></p>') +
    '<p class="h"><button id="k">Back</button></p>'
  );
  // What each door actually needs, live as you type rather than on the way out
  // of a field: a nameless rider is a riddle on everyone else's roster, and
  // joining needs somewhere to go as well, so Join stays shut until the code is
  // a code. A button that lights up before it can do anything is a promise the
  // card cannot keep.
  if (!code) {
    const n = $('n'), j = $('j');
    (n.oninput = j.oninput = () => {
      $('a').disabled = !n.value;
      $('o').disabled = !n.value || !four(j.value);
    })();
    // On change, not on every keystroke: this reaches the wire and the save.
    n.onchange = (e) => onName(e.target.value);
  }
  // Enter reaches join() past the disabled button, so the guard stands here too.
  const join = () => { if (four(val('j'))) onJoin(val('j')); };
  // One handler for the whole card rather than one per field: every key typed in
  // here must stay out of the game's own listeners, or Space fires the shutter.
  el.card.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') join();
  };
  onCard((b) => (b.id === 'a' ? onGo()
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
    // A gain reads green and a loss red. Only a SIGNED value is colored, so plain
    // totals -- and a framing of exactly parity, which prints an unsigned 0% --
    // stay neutral. There is no multiplier case any more: every adjustment on
    // the breakdown is a signed percentage now, poses and horns included.
    const k = value[0];
    const c = k === '-' ? ' m' : k === '+' ? ' p' : '';
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
  // Three columns: what the line is, where you stand on it, and what you can
  // buy with the price inside the button. The whole ladder used to be drawn,
  // which was a table of markup for something read once -- and a maxed ladder
  // now simply has no button rather than a row of dimmed text.
  let rows = '', film = '';
  // The rung you own is bold rather than green: .p is the gain colour, and on
  // the shop every one of these is simply where you stand, not a win. Bold
  // against the dim .d label is enough to separate the two.
  const row = (label, now, buys) => '<tr class="r"><td class="d">' + label +
    '</td><td class="n"><b>' + now + '</b></td><td class="n">' + buys + '</td></tr>';
  offers.forEach((o, i) => {
    // index.js decides what you can afford, because affordability is not just
    // the price: with an empty roll an upgrade must leave a frame's worth in
    // the bank, or the shop sells you into a dead end.
    const btn = (label) => '<button data-i="' + i + '"' +
      (o.ok ? '' : ' disabled') + '>' + label + '</button>';
    // A filmless offer is a quantity of frames rather than a rung, so it has no
    // next tier to name -- but it is bought the same way, and a row of its own
    // under the ladders reads better than a stray line of buttons below them.
    if (!o.v) return void (film += ' ' + btn('+1 $' + o.price));
    const next = o.at + 1;
    rows += row(o.label, o.v[o.at] + o.sfx,
      next < o.v.length ? btn(o.v[next] + o.sfx + ' $' + o.price) : '');
  });
  rows += row('film', state.film, film);
  panel(
    '<h1>Shop</h1>' +
    // Only the bank: film now has its own row, and printing it twice on one
    // short screen just made the header longer.
    '<h2>$' + state.bank + '</h2>' +
    // A `current`/`Upgrade` header row here measured at 35 bytes -- a tenth of
    // everything the three-column rebuild saved -- and the columns read without
    // it: a name, the rung you own in green, and a button naming what it buys
    // and what it costs. Restore it here if the budget ever allows.
    '<table>' + rows + '</table>' +
    // A ride with an empty roll earns nothing and cannot be photographed, so it
    // is only offered once there is film to shoot it on.
    '<p class="h"><button id="e"' + (state.film ? '' : ' disabled') +
    '>Ride again</button> ' +
    // Everything else you might want -- multiplayer, wiping the save -- lives on
    // the menu now, so the shop only has to be able to get you back there.
    '<button id="mp">Menu</button></p>' +
    // Under both buttons, in the loss color: a greyed-out button with no reason
    // on it is something the player has to guess at, and what is missing is on
    // sale two rows up.
    (state.film ? '' : '<p class="h m">no film</p>')
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
