// The js13k relay gives every URL path its own room, so the join code IS the room
// -- no filtering, and presence per lobby for free. Single player never connects.
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
// Optional by construction: every send is guarded, and no failure path reaches the
// frame loop -- a dead relay just means an empty lobby.

// The room prefix js13kgames issued. A lobby appends '-' and its four digits.
const RELAY = 'wss://relay.js13kgames.com/unicorn-paparazzi';

// Our own id. The relay issues one on connect; this stand-in covers until then.
let ME = Math.random().toString(36).slice(2, 6);

// Ids are strangers' text: one cap, applied everywhere an id enters, or the roster
// and the results board could disagree about who someone is.
const key = (s) => s.slice(0, 8);

// A rival's breakdown reaches innerHTML, so a rival controls those bytes.
// Whitelist, not an escape list: whatever goes in, what comes out is text. Length
// and row count are capped too, since a hostile peer picks those as well.
//
// \u00d7 (x) and \u00b7 (·) are the punctuation the breakdown rows use, spelled as
// escapes because a non-ASCII byte in a regex literal fails roadroller's
// round-trip check at pack time.
const clean = (v) => String(v == null ? '' : v).replace(/[^\w \u00d7\u00b7%+.-]/g, '').slice(0, 24);
const rows = (v) => (Array.isArray(v) ? v : []).slice(0, 16)
  .map((r) => [clean(r && r[0]), clean(r && r[1])]);

let ws = null;
const riders = new Map();          // id -> {n, p}, one result per rider per ride
const here = new Map();            // everyone in the lobby, id -> their name
const spent = new Set();           // ...and which of them have no film left
let myName = '';

// A relay id is unreadable, so four characters of it stand in until they say more.
const nameOf = (i) => here.get(i) || 'rider ' + i.slice(0, 4);


export const online = () => !!ws && ws.readyState === 1;
export const others = () => [...riders.values()];
// Your own lobby row is your typed name, not "You!" -- seeing it took is the
// useful thing here; the results screen is where "which one is me" matters.
export const lobby = () => [...here.keys()].map(nameOf);
// Returns what it KEPT: the name goes into an HTML attribute on the way back out,
// so the caller must store the filtered one. clean() caps length too, which is why
// the field needs no maxlength.
export const setName = (s) => {
  myName = clean(s);
  hello(1);
  return myName;
};
// Nothing left to ride for. An empty roster is a solo player, not everyone being
// out of film, and must never match.
export const allSpent = () => here.size > 0 && spent.size >= here.size;

// onGo(seed) fires when the host starts the ride. onChange() fires whenever the
// roster or the results board moves, so whichever screen is up can redraw.
export function connect(code, name, onGo, onChange) {
  myName = clean(name);
  // Hopping codes is a second connect, so let go of the old room first.
  close();
  try {
    // On localhost, talk to test/tools/relay.mjs instead. Webpack folds NODE_ENV in
    // at build time, so a production build sees `if (false && ...)` and terser
    // drops the whole branch -- 25 bytes only the dev workflow needed.
    let url = RELAY + '-' + code;
    if (process.env.NODE_ENV !== 'production'
        && /^(localhost|127|\[?::1)/.test(location.hostname)) url = 'ws://localhost:1313/' + code;
    ws = new WebSocket(url);
  } catch (e) {
    return;                        // no socket, no lobby, still a game
  }
  ws.onmessage = (e) => {
    // The earliest point we can say hello AS someone: saying it on open would sign
    // with the stand-in id, and '-id' would then name a rider with no row.
    if (e.data[0] === '@') {
      ME = e.data.slice(1);
      here.set(key(ME), myName);
      hello();
      return onChange();
    }
    // A leaver comes off the roster and the film tally so nobody waits on them.
    // Their RESULT stays -- dropping it meant the first to hit Rematch wiped their
    // own card off everyone else's results screen.
    if (e.data[0] === '-') {
      const i = key(e.data.slice(1));
      if (here.delete(i) | spent.delete(i)) onChange();
      return;
    }
    // A stranger's text: parse defensively, check the shape, never throw in a frame.
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (!m || m.i === ME) return;
    if (m.t === 'g' && typeof m.s === 'number') return onGo(m.s | 0);
    if (typeof m.i !== 'string') return;
    if (m.t === 'h') {
      // A hello is the whole record: presence, name, and whether their roll is out.
      const h = key(m.i);
      here.set(h, clean(m.n));
      if (m.e) spent.add(h);
      // Answer an arrival so it learns about us, but never answer an answer.
      if (!m.r) hello(1);
    } else if (m.t === 'd' && typeof m.n === 'number') {
      const i = key(m.i);
      here.set(i, here.get(i) || '');    // a result is proof of presence
      // Captured now, not looked up later: a result outlives the connection.
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

// Without this, walking away leaves a ghost rider on everyone else's roster.
export function close() {
  if (ws) ws.close();
  ws = null;
  here.clear();
  riders.clear();
  spent.clear();
}

const send = (o) => { if (online()) try { ws.send(JSON.stringify(o)); } catch (e) { /* dropped */ } };

// Every hello goes through here. `r` marks a reply so it does not start an echo;
// `e` says the roll is empty. JSON.stringify drops undefined fields, which is what
// keeps all three shapes above one call.
const hello = (r, e) => send({ t: 'h', i: ME, n: myName, r, e });

// Flagged as a reply so nobody answers it: this is news, not an arrival.
export const noFilm = () => {
  spent.add(key(ME));
  hello(1, 1);
};

export const go = (seed) => send({ t: 'g', s: seed });
export const done = (n, p, b) => send({ t: 'd', i: ME, n, p, b });
