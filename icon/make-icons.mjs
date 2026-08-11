// Renders icon.svg at every macOS icon size and packs a real .icns file.
// Vector-renders each size in headless Chromium — no raster downscaling, so
// small sizes stay crisp. (Adapted from tax-tracker/icon/make-icons.mjs.)
//
//   cd chat-atlas && npm install && npm run icons
//
// Outputs:
//   Chat Atlas.app/Contents/Resources/icon.icns
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'icon.svg'), 'utf8');

// icns entry types that hold PNG data, and the pixel size each expects.
const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64],
  ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];
const SIZES = [...new Set(ICNS_TYPES.map(([, s]) => s))];

function chromiumExecutablePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  try {
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const bin = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return bin;
    }
  } catch { /* use managed browser */ }
  return undefined;
}

const executablePath = chromiumExecutablePath();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });

const pngBySize = {};
for (const size of SIZES) {
  const sized = svg
    .replace('width="1024"', `width="${size}"`)
    .replace('height="1024"', `height="${size}"`);
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`
  );
  pngBySize[size] = await page.locator('svg').screenshot({ omitBackground: true });
  console.log(`rendered ${size}x${size} (${pngBySize[size].length} bytes)`);
}
await browser.close();

// Pack the .icns: 'icns' magic + big-endian total length, then one
// [type][length][png] chunk per entry.
const chunks = ICNS_TYPES.map(([type, size]) => {
  const png = pngBySize[size];
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([head, png]);
});
const body = Buffer.concat(chunks);
const magic = Buffer.alloc(8);
magic.write('icns', 0, 'ascii');
magic.writeUInt32BE(body.length + 8, 4);
const icns = Buffer.concat([magic, body]);

const resourcesDir = join(here, '..', 'Chat Atlas.app', 'Contents', 'Resources');
mkdirSync(resourcesDir, { recursive: true });
writeFileSync(join(resourcesDir, 'icon.icns'), icns);
console.log(`wrote icon.icns (${icns.length} bytes, ${ICNS_TYPES.length} entries)`);
