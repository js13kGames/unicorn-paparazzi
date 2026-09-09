// A stand-in for the js13k relay: accept sockets, broadcast every message to
// everyone else in the same room. Dev only -- it never ships, it just lets a few
// browser windows share a lobby without leaning on the public room (and without
// an internet connection).
//
//   node test/tools/relay.mjs        then serve docs/ and open two windows
//
// It mirrors the real relay's shape as observed on the wire: the URL path is the
// room and rooms never see each other, there is no echo to the sender, and bare
// control frames surround the JSON traffic -- '@id' to name the socket on
// connect, '+id' when a rider arrives, '-id' when one leaves.
import { WebSocketServer } from 'ws';

const PORT = +process.argv[2] || 1313;
const wss = new WebSocketServer({ port: PORT });
let seq = 0;

const others = (ws) =>
  [...wss.clients].filter((c) => c !== ws && c.room === ws.room && c.readyState === 1);

wss.on('connection', (ws, req) => {
  const id = 'local' + (++seq);
  ws.room = req.url || '/';
  console.log('  + rider ' + id + ' joined ' + ws.room +
              '  (' + (others(ws).length + 1) + ' in the room)');
  ws.send('@' + id);
  for (const c of others(ws)) c.send('+' + id);
  ws.on('message', (data) => {
    const text = data.toString();
    console.log('  ' + id + ' ' + ws.room + ' -> ' + text.slice(0, 120) +
                (text.length > 120 ? '… (' + text.length + 'B)' : ''));
    for (const c of others(ws)) c.send(text);
  });
  ws.on('close', () => {
    console.log('  - rider ' + id + ' left ' + ws.room);
    for (const c of others(ws)) c.send('-' + id);
  });
});

console.log('relay listening on ws://localhost:' + PORT + '  (path = room)');
