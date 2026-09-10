// Every literal the packer has to carry, so you can hunt for things to reuse.
//
//   node test/tools/strings.mjs            print it
//   node test/tools/strings.mjs > s.txt    keep a copy
//
// Why this is worth having: roadroller predicts each byte from what it has
// already seen, so a long string that repeats one it has met is nearly free,
// while a short NEW one costs real bytes. Measured in this repo, "Start
// Multiplayer Game" cost 9 bytes more than "Start" because Multiplayer was
// already shipped -- but "Single Player" cost 18 more than "Solo" because every
// character of it was new. So the way to add a label is to build it out of words
// already on this list.
//
// Dev only. It never ships.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Comments are stripped before the bundle is packed, so they cost nothing and
// would only be noise here.
const decomment = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const counts = new Map();
const where = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
  const body = decomment(read('src/' + f));
  for (const re of [/'((?:[^'\\\n]|\\.)*)'/g, /"((?:[^"\\\n]|\\.)*)"/g]) {
    for (const m of body.matchAll(re)) {
      const v = m[1];
      if (v.length < 2) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
      where.set(v, (where.get(v) || new Set()).add(f));
    }
  }
}

const byLength = (a, b) => b[0].length - a[0].length;
const rows = [...counts];
const section = (title, note, list) => {
  console.log('\n' + title);
  console.log('-'.repeat(title.length));
  if (note) console.log(note + '\n');
  for (const [v, n] of list) {
    console.log(String(v.length).padStart(3) + 'ch  x' + n + '  ' +
      JSON.stringify(v).padEnd(48) + [...where.get(v)].join(' '));
  }
};

// The expensive kind: words a human reads. Nothing else on this page is novel
// enough to cost much.
const prose = rows.filter(([v]) =>
  /[A-Za-z]{2}/.test(v) && !/[<>{}]/.test(v) && !/^\.{0,2}\//.test(v) && !/^data:/.test(v));
section('PROSE  (the expensive kind -- reuse these words)', '', prose.sort(byLength));

section('MARKUP  (repeats here are nearly free)', '',
  rows.filter(([v]) => /[<>]/.test(v)).sort(byLength));

// The stylesheet is folded verbatim into the bundle by build/pack.mjs, so its
// selectors and prose cost real bytes too.
const css = read('index.html').match(/<style>([\s\S]*?)<\/style>/)[1];
const classes = [...new Set(css.match(/[#.][a-zA-Z][-\w]*/g))].sort();
console.log('\nCSS VOCABULARY  (classes and ids already styled)');
console.log('-----------------------------------------------\n');
console.log(classes.join(' '));
console.log('\nCSS RULES');
console.log('---------\n');
console.log(css.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '').split('\n')
  .map((l) => l.replace(/^ {4}/, '')).filter((l) => l.trim()).join('\n'));
