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

// A save from the colour-lure era: seven-element arrays, old version.
boot({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0], w: false });
check('an old colour-array save still loads', true);

// A current save must be taken at face value.
boot({ v: 3, b: 900, z: 1, r: 0, f: 0, a: 7, s: 3, w: true });
check('a current save loads', true);

// No save at all.
boot(null);
check('a fresh player loads', true);
check('the bootstrap built the DOM in every case', injected.has('c') && injected.has('film'));

// The migration itself, evaluated from the real source text rather than a copy,
// so it cannot drift away from what ships.
const src = fs.readFileSync(ROOT + 'src/index.js', 'utf8');
const VERSION = +/const SAVE_VERSION = (\d+)/.exec(src)[1];
const stockSrc = /const stock = ([\s\S]*?);\n/.exec(src)[1];
const starters = /weak: stock\(saved\.a, (\d+)\),\s*strong: stock\(saved\.s, (\d+)\)/.exec(src);
const [, W0, S0] = starters.map(Number);

const migrate = (saved) => {
  const stock = new Function('saved', 'SAVE_VERSION', 'return ' + stockSrc)(saved, VERSION);
  return { weak: stock(saved.a, W0), strong: stock(saved.s, S0),
           bank: saved.b || 0, zoom: saved.z || 0, res: saved.r || 0, film: saved.f || 0 };
};

const old = migrate({ v: 2, b: 4200, z: 2, r: 1, f: 3, a: [0,0,0,0,0,0,0], p: [0,0,0,0,0,0,0] });
check('an old save keeps its bank', old.bank === 4200, String(old.bank));
check('an old save keeps its upgrades', old.zoom === 2 && old.res === 1 && old.film === 3);
check('an old save is granted the starter lures', old.weak === W0 && old.strong === S0,
      'weak ' + old.weak + ' strong ' + old.strong);
check('the old seven-element array is not carried through', typeof old.weak === 'number');

const cur = migrate({ v: VERSION, b: 900, z: 1, r: 0, f: 0, a: 7, s: 3 });
check('a current save keeps its own lure counts', cur.weak === 7 && cur.strong === 3,
      'weak ' + cur.weak + ' strong ' + cur.strong);

const spent = migrate({ v: VERSION, b: 0, z: 0, r: 0, f: 0, a: 0, s: 0 });
check('a current save with zero lures is NOT re-granted starters',
      spent.weak === 0 && spent.strong === 0, 'weak ' + spent.weak);

const fresh = migrate({});
check('a brand new player gets the starters', fresh.weak === W0 && fresh.strong === S0);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
