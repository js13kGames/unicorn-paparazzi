// A stand-in for the js13k relay: accept sockets, broadcast every message to
// everyone else. Dev only -- it never ships, it just lets two browser windows
// play a shared lap before the real relay URL exists.
//
//   node test/tools/relay.mjs        then serve docs/ and open two windows
//
// The real relay's echo behaviour is unknown, so this deliberately does NOT echo
// to the sender: src/net.js has to filter on its own id anyway, and testing
// against the stricter of the two shapes is the safer default.
import { WebSocketServer } from 'ws';

const PORT = +process.argv[2] || 1313;
const wss = new WebSocketServer({ port: PORT });
let seq = 0;

wss.on('connection', (ws) => {
  const id = ++seq;
  console.log('  + rider ' + id + '  (' + wss.clients.size + ' connected)');
  ws.on('message', (data) => {
    const text = data.toString();
    console.log('  ' + id + ' -> ' + text.slice(0, 120) + (text.length > 120 ? '… (' + text.length + 'B)' : ''));
    for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(text);
  });
  ws.on('close', () => console.log('  - rider ' + id + '  (' + wss.clients.size + ' connected)'));
});

console.log('relay listening on ws://localhost:' + PORT);
