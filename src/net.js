// The js13k relay is a dumb broadcast: one room for the whole game, every message
// reaches everyone else, no server logic and no authority. So this module is
// small on purpose -- it carries two messages and trusts nothing.
//
//   {t:'g', s:seed}                  someone started a lap
//   {t:'d', i:id, n:score, p:shot}   someone finished one
//
// Everything here is optional by construction. If the socket never opens, or the
// relay is down, or we are offline, the game plays exactly as it did before: every
// send is guarded and no failure path reaches the frame loop.

// TODO: paste the relay URL js13kgames issues for github.com/thbrown/js13k-2026.
// Until then only localhost play works, via test/tools/relay.mjs.
const RELAY = '';

// Our own id, so we can ignore our own traffic. The relay may or may not echo to
// the sender -- filtering here means both behaviours work.
const ME = Math.random().toString(36).slice(2, 6);

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
    if (!url) return;
    ws = new WebSocket(url);
  } catch (e) {
    return;                        // no socket, no multiplayer, still a game
  }
  ws.onmessage = (e) => {
    // Anything on the wire is a stranger's text. Parse defensively and check the
    // shape before use -- a malformed payload must not throw inside a frame.
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
