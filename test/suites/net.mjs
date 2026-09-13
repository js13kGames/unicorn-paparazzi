// The relay is a public broadcast channel, so every message this module reads was
// written by a stranger. These checks are mostly about what it REFUSES: malformed
// JSON, wrong types, a shot that is not actually an image, and its own echo.
//
// Nothing here touches a real socket. A fake WebSocket stands in, so the whole
// protocol can be driven synchronously.

const sent = [];
let closed = 0;
let sock = null;
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; sock = this; }
  send(s) { sent.push(s); }
  close() { this.readyState = 3; closed++; }
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

const gone = [], changes = [];
net.connect('4821', 'Ada', (s) => gone.push(s), () => changes.push(1));
const deliver = (data) => sock.onmessage({ data });
const last = () => JSON.parse(sent[sent.length - 1]);

check('the join code is the room the socket opens', /localhost:1313\/4821$/.test(sock.url));
check('and it reports itself online', net.online());

// --- the handshake -------------------------------------------------------
// The relay names the connection before anything else reaches us. That is the
// earliest moment we can say hello AS someone, so it is when the hello goes out.
check('nothing is said before the relay names us', sent.length, 0);
deliver('@relay-issued-id');
check('being named puts us on our own roster', net.lobby(), (l) => l.length === 1);
check('and sends a hello signed with the issued id', last(), (m) => m.t === 'h' && m.i === 'relay-issued-id');
check('which is not flagged as a reply, so others answer it', !('r' in last()));

// A rider already in the room answers our hello. Their answer must not be
// answered in turn, or two clients would talk forever.
let n = sent.length;
deliver('{"t":"h","i":"early-bird","r":1}');
check('a rider already here joins the roster', net.lobby(), (l) => l.includes('rider earl'));
check('and their reply is not replied to', sent.length, n);

// Someone arriving after us says hello unprompted; that one we do answer.
deliver('{"t":"h","i":"latecomer"}');
check('a rider arriving later joins the roster too', net.lobby(), (l) => l.length === 3);
check('and is told we are here', last(), (m) => m.t === 'h' && m.r === 1);

// '+id' is redundant -- the arriving rider says hello for itself -- so it is left
// to fall through the parse and be dropped.
n = net.lobby().length;
deliver('+someone-else');
check('the relay arrival frame is ignored as redundant', net.lobby().length, n);

// --- what it refuses -----------------------------------------------------
for (const junk of ['', 'not json', '{', 'null', '[]', '{"t":"g"}', '{"t":"g","s":"4242"}',
                    '{"t":"h"}', '{"t":"h","i":7}', '{"t":"d","i":"bob"}',
                    '{"t":"d","n":5}', '{"t":"d","i":7,"n":5}']) {
  deliver(junk);
}
check('malformed and wrong-typed payloads are all dropped',
      gone.length === 0 && net.others().length === 0 && net.lobby().length === 3);

// --- what it accepts -----------------------------------------------------
deliver('{"t":"g","s":4242}');
check('the host starting the ride is passed through', gone, (g) => g.length === 1 && g[0] === 4242);
deliver('{"t":"g","s":99.7}');
check('and a fractional seed is coerced to an int', gone[1], 99);

const seenChanges = changes.length;
deliver('{"t":"d","i":"bob","n":1200,"p":"data:image/jpeg;base64,AAaa09+/="}');
check('a result is recorded', net.others(), (o) => o.length === 1 && o[0].n === 1200);
check('and it carries the shot', net.others()[0].p, (p) => p.startsWith('data:image/jpeg;base64,'));
check('a result is proof of presence, so it fills the roster too',
      net.lobby(), (l) => l.includes('rider bob'));
check('and the screen is told to redraw', changes.length > seenChanges);

// A rival cannot smuggle markup or a foreign URL in through the image field.
deliver('{"t":"d","i":"eve","n":1,"p":"<img onerror=alert(1)>"}');
deliver('{"t":"d","i":"mal","n":1,"p":"https://example.com/x.jpg"}');
const bad = net.others().filter((o) => o.who === 'rider eve' || o.who === 'rider mal');
check('a shot that is not a jpeg data url is stripped', bad, (b) => b.length === 2 && b.every((o) => o.p === ''));

// --- the breakdown is markup, and a rival writes it ----------------------
// It goes onto the winner's card as HTML, so it is the most dangerous thing on
// this wire. Every one of these has to come back inert.
deliver('{"t":"d","i":"eve2","n":1,"b":[["<img onerror=alert(1)>","<b>9</b>"]]}');
const evil = net.others().find((o) => o.who === 'rider eve2').b;
check('markup in a breakdown label is stripped to text',
      evil[0], (r) => !r[0].includes('<') && !r[0].includes('>') && !r[1].includes('<'));
check('and what survives is only whitelisted characters',
      evil.every((r) => r.every((c) => /^[\w ×%+.-]*$/.test(c))));

deliver('{"t":"d","i":"quot","n":1,"b":[["a\\" onload=\\"x","1"]]}');
check('a quote cannot break out of the attribute it lands next to',
      net.others().find((o) => o.who === 'rider quot').b[0][0].includes('"'), false);

const many = JSON.stringify(Array.from({ length: 9000 }, () => ['x', '1']));
deliver('{"t":"d","i":"flood","n":1,"b":' + many + '}');
check('a flood of rows is capped', net.others().find((o) => o.who === 'rider floo').b.length, 16);

deliver('{"t":"d","i":"longy","n":1,"b":[["' + 'a'.repeat(5000) + '","1"]]}');
check('an enormous label is truncated',
      net.others().find((o) => o.who === 'rider long').b[0][0].length, 24);

// Wrong types must not throw inside a frame -- this runs on the message path.
for (const junk of ['"nope"', '5', 'null', '[1,2,3]', '[[]]', '[null]', '[{"a":1}]']) {
  deliver('{"t":"d","i":"junk","n":1,"b":' + junk + '}');
  const b = net.others().find((o) => o.who === 'rider junk').b;
  check('a breakdown of ' + junk + ' becomes a safe list',
        Array.isArray(b) && b.every((r) => r.length === 2 && r.every((c) => typeof c === 'string')));
}

// The real breakdown score.js writes, character for character. Percentages
// arrived here late: the size row and the framing row are both written with one,
// and a whitelist that dropped it turned "8.5% × 1000dpi" into "8.5 × 1000dpi"
// and "×111%" into "×111" on every rival's card.
deliver('{"t":"d","i":"good","n":1,"b":[["azure rearing","380"],' +
        '[" 8.5% × 1000dpi","+300"],[" bicorn","×2"],["framing","×111%"]]}');
check('an honest breakdown survives intact',
      JSON.stringify(net.others().find((o) => o.who === 'rider good').b),
      '[["azure rearing","380"],[" 8.5% × 1000dpi","+300"],' +
      '[" bicorn","×2"],["framing","×111%"]]');

deliver('{"t":"d","i":"cheat","n":-50}');
check('a result with no breakdown at all still lands',
      net.others().find((o) => o.who === 'rider chea').b, (b) => Array.isArray(b) && b.length === 0);
check('a negative score cannot drag the board below zero',
      net.others().find((o) => o.who === 'rider chea').n, 0);
deliver('{"t":"d","i":"aaaaaaaaaaaaaaaaaaaaaaaa","n":5}');
check('an absurdly long id is truncated into a name',
      net.others().some((o) => o.who === 'rider aaaa'));

// One entry per rider per ride, however many times they shout.
const before = net.others().length;
deliver('{"t":"d","i":"bob","n":9999}');
check('a rider repeating themselves does not appear twice', net.others().length, before);
check('but their score does update', net.others().find((o) => o.who === 'rider bob').n, 9999);

// --- leaving -------------------------------------------------------------
// The one control frame we cannot do without: nothing else tells us a rider is
// gone, and a results screen that waits on them would never stop waiting.
check('the leaver is on both the roster and the board',
      net.lobby().includes('rider bob') && net.others().some((o) => o.n === 9999));
n = changes.length;
deliver('-bob');
check('leaving clears their roster row', net.lobby(), (l) => !l.includes('rider bob'));
// But NOT their result. They already finished; the score and the photograph
// stand whether or not they are still connected. Dropping it meant the first
// player to hit Rematch wiped their own card off everyone else's screen.
check('while their finished result stands',
      net.others(), (o) => o.some((r) => r.n === 9999 && r.who === 'rider bob'));
check('and redraws whatever screen is up', changes.length > n);
n = changes.length;
deliver('-nobody-we-ever-heard-of');
check('a stranger leaving changes nothing', changes.length, n);

// The ids the truncation produces have to agree across every source, or a
// leaver could never be matched to the rows they left behind.
deliver('{"t":"h","i":"aaaaaaaaaaaaaaaaaaaaaaaa"}');
check('a long id is truncated on the roster too',
      net.lobby().includes('rider aaaa'), true);
deliver('-aaaaaaaaaaaaaaaaaaaaaaaa');
check('and truncates the same way coming and going',
      net.lobby().includes('rider aaaa'), false);

// No forget() to test: every ride transition is a page reload, so the board cannot
// outlive the ride that filled it.

// --- running out of film -------------------------------------------------
// Once nobody can take another photograph there is nothing left to ride for.
// "My roll is empty" rides on the hello rather than earning a message type of
// its own, so what matters is that the flag is read and the tally is right.
//
// Its own room, because the tally is over the WHOLE roster and the room above
// has collected a crowd. A fresh one keeps the arithmetic legible.
const film = await import('../.mirror/net.mjs?film');
film.connect('9999', 'Ann', () => {}, () => {});
const filmSock = sock;
const toFilm = (d) => filmSock.onmessage({ data: d });
toFilm('@ann-id');
toFilm('{"t":"h","i":"bo-id"}');
toFilm('{"t":"h","i":"cy-id"}');
check('three riders, all with film', film.lobby().length === 3 && !film.allSpent());

toFilm('{"t":"h","i":"bo-id","r":1,"e":1}');
check('one rider out of film is not everyone', film.allSpent(), false);
toFilm('{"t":"h","i":"cy-id","r":1,"e":1}');
check('every rival being out is still not everyone', film.allSpent(), false);
film.noFilm();
check('our own roll running dry is what completes it', film.allSpent(), true);
check('and it goes out flagged so nobody answers it',
      JSON.parse(sent[sent.length - 1]), (m) => m.e === 1 && m.r === 1);

// A rider who leaves shrinks the roster. If they were not taken off the spent
// tally too, the count would pass while someone still had film.
toFilm('{"t":"h","i":"de-id"}');
check('a rider arriving with film reopens the room', film.allSpent(), false);
toFilm('-de-id');
check('and their leaving settles it again', film.allSpent(), true);

// The subtle one: when the rider who leaves was themselves out of film, both
// tallies have to drop. Taking them off the roster alone would leave their name
// in the spent count, and the room would read as finished while someone was
// still shooting.
toFilm('{"t":"h","i":"quitter","r":1,"e":1}');   // here, and out of film
toFilm('{"t":"h","i":"shooter"}');               // here, still has film
check('one rider with film left holds the room open', film.allSpent(), false);
toFilm('-quitter');
check('a rider who was out of film leaving does not close it', film.allSpent(), false);
toFilm('-shooter');
check('only the last rider with film leaving closes it', film.allSpent(), true);

// The dangerous empty case: a solo player has no lobby at all, and 0 >= 0 must
// not read as "everyone is out of film" or their ride would end on the first shot.
const solo = await import('../.mirror/net.mjs?solo');
check('a player with no lobby is never spent', solo.allSpent(), false);

// --- hopping to another lobby --------------------------------------------
// Joining a different code is just another connect. The old room has to be let
// go of, or you would keep broadcasting into a lobby you left and keep counting
// its riders in the one you joined.
check('there is something on the board before the hop',
      net.lobby().length > 0 && net.others().length > 0);
const wasClosed = closed;
net.connect('1234', '', () => {}, () => {});
check('the old room is closed', closed, wasClosed + 1);
check('the new socket is the new room', /\/1234$/.test(sock.url));
check('and neither its roster nor its board carries anyone over',
      net.lobby().length === 0 && net.others().length === 0);

// --- the offline path ----------------------------------------------------
sock.readyState = 3;
check('a closed socket reports offline', net.online(), false);
n = sent.length;
net.go(1);
net.done(1, '');
check('and sending on it is a no-op rather than a throw', sent.length, n);

globalThis.WebSocket = class { constructor() { throw new Error('blocked'); } };
let threw = false;
try { net.connect('1234', '', () => {}, () => {}); } catch (e) { threw = true; }
check('a socket that cannot even be constructed does not break the game', threw, false);
check('and the game reports itself offline', net.online(), false);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
