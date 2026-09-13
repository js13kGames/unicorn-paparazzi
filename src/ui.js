import { RIDE } from './mode.js';

// Element ids appear inside HTML strings, which terser cannot rename, so they are
// hand-shortened:
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

export function updateHud(state, ride, clock, zoom, quota) {
  // The frame is the photograph now, so it outlines exactly what will be taken:
  // a fixed 16:9 rectangle, which needs its own inset on each axis.
  el.vf.style.inset = ((1 - state.fy) * 50).toFixed(1) + '% ' +
                      ((1 - state.fx) * 50).toFixed(1) + '%';
  el.bar.style.width = (Math.min(1, ride) * 100).toFixed(1) + '%';
  // The lost-pointer hint is a state, not a toast: it is on screen for exactly as
  // long as it is true. `state.t` keeps it off a phone, which has no pointer to
  // lose. innerHTML because the quota below carries a colour; everything
  // interpolated is a number or a fixed string.
  el.hud.innerHTML = 'ride ' + Math.floor(Math.min(1, ride) * 100) + '%' +
    (state.phase === RIDE && !state.t && !document.pointerLockElement ? '  ·  click to look' : '') +
    // Taken against owed: red until the target is met, green once it is. Solo only.
    // It must stay in the left column -- under the film count, #roll paints the
    // first thumbnail straight over it.
    (quota ? '<br><b class="' + (quota[0] >= quota[1] ? 'p' : 'm') +
             '">$' + quota[0] + ' / $' + quota[1] + '</b>' : '');
  // The lens, or a winding dot while the shutter recovers. The ladder is read, not
  // derived: not every rung is a power of two.
  el.film.innerHTML = 'film <b>' + state.film + '</b><br><small>' +
    (clock < state.armed ? '·' : '×' + zoom[state.lens]) + '</small>';
  el.film.className = 'sh' + (state.film <= 3 ? ' low' : '');
}


export function flash() {
  // Web Animations, not a CSS class: an offsetWidth read restarts a transition but
  // not an animation, so the class-toggle version stuck at "on" after one shot.
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

// Read at click time, never from the render. A field not on the card reads empty.
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

// Here rather than a <title> tag: the same words are on the card below, so inside
// the packed payload the second copy is nearly free -- in the shell it was 32
// characters of raw text.
document.title = 'Unicorn Paparazzi';

export function showTitle(onSolo, onMulti, onReset, lost, saved, pic, earned, missed, trophies) {
  // `lost` is the dead end, and it shares this card because the one button that
  // gets out of it is already here. It is the only reading the run ever gets, so
  // it shows earnings rather than the bank -- the shop has spent most of the bank,
  // and what you spent is not what you earned.
  //
  // The 't' class centres a headline and two buttons full-height, which suits the
  // menu but crowds the dead end's photograph and table off the screen.
  panel((lost ? '<h1>Game over</h1>' +
                '<h2>missed $' + missed + '</h2>' +
                photoCard(pic.p, pic.b || [], 'Best picture', pic.n || 0) +
                // Named, not bare: a lone dollar amount here could as easily be
                // the bank or what the last ride made.
                '<h2>total earnings $' + earned + '</h2>' +
                (trophies ? '<p>' + '🏆'.repeat(trophies) + '</p>' : '')
              : '<h1>Unicorn Paparazzi</h1>' +
                '<p><button id="go">Solo</button></p>' +
                '<p><button id="mp">Multiplayer</button></p>') +
        (saved ? '<p class="h"><button id="x">Reset</button></p>' : ''), lost ? '' : 't');
  onCard((b) => (b.id === 'mp' ? onMulti() : b.id === 'x' ? onReset() : onSolo()));
}

// What the game wants, said once, before every solo ride.
//
// No button, deliberately: index.js binds a click anywhere on #panel to primary(),
// so this card is simply ridden away by the next click, and onCard() would swallow
// it. That tap is also the user gesture iOS demands before askIMU() and lock().
export function showBrief(quota) {
  panel('<h1>Unicorn Paparazzi</h1>' +
        '<p>Take pictures of unicorns</p>' +
        '<p>Better pictures earn more $</p>' +
        '<p>To continue you must get $' + quota + ' this ride</p>' +
        // The one rule playing will not teach you: a dark unicorn zeroes the whole
        // photograph, so the shot that taught you looks like a scoring bug.
        '<p class="h m">Warning · Pictures containing dark unicorns earn $0</p>' +
        // `press`, not `click`: the only verb true on a phone as well.
        '<p class="h">press to ride</p>', 't');
}

// The whole of multiplayer in one card with two states, `code` being the switch:
// out of a room, the way in; in one, the live roster. One card because the field,
// the buttons, the Enter key, the four-digit guard and the click router are shared
// -- a second screen would be a second copy of all of it.
export function showLobby(code, host, riders, name, onGo, onJoin, onBack, onName) {
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
  // Live as you type, not on the way out of a field: a nameless rider is a riddle
  // on everyone else's roster, and Join stays shut until the code is a code.
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
// Both results tables and the lobby roster are the same three columns: thumbnail,
// label, score.
const row3 = (attrs, url, what, n) =>
  '<tr ' + attrs + '><td class="i">' + (url ? '<img src="' + url + '">' : '') +
  '</td><td>' + what + '</td><td class="n b"><b>' + n + '</b></td></tr>';

// One photograph, big, with score.js's breakdown under it. Draws your own shots
// and rivals' alike -- theirs arrive off the wire already sanitised by net.js.
export function photoCard(url, rows, heading, total) {
  let body = '';
  for (const [label, value] of rows) {
    // A leading space means "detail of the row above": dim it and indent it,
    // rather than ruling it off as a subject of its own.
    const sub = label[0] === ' ';
    // Only a SIGNED value is coloured, so plain totals -- and exact parity, which
    // prints an unsigned 0% -- stay neutral.
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
export function showPhoto(scored, onBack, onStep, i, n) {
  // `<` has to be an entity or innerHTML eats the button; `>` is only special
  // after a `<`.
  const step = (id, glyph, at) => '<button id="' + id + '"' +
    (at ? ' disabled' : '') + '>' + glyph + '</button> ';
  panel(
    '<h1>Photos</h1>' +
    photoCard(scored.pic, scored.b, scored.sum + ' points', scored.sum) +
    // Ends of the roll disable rather than wrap: the roll is short enough that
    // wrapping reads as the card refusing to close.
    '<p class="h">' + step('v', '&lt;', !i) +
    '<button id="k">Back</button> ' + step('n', '>', i >= n - 1) + '</p>'
  );
  onCard((b) => (b.id === 'v' ? onStep(i - 1) : b.id === 'n' ? onStep(i + 1) : onBack()));
}

// The results screen, in three shapes:
//
//   solo                  your roll, the bank, and the way to the shop
//   match, still riding   who is not in yet, and nothing to read
//   match, everyone in    every rider's best photograph, ranked
//
// `mine` swaps the two match views -- a sub-view, not a mode of its own.
export function showResults(state, scored, onPick, onNext, rivals, waiting, mine, quota) {
  // Best first: this is a scoreboard, and the interesting one belongs at the top.
  const order = scored.map((s, i) => i).sort((a, b) => scored[b].sum - scored[a].sum);
  let rows = '', ride = 0;
  // Keyed by rank, not shot index, so < / > in the detail view walk this order.
  for (let pos = 0; pos < order.length; pos++) {
    const s = scored[order[pos]];
    const what = s.subjects.length
      ? s.subjects.length + ' unicorn' + (s.subjects.length > 1 ? 's' : '') +
        (s.bonuses.length ? ' · ' + s.bonuses.map((b) => b.legend).join(', ') : '')
      : NONE;
    rows += row3('class="o" data-i="' + pos + '"', s.pic, what, '$' + s.sum);
    ride += s.sum;
  }
  if (!rows) rows = '<tr><td class="d">' + NONE + '</td></tr>';
  const roll = '<table>' + rows + '</table>';
  // Only the ride figure takes a colour -- you can be flush and still have missed,
  // so the bank is no answer to "did that ride pass". A match sets no quota, so the
  // figure stays plain there.
  const earned = '<h2>$' + state.bank + ' · <b class="' +
    (quota ? ride >= quota ? 'p' : 'm' : '') + '">$' + ride + ' this ride</b></h2>';

  // Solo: the roll, what it paid, and the way to the shop.
  if (waiting === undefined) {
    panel('<h1>Photos</h1>' + roll + earned +
          '<p class="h"><button id="s">Shop</button></p>');
  } else {
    // Your own entry needs a photo and a breakdown like everyone else's, or winning
    // shows a blank card. The top of the ranked roll, at full thumbnail size rather
    // than the small copy that had to fit on the wire.
    const best = scored[order[0]];
    const all = [{ who: 'You!', n: ride,
                   p: best ? best.pic : '', b: best ? best.b : [] }, ...rivals];
    all.sort((a, b) => b.n - a.n);
    let cards = '';
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      cards += photoCard(r.p, r.b, i + 1 + (ORD[i] || 'th') + ' place: ' + r.who, r.n);
    }
    // Both buttons sit on every match screen, waiting included: a rider who joins
    // mid-ride never reports, so `waiting` can stall for good.
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

// The run summary and the shop are one screen: see what the roll earned, spend it.
//
// `cfg` and `quota` are deliberately unread. Dropping them measured WORSE (3 and 8
// bytes): the long call site is a substring roadroller has already seen from the
// other ui.show* calls, while each shorter one is new to it.
export function showShop(state, cfg, offers, onBuy, onRide, onMenu, quota, onPhotos) {
  // Three columns: the line, where you stand on it, and what the next rung costs.
  // The rung you own is bold, not green -- .p is the gain colour, and here it is
  // simply where you stand.
  let rows = '';
  const row = (label, now, buys) => '<tr class="r"><td class="d">' + label +
    '</td><td class="n"><b>' + now + '</b></td><td class="n">' + buys + '</td></tr>';
  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    const btn = (label) => '<button data-i="' + i + '"' +
      (o.ok ? '' : ' disabled') + '>' + label + '</button>';
    const next = o.at + 1;
    rows += row(o.legend, o.v[o.at] + o.sfx,
      next < o.v.length ? btn(o.v[next] + o.sfx + ' $' + o.price) : '');
  }
  panel(
    '<h1>Shop</h1>' +
    '<h2>$' + state.bank + '</h2>' +
    '<p class="h">' + state.rides + ' rides, $' + state.earned + '</p>' +
    // A `current`/`Upgrade` header row measured 35 bytes and the columns read
    // without it. Restore it here if the budget ever allows.
    '<table>' + rows + '</table>' +
    '<p class="h"><button id="mp">Menu</button> ' +
    // Only when there is a roll to go back to: a shop opened at boot has none, and
    // index.js passes no handler there.
    (onPhotos ? '<button id="s">Photos</button> ' : '') +
    '<button id="e">Next ride</button></p>'
  );
  el.card.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    if (b.id === 'e') onRide();
    else if (b.id === 's') onPhotos();
    else if (b.id === 'mp') onMenu();
    else if (b.dataset.i !== undefined) onBuy(+b.dataset.i);
  };
}
