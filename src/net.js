// The js13k relay is a dumb broadcast: one room per entry (the URL path), every
// message reaches everyone else but never the sender, no server logic and no
// authority. So this module is small on purpose -- two messages, trusting nothing.
//
//   {t:'g', s:seed}                  someone started a lap
//   {t:'d', i:id, n:score, p:shot}   someone finished one
//
// The relay interleaves its own control frames, which are bare strings rather than
// JSON: '@id' is the id it gave us, '+id' a rider arriving, '-id' one leaving. Only
// the last matters to us, and JSON.parse rejects the rest for free.
//
// Everything here is optional by construction. If the socket never opens, or the
// relay is down, or we are offline, the game plays exactly as it did before: every
// send is guarded and no failure path reaches the frame loop.

// The relay room js13kgames issues per entry. Everyone who loads the page joins it.
// Local play uses test/tools/relay.mjs instead -- see connect().
const RELAY = 'wss://relay.js13kgames.com/unicorn-paparazzi';

// Our own id, so we can ignore our own traffic and so a '-id' frame names a rider
// we actually have a row for. The relay hands us one on connect; until it does we
// use a random stand-in, which is also what the local relay tool leaves us with.
let ME = Math.random().toString(36).slice(2, 6);

let ws = null;
const riders = new Map();          // id -> {n, p}, one entry per rider per lap

export const online = () => !!ws && ws.readyState === 1;
export const others = () => [...riders].map(([i, r]) => ({ i, ...r }));

// onGo(seed) fires when someone else starts a lap; the caller decides whether to
// adopt it, because only an idle player should be pulled into a new seed.
// onDone() fires when a rival's result lands, so a visible scoreboard can refresh.
export function connect(onGo, onDone) {
  try {
    // Served from a file or localhost: talk to test/tools/relay.mjs instead.
    const url = /^(localhost|127|\[?::1)/.test(location.hostname)
      ? 'ws://localhost:1313' : RELAY;
    ws = new WebSocket(url);
  } catch (e) {
    return;                        // no socket, no multiplayer, still a game
  }
  ws.onmessage = (e) => {
    // Anything on the wire is a stranger's text. Parse defensively and check the
    // shape before use -- a malformed payload must not throw inside a frame.
    // The relay's control frames come first: it names us, and it tells us when a
    // rider leaves so their row can come off the board. '+id' needs nothing -- an
    // arriving rider has no score yet -- and falls through to the parse below.
    if (e.data[0] === '@') { ME = e.data.slice(1); return; }
    if (e.data[0] === '-') { if (riders.delete(e.data.slice(1, 9))) onDone(); return; }
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (!m || m.i === ME) return;
    if (m.t === 'g' && typeof m.s === 'number') onGo(m.s | 0);
    else if (m.t === 'd' && typeof m.i === 'string' && typeof m.n === 'number') {
      riders.set(m.i.slice(0, 8), {
        n: Math.max(0, m.n | 0),
        // A data: URL and nothing else, so a hostile payload cannot become markup
        // or point the browser at someone else's server.
        p: typeof m.p === 'string' && /^data:image\/jpeg;base64,[\w+/=]+$/.test(m.p) ? m.p : '',
      });
      onDone();
    }
  };
}

const send = (o) => { if (online()) try { ws.send(JSON.stringify(o)); } catch (e) { /* dropped */ } };

export const go = (seed) => send({ t: 'g', s: seed });
export const done = (n, p) => send({ t: 'd', i: ME, n, p });
