// render-icons.mjs
// Renders the Weave brand SVGs to PNG and a multi-size favicon.ico.
// Run: node render-icons.mjs  (from the brand/ folder, after npm install)

import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'export');
mkdirSync(out, { recursive: true });

function render(svgFile, size) {
  const svg = readFileSync(join(here, svgFile), 'utf8');
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}

// Large sizes use the standard-padding icon; small sizes use the tuned favicon.
const jobs = [
  ['weave-icon.svg', 512, 'weave-icon-512.png'],
  ['weave-icon.svg', 192, 'weave-icon-192.png'],
  ['weave-icon.svg', 180, 'weave-icon-180.png'],
  ['favicon.svg',     48, 'weave-icon-48.png'],
  ['favicon.svg',     32, 'weave-icon-32.png'],
  ['favicon.svg',     16, 'weave-icon-16.png'],
];

for (const [src, size, name] of jobs) {
  const png = render(src, size);
  writeFileSync(join(out, name), png);
  console.log(`wrote ${name.padEnd(22)} ${png.length} bytes`);
}

const ico = await pngToIco([
  render('favicon.svg', 16),
  render('favicon.svg', 32),
  render('favicon.svg', 48),
]);
writeFileSync(join(out, 'favicon.ico'), ico);
console.log(`wrote ${'favicon.ico'.padEnd(22)} ${ico.length} bytes`);
console.log('done -> ' + out);
