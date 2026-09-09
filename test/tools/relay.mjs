// A stand-in for the js13k relay: accept sockets, broadcast every message to
// everyone else. Dev only -- it never ships, it just lets two browser windows
// play a shared lap before the real relay URL exists.
//
//   node test/tools/relay.mjs        then serve docs/ and open two windows
//
// It mirrors the real relay's shape as observed on the wire: no echo to the
// sender, and bare control frames around the JSON traffic -- '@id' to name the
// socket on connect, '+id' when a rider arrives, '-id' when one leaves.
import { WebSocketServer } from 'ws';

const PORT = +process.argv[2] || 1313;
const wss = new WebSocketServer({ port: PORT });
let seq = 0;

const others = (ws) => [...wss.clients].filter((c) => c !== ws && c.readyState === 1);

wss.on('connection', (ws) => {
  const id = 'local' + (++seq);
  console.log('  + rider ' + id + '  (' + wss.clients.size + ' connected)');
  ws.send('@' + id);
  for (const c of others(ws)) c.send('+' + id);
  ws.on('message', (data) => {
    const text = data.toString();
    console.log('  ' + id + ' -> ' + text.slice(0, 120) + (text.length > 120 ? '… (' + text.length + 'B)' : ''));
    for (const c of others(ws)) c.send(text);
  });
  ws.on('close', () => {
    console.log('  - rider ' + id + '  (' + wss.clients.size + ' connected)');
    for (const c of others(ws)) c.send('-' + id);
  });
});

console.log('relay listening on ws://localhost:' + PORT);
