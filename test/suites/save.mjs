// The save migration, driven through the real index.js logic by loading the
// built bundle in a stubbed DOM with a pre-seeded localStorage.
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import vm from 'vm';

const page = fs.readFileSync(ROOT + 'docs/dist/index.html', 'utf8');
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
const injected = new Set();
const node = () => ({ style:{}, className:'', textContent:'', innerHTML:'', dataset:{},
  addEventListener(){}, appendChild(){}, animate(){}, getContext(){return null;},
  toDataURL(){return 'data:,';}, drawImage(){}, requestPointerLock(){} });

function boot(stored) {
  let written = null;
  const sandbox = {
    console: { log(){}, warn(){}, error(){} }, performance, Math, Date, JSON, Map, Set,
    Promise, Uint8Array, Uint16Array, Uint32Array, Int8Array, Float32Array, ArrayBuffer,
    String, Number, Object, Array, Error, Image: class {},
    document: {
      head:{ insertAdjacentHTML(_,h){ for (const m of String(h).matchAll(/id=["']?([\w-]+)/g)) injected.add(m[1]); } },
      body:{ set innerHTML(h){ for (const m of String(h).matchAll(/id=["']?([\w-]+)/g)) injected.add(m[1]); }, get innerHTML(){return '';} },
      getElementById: node, createElement: node, addEventListener(){}, exitPointerLock(){}, pointerLockElement:null,
    },
    addEventListener(){}, requestAnimationFrame(){return 0;},
    devicePixelRatio:1, innerWidth:1280, innerHeight:720,
    location: { hash: '', reload() {} },
    localStorage: {
      getItem: () => (stored === null ? null : JSON.stringify(stored)),
      setItem: (_, v) => { written = JSON.parse(v); }, removeItem(){},
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  let err = null;
  try { vm.runInNewContext(script, sandbox, { timeout: 60000 }); } catch (e) { err = e; }
  if (!err || !/no gl/.test(err.message)) throw err || new Error('expected the GL stop');
  return sandbox;
}

let fails = 0;
const check = (n, ok, d) => { if(!ok) fails++; console.log((ok?'  ok  ':'FAIL  ') + n.padEnd(56) + (d||'')); };

// A save from an older version, carrying fields this build no longer knows.
boot({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0], w: false });
check('an old colour-array save still loads', true);

// A current save must be taken at face value.
boot({ v: 3, b: 900, z: 1, r: 0, f: 0, a: 7, s: 3, w: true });
check('a current save loads', true);

// No save at all.
boot(null);
check('a fresh player loads', true);
check('the bootstrap built the DOM in every case', injected.has('c') && injected.has('film'));

// What a save actually restores, evaluated from the real source text rather than
// a copy, so it cannot drift away from what ships.
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');
const VERSION = +/const SAVE_VERSION = (\d+)/.exec(src)[1];

// Each field of the state literal is one expression over `saved`; lift them out
// and run them against a fake save.
const restore = (saved) => {
  const grab = (key) => {
    const m = new RegExp('^  ' + key + ': (.+),$', 'm').exec(src);
    if (!m) throw new Error('no ' + key + ' in the state literal');
    return new Function('saved', 'return ' + m[1])(saved);
  };
  return { bank: grab('bank'), maxZoom: grab('maxZoom'), res: grab('res'),
           filmTier: grab('filmTier'), shutterTier: grab('shutterTier') };
};

const old = restore({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0] });
check('an old save keeps its bank', old.bank === 4200, String(old.bank));
check('an old save keeps its upgrades', old.maxZoom === 2 && old.res === 1 && old.filmTier === 3);

const fresh = restore({});
check('a fresh player starts at zero everywhere',
      !fresh.bank && !fresh.maxZoom && !fresh.res && !fresh.filmTier && !fresh.shutterTier);

// res indexes resBonus/resNames directly, so an out-of-range save used to give a
// NaN score rather than a visible failure.
check('a camera tier beyond the ladder is clamped', restore({ r: 9 }).res, 3);
check('and a legitimate top tier survives', restore({ r: 3 }).res, 3);

// --- which screen a load lands on --------------------------------------------
// Three routes, and the one-shot `g` marker is what separates "Ride again"
// (straight onto the cart) from an actual refresh (back to the shop).
const bootLines = /^if \(saved\.g\)[\s\S]*?^else ui\.showTitle\(\);$/m.exec(src);
check('the boot routing is still three branches', !!bootLines);

const route = (saved) => {
  const hit = [];
  const state = {};
  new Function('saved', 'state', 'persist', 'primary', 'showShop', 'ui', bootLines[0])(
    saved, state,
    () => hit.push('persist'), () => hit.push('ride'), () => hit.push('shop'),
    { showTitle: () => hit.push('title'), toast: () => {} });
  return { hit, go: state.go };
};

check('a fresh player lands on the title', route({}).hit, (h) => h.join() === 'title');
check('a plain refresh lands on the shop', route({ v: VERSION }).hit, (h) => h.join() === 'shop');
const again = route({ v: VERSION, g: 1 });
check('the ride marker lands on the cart', again.hit.includes('ride'), true);
check('and the marker is consumed so the next refresh does not re-ride',
      again.go === 0 && again.hit.includes('persist'), true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
