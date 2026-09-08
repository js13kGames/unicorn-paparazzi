// Runs every assertion suite in test/suites.
//
// The game is ESM under a CommonJS package, and the suites need to import the
// real source rather than a copy of it, so this mirrors src/*.js into
// test/.mirror/*.mjs (rewriting the import extensions) before running. The
// mirror is generated on every run, so a suite can never drift from the code it
// is testing.
//
// There is no browser here: these suites are the whole safety net. They cover
// world generation determinism, the scoring rubric, lure behaviour, ballistics,
// the shutter gate, save migration, the HUD, and the track ribbon.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MIRROR = path.join(HERE, '.mirror');

fs.rmSync(MIRROR, { recursive: true, force: true });
fs.mkdirSync(MIRROR, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  if (!f.endsWith('.js')) continue;
  const body = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\.js'/g, ".mjs'");
  fs.writeFileSync(path.join(MIRROR, f.replace(/\.js$/, '.mjs')), body);
}

const only = process.argv[2];
const suites = fs.readdirSync(path.join(HERE, 'suites'))
  .filter((f) => f.endsWith('.mjs') && (!only || f.startsWith(only)))
  .sort();

let failed = [];
for (const s of suites) {
  const name = s.replace('.mjs', '');
  const out = await new Promise((res) => {
    const p = spawn(process.execPath, [path.join(HERE, 'suites', s)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', (code) => res({ code, buf }));
  });
  const last = out.buf.trimEnd().split('\n').pop() || '';
  console.log((out.code ? '  FAIL  ' : '  ok    ') + name.padEnd(10) + last.trim());
  if (out.code) { failed.push(name); console.log(out.buf.replace(/^/gm, '        ')); }
}

console.log('');
console.log(failed.length ? failed.length + ' suite(s) failed: ' + failed.join(', ')
                          : suites.length + ' suites passed');
process.exit(failed.length ? 1 : 0);
