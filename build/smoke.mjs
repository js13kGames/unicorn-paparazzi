// Executes the shipped page's script in a stubbed DOM. There is no GL here, so
// success is defined as reaching the WebGL2 context call and failing there --
// that proves the packed blob decodes, evaluates, finds its DOM elements, and
// gets all the way through world generation and herd spawning first.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'dist', 'index.html'), 'utf8');
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));

// The page now builds its own DOM: the bootstrap injects the CSS and markup
// before the bundle runs. So getElementById only answers for ids the bootstrap
// actually created -- otherwise this test would pass even with a broken fold.
const injected = new Set();
const missing = new Set();
const touched = new Set();
const node = (id) => ({
  id, style: {}, className: '', textContent: '', innerHTML: '', width: 0, height: 0,
  addEventListener() {}, requestPointerLock() {}, appendChild() {},
  getContext() { return null; },                 // no GL in Node
  toDataURL() { return 'data:,'; },
  drawImage() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }),
});

const sandbox = {
  console,
  performance,
  Math, Date, JSON, Map, Set, Promise, Uint8Array, Uint16Array, Uint32Array,
  Int8Array, Float32Array, ArrayBuffer, String, Number, Object, Array, Error,
  document: {
    head: {
      insertAdjacentHTML(_, html) { collectIds(html); },
    },
    body: {
      set innerHTML(html) { collectIds(html); },
      get innerHTML() { return ''; },
    },
    getElementById(id) {
      touched.add(id);
      if (!injected.has(id)) { missing.add(id); return null; }
      return node(id);
    },
    createElement: () => node('created'),
    addEventListener() {},
    exitPointerLock() {},
    pointerLockElement: null,
  },
  addEventListener() {},
  requestAnimationFrame() { return 0; },
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  location: { hash: '', reload() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

function collectIds(html) {
  for (const m of String(html).matchAll(/id=["']?([\w-]+)/g)) injected.add(m[1]);
}

let err = null;
const t0 = Date.now();
try {
  vm.runInNewContext(script, sandbox, { timeout: 60000 });
} catch (e) {
  err = e;
}
const ms = Date.now() - t0;

console.log('  ids injected by the bootstrap: ' + [...injected].sort().join(', '));
console.log('  ids looked up by the game:   ' + [...touched].sort().join(', '));
console.log('  load time (decode + worldgen, no GL): ' + ms + 'ms');

if (missing.size) {
  console.error('\n  MISSING: the game asked for ' + [...missing].sort().join(', ') +
    ' but the bootstrap never created ' + (missing.size > 1 ? 'them' : 'it'));
  process.exit(1);
}
if (!injected.size) {
  console.error('\n  MISSING: the bootstrap injected no markup at all');
  process.exit(1);
}

if (err && /no gl/.test(err.message)) {
  console.log('  reached the WebGL2 context call — everything before it ran clean');
  process.exit(0);
}
console.error('  UNEXPECTED: ' + (err ? err.stack : 'script completed without reaching GL'));
process.exit(1);
