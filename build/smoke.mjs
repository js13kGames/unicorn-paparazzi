// Executes the shipped page's script in a stubbed DOM, with a stub standing in
// for WebGL2 as well, so the whole module runs: decode, evaluate, find its DOM
// elements, generate the world, spawn the herd, build both programs, size the
// canvas and draw the title card. Success is reaching the end of it with nothing
// thrown.
//
// It stops there. Nothing here renders a pixel, and requestAnimationFrame never
// calls back, so this says nothing about what the frame looks like -- it is the
// guard for the class of failure that kills the page before it can look like
// anything at all. It exists because a `let` declared below a function that runs
// during module evaluation shipped once: the read throws, the page is blank, and
// the old version of this file stopped at the GL call just above the damage.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import glConsts from './gl-consts.cjs';

const { ENUMS } = glConsts;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'dist', 'index.html'), 'utf8');
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));

// The page now builds its own DOM: the bootstrap injects the CSS and markup
// before the bundle runs. So getElementById only answers for ids the bootstrap
// actually created -- otherwise this test would pass even with a broken fold.
const injected = new Set();
const missing = new Set();
const touched = new Set();
// WebGL2, near enough to get through gl.js: SCREAMING_CASE is a constant, and
// everything else is a method that does nothing, except the handful gl.js reads
// an answer back from.
//
// The constants have to be the REAL spec numbers, from the same table the
// build rewrites the source with: build/gl-consts.cjs turns `gl.ACTIVE_UNIFORMS`
// into `35718` before it ever reaches this stub, so a stub that invented its own
// numbering could no longer tell the two getProgramParameter questions apart.
const glStub = new Proxy({}, {
  get(_, k) {
    if (typeof k !== 'string') return undefined;
    if (/^[A-Z][A-Z0-9_]*$/.test(k)) return ENUMS[k];
    return (...a) => {
      // A link that failed throws; a program with no active uniforms simply
      // leaves p.u empty, and every later uniform write lands on undefined.
      if (k === 'getProgramParameter') return a[1] === ENUMS.ACTIVE_UNIFORMS ? 0 : 1;
      if (k === 'getShaderParameter') return 1;
      if (k === 'getAttribLocation' || k === 'getUniformLocation') return 0;
      if (k.startsWith('create')) return {};
      return undefined;
    };
  },
});

// The photo rig's thumbnail canvases want a 2D context, which does no more here
// than accept the calls.
const ctx2d = new Proxy({}, { get: () => () => undefined });

const node = (id) => ({
  id, style: {}, className: '', textContent: '', innerHTML: '', width: 0, height: 0,
  addEventListener() {}, requestPointerLock() {}, appendChild() {},
  getContext(type) { return type === '2d' ? ctx2d : glStub; },
  toDataURL() { return 'data:,'; },
  drawImage() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }),
});

const sandbox = {
  console,
  performance,
  Math, Date, JSON, Map, Set, Promise, Uint8Array, Uint16Array, Uint32Array,
  Int8Array, Float32Array, ArrayBuffer, String, Number, Object, Array, Error,
  Proxy, Reflect, matchMedia: () => ({ matches: false }),
  // A desktop browser with no headset: the title card asks `navigator.xr` whether
  // to offer the VR button, and a phone asks matchMedia whether it is a phone.
  navigator: {},
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

if (err) {
  console.error('\n  THREW during module evaluation: ' + err.stack);
  process.exit(1);
}
console.log('  the whole module initialised: world, herd, both GL programs, the title card');
process.exit(0);
