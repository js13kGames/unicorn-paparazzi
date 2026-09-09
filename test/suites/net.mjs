// The relay is a public broadcast channel, so every message this module reads was
// written by a stranger. These checks are mostly about what it REFUSES: malformed
// JSON, wrong types, a shot that is not actually an image, and its own echo.
//
// Nothing here touches a real socket. A fake WebSocket stands in, so the whole
// protocol can be driven synchronously.

const sent = [];
let sock = null;
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; sock = this; }
  send(s) { sent.push(s); }
}
globalThis.WebSocket = FakeSocket;
globalThis.location = { hostname: 'localhost' };

const net = await import('../.mirror/net.mjs');

let fails = 0;
const check = (name, got, want = true) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(58), ok ? '' : '-> ' + JSON.stringify(got));
};

const gone = [], dones = [];
net.connect((s) => gone.push(s), () => dones.push(1));
const deliver = (data) => sock.onmessage({ data });

check('a localhost page talks to the local relay tool', /localhost:1313/.test(sock.url));
check('and reports itself online', net.online());

// Our own id is private, so read it off the wire and echo it back.
net.done(500, 'data:image/jpeg;base64,abc');
const ME = JSON.parse(sent[0]).i;
check('done() puts our id on the wire', typeof ME === 'string' && ME.length > 0);
deliver(sent[0]);
check('our own echo is ignored', net.others().length, 0);

// --- what it refuses ---
for (const junk of ['', 'not json', '{', 'null', '[]', '{"t":"g"}', '{"t":"g","s":"4242"}',
                    '{"t":"d","i":"bob"}', '{"t":"d","n":5}', '{"t":"d","i":7,"n":5}']) {
  deliver(junk);
}
check('malformed and wrong-typed payloads are all dropped', gone.length === 0 && net.others().length === 0);

// --- what it accepts ---
deliver('{"t":"g","s":4242}');
check('a seed announcement is passed through', gone, (g) => g.length === 1 && g[0] === 4242);
deliver('{"t":"g","s":99.7}');
check('and a fractional seed is coerced to an int', gone[1], 99);

deliver('{"t":"d","i":"bob","n":1200,"p":"data:image/jpeg;base64,AAaa09+/="}');
check('a result is recorded', net.others(), (o) => o.length === 1 && o[0].i === 'bob' && o[0].n === 1200);
check('and it carries the shot', net.others()[0].p, (p) => p.startsWith('data:image/jpeg;base64,'));
check('the scoreboard callback fired', dones.length, 1);

// A rival cannot smuggle markup or a foreign URL in through the image field.
deliver('{"t":"d","i":"eve","n":1,"p":"<img onerror=alert(1)>"}');
deliver('{"t":"d","i":"mal","n":1,"p":"https://example.com/x.jpg"}');
const bad = net.others().filter((o) => o.i === 'eve' || o.i === 'mal');
check('a shot that is not a jpeg data url is stripped', bad, (b) => b.length === 2 && b.every((o) => o.p === ''));

deliver('{"t":"d","i":"cheat","n":-50}');
check('a negative score cannot drag the board below zero',
      net.others().find((o) => o.i === 'cheat').n, 0);
deliver('{"t":"d","i":"aaaaaaaaaaaaaaaaaaaaaaaa","n":5}');
check('an absurdly long id is truncated', net.others().some((o) => o.i.length === 8));

// One entry per rider per lap, however many times they shout.
const before = net.others().length;
deliver('{"t":"d","i":"bob","n":9999}');
check('a rider repeating themselves does not appear twice', net.others().length, before);
check('but their score does update', net.others().find((o) => o.i === 'bob').n, 9999);

// --- the relay's own control frames ---
// These are bare strings, not JSON, and they arrive interleaved with the traffic.
const board = net.others().length;
deliver('+someone-else');
check('a rider arriving is not mistaken for a result', net.others().length, board);
deliver('@relay-issued-id');
net.done(10, '');
check('the relay-issued id replaces our stand-in on the wire',
      JSON.parse(sent[sent.length - 1]).i, 'relay-issued-id');

deliver('{"t":"d","i":"leaver-and-then-some","n":300}');
check('a rider is on the board before they leave',
      net.others().some((o) => o.i === 'leaver-a'), true);
deliver('-leaver-and-then-some');
check('and leaving takes their row off it',
      net.others().some((o) => o.i === 'leaver-a'), false);
const quiet = dones.length;
deliver('-nobody-we-ever-heard-of');
check('a stranger leaving does not redraw the board', dones.length, quiet);

// No forget() to test: every lap transition is a page reload, so the board cannot
// outlive the lap that filled it.

// --- the offline path ---
sock.readyState = 3;
check('a closed socket reports offline', net.online(), false);
const n = sent.length;
net.go(1);
net.done(1, '');
check('and sending on it is a no-op rather than a throw', sent.length, n);

globalThis.WebSocket = class { constructor() { throw new Error('blocked'); } };
let threw = false;
try { net.connect(() => {}, () => {}); } catch (e) { threw = true; }
check('a socket that cannot even be constructed does not break the game', threw, false);
check('and the game reports itself offline', net.online(), false);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
