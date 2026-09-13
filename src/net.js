// The js13k relay hands any URL path its own isolated room, which is what makes a
// join code cheap: the code IS the room, so nothing has to filter a shared
// firehose and presence is per-lobby for free. Single player never connects.
//
//   {t:'h', i:id, n:name}           I just arrived -- who is here?
//   {t:'h', i:id, n:name, r:1}       a reply; r stops it echoing forever
//   {t:'h', i:id, n:name, r:1, e:1}  ...and my roll is empty
//   {t:'g', s:seed}                  the host started the ride
//   {t:'d', i:id, n:score, p:shot, b:rows}   someone finished it
//
// The relay interleaves its own control frames, which are bare strings rather
// than JSON: '@id' is the id it gave us, '+id' a rider arriving, '-id' one
// leaving. We act on the first and the last. '+id' is redundant -- an arriving
// rider says hello for itself -- and JSON.parse drops it for free.
//
// Everything here is optional by construction. If the socket never opens, or the
// relay is down, or we are offline, the lobby simply stays empty: every send is
// guarded and no failure path reaches the frame loop.

// The room prefix js13kgames issued. A lobby appends '-' and its four digits.
const RELAY = 'wss://relay.js13kgames.com/unicorn-paparazzi';

// Our own id. The relay issues one on connect; the random stand-in only matters
// until that lands, and is what the local relay tool leaves us with.
let ME = Math.random().toString(36).slice(2, 6);

// Ids are strangers' text, so one length cap, applied everywhere an id enters --
// otherwise the roster and the results board could disagree about who someone is.
const key = (s) => s.slice(0, 8);

// A rival's breakdown is drawn as markup on the winner's card, so a rival
// controls bytes that reach innerHTML. Filtered to a whitelist rather than an
// escape list: whatever else is in it, what comes out can only be text. Length
// and row count are capped too, because a hostile peer chooses those as well.
//
// \u00d7 is the multiplication sign a bonus row uses and \u00b7 the dot that
// separates a detail row's label from its arithmetic; without them a rival's
// card would lose the punctuation your own keeps. Both are spelled as escapes,
// not as themselves: a non-ASCII byte inside a regex literal fails roadroller's
// round-trip check at pack time.
const clean = (v) => String(v == null ? '' : v).replace(/[^\w \u00d7\u00b7%+.-]/g, '').slice(0, 24);
const rows = (v) => (Array.isArray(v) ? v : []).slice(0, 16)
  .map((r) => [clean(r && r[0]), clean(r && r[1])]);

let ws = null;
const riders = new Map();          // id -> {n, p}, one result per rider per ride
const here = new Map();            // everyone in the lobby, id -> their name
const spent = new Set();           // ...and which of them have no film left
let myName = '';

// What to call a rider on screen. A relay id is unreadable, so four characters
// of it stand in until they tell us something better.
const nameOf = (i) => here.get(i) || 'rider ' + i.slice(0, 4);


export const online = () => !!ws && ws.readyState === 1;
export const others = () => [...riders.values()];
// Ready to draw. Your own row is your own name rather than "You!": in a lobby
// the useful thing is seeing that the name you typed took, and the results
// screen is where being told which one is you actually matters.
export const lobby = () => [...here.keys()].map(nameOf);
// Returns what it actually kept: the name goes straight into an HTML attribute
// on the way back out, so the caller must store the filtered one, not the typed
// one. clean() also caps the length, which is why the field needs no maxlength.
export const setName = (s) => {
  myName = clean(s);
  hello(1);
  return myName;
};
// Once nobody can take another photograph there is nothing left to ride for, so
// the ride can stop early. Empty means no lobby at all, which is not everyone
// being out of film -- it is a solo player, and they must never match this.
export const allSpent = () => here.size > 0 && spent.size >= here.size;

// onGo(seed) fires when the host starts the ride. onChange() fires whenever the
// roster or the results board moves, so whichever screen is up can redraw.
export function connect(code, name, onGo, onChange) {
  myName = clean(name);
  // Hopping to another code is a second connect, so the old room has to be let
  // go of first -- otherwise you would still be broadcasting into a lobby you
  // left, and still counting its riders as your own.
  close();
  try {
    // Served from localhost: talk to test/tools/relay.mjs, which rooms by path
    // the same way the real relay does. Webpack folds NODE_ENV in at build time,
    // so a production build sees `if (false && ...)` and terser takes the whole
    // branch out -- the local URL and the hostname regex are 25 bytes of the zip
    // that only the dev workflow ever needed.
    let url = RELAY + '-' + code;
    if (process.env.NODE_ENV !== 'production'
        && /^(localhost|127|\[?::1)/.test(location.hostname)) url = 'ws://localhost:1313/' + code;
    ws = new WebSocket(url);
  } catch (e) {
    return;                        // no socket, no lobby, still a game
  }
  ws.onmessage = (e) => {
    // The relay names us before anything else arrives, so this is the earliest
    // point at which we can say hello AS someone -- saying it on open would sign
    // the message with the stand-in id, and then '-id' would name a rider the
    // roster has no row for.
    if (e.data[0] === '@') {
      ME = e.data.slice(1);
      here.set(key(ME), myName);
      hello();
      return onChange();
    }
    // A rider who leaves comes off the roster and off the film tally, so nobody
    // waits on them. Their RESULT stays: they already finished, and their score
    // and photograph stand whether or not they are still connected. Dropping it
    // meant the first player to hit Rematch wiped their own card off everyone
    // else's results screen on the way out.
    if (e.data[0] === '-') {
      const i = key(e.data.slice(1));
      if (here.delete(i) | spent.delete(i)) onChange();
      return;
    }
    // Anything else is a stranger's text. Parse defensively and check the shape
    // before use -- a malformed payload must not throw inside a frame.
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (!m || m.i === ME) return;
    if (m.t === 'g' && typeof m.s === 'number') return onGo(m.s | 0);
    if (typeof m.i !== 'string') return;
    if (m.t === 'h') {
      // A hello always carries the sender's name, so it is the whole record:
      // presence and what to call them. "My roll is empty" rides along on it too
      // rather than earning a message type of its own.
      const h = key(m.i);
      here.set(h, clean(m.n));
      if (m.e) spent.add(h);
      // Answer an arrival so it learns about us, but never answer an answer.
      if (!m.r) hello(1);
    } else if (m.t === 'd' && typeof m.n === 'number') {
      const i = key(m.i);
      here.set(i, here.get(i) || '');    // a result is proof of presence
      // The name is captured here rather than looked up later, because a result
      // outlives the connection that sent it and the roster does not.
      riders.set(i, {
        who: nameOf(i),
        n: Math.max(0, m.n | 0),
        // A data: URL and nothing else, so a hostile payload cannot become markup
        // or point the browser at someone else's server.
        p: typeof m.p === 'string' && /^data:image\/jpeg;base64,[\w+/=]+$/.test(m.p) ? m.p : '',
        b: rows(m.b),
      });
    } else return;
    onChange();
  };
}

// Leaving the lobby: the socket goes, and with it the roster the host is
// counting. Without this, walking away leaves a ghost rider behind.
export function close() {
  if (ws) ws.close();
  ws = null;
  here.clear();
  riders.clear();
  spent.clear();
}

const send = (o) => { if (online()) try { ws.send(JSON.stringify(o)); } catch (e) { /* dropped */ } };

// Presence, and name. Every hello this side sends goes through here, so there is
// one place that decides what a hello says. `r` marks a reply, so it does not
// start an echo; `e` says the roll is empty. JSON.stringify drops an undefined
// field, which is what keeps all three shapes in the protocol comment above one
// call.
const hello = (r, e) => send({ t: 'h', i: ME, n: myName, r, e });

// Flagged as a reply so nobody answers it: this is news, not an arrival.
export const noFilm = () => {
  spent.add(key(ME));
  hello(1, 1);
};

export const go = (seed) => send({ t: 'g', s: seed });
export const done = (n, p, b) => send({ t: 'd', i: ME, n, p, b });
