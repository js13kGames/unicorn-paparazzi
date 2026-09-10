// Post-webpack packaging: Roadroller-compress the bundle, inline it into a
// single self-contained index.html, and zip that.
//
// Roadroller is a context-mixing compressor tuned for JavaScript. It beats the
// zip's own DEFLATE on our bundle, at the cost of a ~700 byte self-extracting
// decoder and a couple hundred ms of decompression at load.
// Roadroller's CommonJS entry shims through the long-abandoned `esm` loader,
// which throws on modern Node, so this build step is ESM and imports index.mjs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Packer } from 'roadroller';
import { minify } from 'terser';
import { makeZip } from './zip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LIMIT = 13 * 1024;
const DOCS = path.join(__dirname, '..', 'docs');
const OUT = path.join(DOCS, 'game.zip');

// Pull the CSS and the body markup out of the built page and turn them into a
// bootstrap prepended to the bundle. Left in the HTML they are a second, separate
// deflate stream in the archive; folded in here they go through Roadroller with
// everything else, and one model sees the whole page.
//
// This happens in the build, not in the source: index.html stays the readable
// place to author markup and CSS.
function fold(html) {
  // webpack injects the script tag into <head>, not <body>. Left in place it
  // ships as a dead reference to a file the archive does not contain -- a 404 in
  // the console, which the jam rules forbid.
  const tag = /<script[^>]*src=["']main\.js["'][^>]*><\/script>/;
  if (!tag.test(html)) throw new Error('could not find the injected main.js script tag');
  html = html.replace(tag, '');

  const style = /<style>([\s\S]*?)<\/style>/.exec(html);
  const body = /<body>([\s\S]*?)<\/body>/.exec(html);
  if (!style || !body) throw new Error('could not find <style> and <body> to fold in');

  const markup = body[1].trim();
  const lit = (s) => JSON.stringify(s);
  const boot =
    'document.head.insertAdjacentHTML("beforeend","<style>"+' + lit(style[1]) + '+"<\\/style>");' +
    'document.body.innerHTML=' + lit(markup) + ';';

  // What is left is the shell the browser parses before the script runs.
  const shell = html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<body>[\s\S]*?<\/body>/, '<body></body>');
  return { boot, shell };
}

async function main() {
  const js = fs.readFileSync(path.join(DOCS, 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const { boot, shell } = fold(html);
  const source = boot + js;

  // Chosen by sweeping seeds and keeping the smallest; any fixed value works, this
// one happens to pack best.
const SEED = Number(process.env.RR_SEED || 77);

// Roadroller's parameter search is randomised, so identical source produced
  // builds 22 bytes apart run to run. That is not just untidy: a build measured
  // under the limit could ship over it. Pin Math.random for the duration of the
  // search so the packer is reproducible.
  const realRandom = Math.random;
  let seed = SEED;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let packed;
  try {
    const packer = new Packer([{ data: source, type: 'js', action: 'eval' }], {});
    await packer.optimize(Number(process.env.RR_LEVEL || 1));
    const out = packer.makeDecoder();
    packed = out.firstLine + out.secondLine;
  } finally {
    Math.random = realRandom;
  }
  // The blob lives inside an inline <script>, so a literal "</" would end the
  // element early. Inside a JS string "\/" is just "/", so this is safe. The
  // current payload happens to contain none, but the payload changes with every
  // build, and the round-trip check below proves the escape for each one.
  packed = packed.split('</').join('<\\/');

  await verifyRoundTrip(packed, source);

  // The shell carries nothing but the script; the bootstrap builds the rest.
  const page = shell.replace('</body>', '<script>' + packed + '</script></body>');
  if (!page.includes(packed)) throw new Error('could not find </body> to inline into');

  const single = path.join(DOCS, 'dist');
  fs.mkdirSync(single, { recursive: true });
  fs.writeFileSync(path.join(single, 'index.html'), page);

  const zip = makeZip([{ name: 'index.html', data: Buffer.from(page, 'utf8') }]);
  fs.writeFileSync(OUT, zip);

  report(source, html, packed, page, zip);
  if (zip.length > LIMIT) {
    console.error('\nOVER BUDGET by ' + (zip.length - LIMIT) + ' bytes');
    process.exit(1);
  }
}

// Run the decoder without its eval and check we get the bundle back. Roadroller
// re-serialises JS rather than round-tripping bytes (it will turn `return()=>`
// into `return ()=>`), so byte equality is the wrong test -- both sides go
// through Terser's printer first and the normalised forms must match. That still
// catches a corrupted payload, a bad "</" escape, or a Roadroller mis-parse.
async function verifyRoundTrip(packed, original) {
  if (!packed.startsWith('eval(') || !packed.endsWith(')')) {
    throw new Error('unexpected Roadroller output shape');
  }
  const decoded = (0, eval)(packed.slice(5, -1));
  const norm = async (src) => (await minify(src, { compress: false, mangle: false })).code;
  const [a, b] = await Promise.all([norm(original), norm(decoded)]);
  if (a !== b) {
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    throw new Error('Roadroller round-trip mismatch at char ' + i + '\n' +
      '  expected: ' + JSON.stringify(a.slice(i - 40, i + 60)) + '\n' +
      '  decoded : ' + JSON.stringify(b.slice(i - 40, i + 60)));
  }
}

function report(js, html, packed, page, zip) {
  const pad = (n) => String(n).padStart(7);
  console.log('  bundle + css/markup' + pad(js.length));
  console.log('  roadrolled         ' + pad(packed.length) + '   (' +
    (100 - (packed.length / js.length) * 100).toFixed(1) + '% smaller)');
  console.log('  page (html + blob) ' + pad(page.length));
  console.log('  ---');
  console.log('  docs/game.zip      ' + pad(zip.length) + '   of ' + LIMIT +
    '   (' + (LIMIT - zip.length) + ' bytes free, ' +
    ((zip.length / LIMIT) * 100).toFixed(1) + '% used)');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
