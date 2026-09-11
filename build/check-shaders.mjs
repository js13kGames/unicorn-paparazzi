// Static checks on the GLSL after the build-time strip.
//
// A shader mistake shows up only as a compile throw in a real browser, and the
// loader now rewrites shader text on every build, so this checks what actually
// ships: that the strip did not damage the source, and that the names JavaScript
// binds are exactly the names the shaders declare.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const strip = require('./glsl-loader.cjs');

const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'render.js'), 'utf8');
const src = strip(raw);

// Pull out the named shader literals and resolve the one interpolation.
const lits = {};
for (const m of src.matchAll(/const (\w+) = `([^`]*)`;/g)) lits[m[1]] = m[2];
const resolve = (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => lits[k] ?? '');

// GLSL ES 3.00 builtins and type constructors this game could legitimately call.
// Anything else in call position is a typo, a JavaScript-ism that leaked into a
// shader string, or a build transform that damaged the source.
const BUILTINS = new Set([
  'radians','degrees','sin','cos','tan','asin','acos','atan','sinh','cosh','tanh',
  'pow','exp','log','exp2','log2','sqrt','inversesqrt','abs','sign','floor','trunc',
  'round','roundEven','ceil','fract','mod','modf','min','max','clamp','mix','step',
  'smoothstep','isnan','isinf','length','distance','dot','cross','normalize',
  'faceforward','reflect','refract','matrixCompMult','outerProduct','transpose',
  'determinant','inverse','lessThan','lessThanEqual','greaterThan','greaterThanEqual',
  'equal','notEqual','any','all','not','texture','textureLod','textureSize',
  'texelFetch','texelFetchOffset','textureProj','textureGrad','dFdx','dFdy','fwidth',
  'packSnorm2x16','unpackSnorm2x16','floatBitsToInt','intBitsToFloat',
  'float','int','uint','bool','void','main','return','if','for','while','switch',
]);
for (const t of ['vec','ivec','uvec','bvec']) for (const n of [2,3,4]) BUILTINS.add(t + n);
for (const n of [2,3,4]) BUILTINS.add('mat' + n);
for (const a of [2,3,4]) for (const b of [2,3,4]) BUILTINS.add('mat' + a + 'x' + b);

let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(58) + (ok ? '' : detail || ''));
};

const shaders = Object.keys(lits).filter((k) => lits[k].startsWith('#version'));
check('found all four shader sources', shaders.length === 4, shaders.join(','));

const declared = {};
for (const name of shaders) {
  const body = resolve(lits[name]);
  const lines = body.split('\n');

  check(name + ': #version is the first line', lines[0] === '#version 300 es', lines[0]);
  check(name + ': no comment survived the strip', !body.includes('//'));
  check(name + ': no blank or indented lines',
        !lines.some((l) => l !== l.trim() || l === ''));

  // The bug this is really here for: a build transform once rewrote sin( and
  // cos( inside these strings into Math.sin( and Math.cos(, which is valid
  // JavaScript, invalid GLSL, and invisible until a browser compiles it.
  check(name + ': no "Math." leaked into the shader', !body.includes('Math.'),
        (body.match(/[^\n]*Math\.[^\n]*/) || [''])[0].trim());

  // Every function this shader declares is callable by it.
  const declaredFns = new Set();
  // A declaration starts the shader or follows the `;`/`}` that ended the last
  // one -- it no longer starts a line, because the loader folds each shader flat.
  for (const m of body.matchAll(/(?:^|[;}])\s*\w+\s+(\w+)\s*\(/gm)) declaredFns.add(m[1]);
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const fn = m[1];
    if (BUILTINS.has(fn) || declaredFns.has(fn)) continue;
    check(name + ': "' + fn + '()" is a real GLSL function', false, 'unknown call');
  }

  const bal = (o, c) => body.split(o).length === body.split(c).length;
  check(name + ': braces balance', bal('{', '}'));
  check(name + ': parens balance', bal('(', ')'));

  // every declared in/uniform must be used somewhere else in the shader
  const names = [];
  for (const m of body.matchAll(/(?:^|[;}])\s*(?:flat\s+)?(in|uniform)\s+\w+\s+(\w+)/gm)) names.push(m[2]);
  declared[name] = names;
  for (const n of names) {
    const uses = body.split(new RegExp('\\b' + n + '\\b')).length - 1;
    check(name + ': "' + n + '" is used, not just declared', uses > 1, 'declared only');
  }
}

// The JS side binds by string. Those strings must match the declarations, or the
// lookup silently returns null and the draw quietly does nothing.
const terrainNames = new Set([...declared.TERRAIN_VS, ...declared.TERRAIN_FS]);
const herdNames = new Set([...declared.HERD_VS, ...declared.HERD_FS]);

for (const m of src.matchAll(/getAttribLocation\(\w+, '(\w+)'\)/g)) {
  check('attribute "' + m[1] + '" is declared in a shader',
        terrainNames.has(m[1]) || herdNames.has(m[1]));
}
for (const m of src.matchAll(/\b(tp|hp)\.u\.(\w+)/g)) {
  const set = m[1] === 'tp' ? terrainNames : herdNames;
  check('uniform "' + m[2] + '" (' + m[1] + ') is declared', set.has(m[2]));
}
// array uniforms are introspected as "name[0]"
for (const m of src.matchAll(/\b(tp|hp)\.u\['(\w+)\[0\]'\]/g)) {
  const set = m[1] === 'tp' ? terrainNames : herdNames;
  check('array uniform "' + m[2] + '" (' + m[1] + ') is declared', set.has(m[2]));
}

// Every CONFIG.<key> must resolve. The shutter cooldown silently did nothing for
// a whole release because an edit meant to add `shutterCooldown` targeted a line
// an earlier pass had already rewritten: the insert was a no-op, the reference
// read undefined, and `clock < NaN` is false, so the gate never fired. Nothing
// failed loudly. This is the cheap guard for that whole class.
{
  const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const literal = /export const CONFIG = \{([\s\S]*?)\n\};/.exec(idx);
  if (!literal) throw new Error('could not find the CONFIG literal');
  const keys = new Set([...literal[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
  const used = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src'))) {
    const body = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    for (const m of body.matchAll(/\bCONFIG\.(\w+)/g)) used.add(m[1]);
  }
  for (const k of used) check('CONFIG.' + k + ' is a real config key', keys.has(k));
  console.log('  (' + keys.size + ' config keys, ' + used.size + ' referenced)');
}

// Same accident, JavaScript side: a bad transform can invent Math members that
// only fail when that line finally executes.
const mathNames = new Set(Object.getOwnPropertyNames(Math));
for (const f of fs.readdirSync(path.join(__dirname, '..', 'src'))) {
  const body = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  for (const m of body.matchAll(/Math\.(\w+)/g)) {
    if (!mathNames.has(m[1])) check(f + ': Math.' + m[1] + ' is a real Math member', false);
  }
}

// And the same accident again, one level out: a SCREAMING_CASE constant that is
// referenced but never declared or imported. `RES_PX` sat in the shop label for a
// release and threw a ReferenceError the moment the shop opened, because nothing
// resolves a bare identifier until the line runs.
{
let seen = 0;
for (const f of fs.readdirSync(path.join(__dirname, '..', 'src'))) {
  const body = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g, "''");
  const declared = new Set();
  // One statement can bind several: `const A = 0, B = 1;` and `const [A, B] = …`.
  for (const m of body.matchAll(/\b(?:const|let|var)\s+([^;=\n]+(?:=[^;\n]*,[^;\n]*)*)/g)) {
    for (const n of m[1].matchAll(/\b[A-Z][A-Z0-9_]+\b/g)) declared.add(n[0]);
  }
  for (const g of ['JSON', 'NaN', 'Infinity']) declared.add(g);
  for (const m of body.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const n of m[1].split(',')) declared.add(n.trim().split(/\s+as\s+/).pop());
  }
  // `x.FOO` and `FOO:` are properties, not references to a binding.
  for (const m of body.matchAll(/(\.?)\b([A-Z][A-Z0-9_]{2,})\b\s*(:?)/g)) {
    if (m[1] || m[3]) continue;
    seen++;
    if (!declared.has(m[2])) check(f + ': ' + m[2] + ' is declared or imported', false);
  }
}
console.log('  (' + seen + ' constant references, all resolved)');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nshaders and Math usage ok');
process.exit(fails ? 1 : 0);
