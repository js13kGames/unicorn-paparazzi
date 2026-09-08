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

async function main() {
  const js = fs.readFileSync(path.join(DOCS, 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');

  const packer = new Packer([{ data: js, type: 'js', action: 'eval' }], {});
  await packer.optimize(Number(process.env.RR_LEVEL || 1));
  const out = packer.makeDecoder();
  let packed = out.firstLine + out.secondLine;

  // The blob lives inside an inline <script>, so a literal "</" would end the
  // element early. Inside a JS string "\/" is just "/", so this is safe. The
  // current payload happens to contain none, but the payload changes with every
  // build, and the round-trip check below proves the escape for each one.
  packed = packed.split('</').join('<\\/');

  await verifyRoundTrip(packed, js);

  // Drop the tag webpack injected and inline the blob at the end of <body>, so
  // the DOM exists by the time it runs (the original tag was deferred).
  let page = html.replace(/<script[^>]*src=["']main\.js["'][^>]*><\/script>/, '');
  if (page === html) throw new Error('could not find the injected main.js script tag');
  page = page.replace('</body>', '<script>' + packed + '</script></body>');
  if (!page.includes(packed)) throw new Error('could not find </body> to inline into');

  const single = path.join(DOCS, 'dist');
  fs.mkdirSync(single, { recursive: true });
  fs.writeFileSync(path.join(single, 'index.html'), page);

  const zip = makeZip([{ name: 'index.html', data: Buffer.from(page, 'utf8') }]);
  fs.writeFileSync(OUT, zip);

  report(js, html, packed, page, zip);
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
  console.log('  bundle (minified)  ' + pad(js.length));
  console.log('  roadrolled         ' + pad(packed.length) + '   (' +
    (100 - (packed.length / js.length) * 100).toFixed(1) + '% smaller)');
  console.log('  page (html + blob) ' + pad(page.length));
  console.log('  ---');
  console.log('  docs/game.zip      ' + pad(zip.length) + '   of ' + LIMIT +
    '   (' + (LIMIT - zip.length) + ' bytes free, ' +
    ((zip.length / LIMIT) * 100).toFixed(1) + '% used)');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
