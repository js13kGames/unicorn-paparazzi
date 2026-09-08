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
    getElementById(id) { touched.add(id); return node(id); },
    createElement: () => node('created'),
    addEventListener() {},
    exitPointerLock() {},
    pointerLockElement: null,
  },
  addEventListener() {},
  requestAnimationFrame() { return 0; },
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

let err = null;
const t0 = Date.now();
try {
  vm.runInNewContext(script, sandbox, { timeout: 60000 });
} catch (e) {
  err = e;
}
const ms = Date.now() - t0;

console.log('  elements resolved: ' + [...touched].sort().join(', '));
console.log('  load time (decode + worldgen, no GL): ' + ms + 'ms');

if (err && /WebGL2 required/.test(err.message)) {
  console.log('  reached the WebGL2 context call — everything before it ran clean');
  process.exit(0);
}
console.error('  UNEXPECTED: ' + (err ? err.stack : 'script completed without reaching GL'));
process.exit(1);
