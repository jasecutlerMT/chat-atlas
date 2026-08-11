// Chat Atlas self-updater.
//
// Fetches the latest app code from the public app-only mirror
// (github.com/jasecutlerMT/chat-atlas — no conversation data lives there,
// ever) and applies it in place. This runs inside the local server's Node
// process when the in-app Update button is clicked; the browser page itself
// never talks to the internet.
//
//   node scripts/update.mjs --check   -> prints {"local":4,"remote":5}
//   node scripts/update.mjs           -> downloads and applies the update

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'jasecutlerMT/chat-atlas';
const BRANCH = 'main';
const RAW_VERSION_URL = `https://raw.githubusercontent.com/${MIRROR}/${BRANCH}/version.json`;
const ZIP_URL = `https://codeload.github.com/${MIRROR}/zip/refs/heads/${BRANCH}`;

const localVersion = () => JSON.parse(readFileSync(join(APP, 'version.json'), 'utf8')).version;

async function remoteVersion() {
  const res = await fetch(RAW_VERSION_URL, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()).version;
}

if (process.argv.includes('--check')) {
  let remote = null;
  try {
    remote = await remoteVersion();
  } catch {
    /* offline, or the mirror doesn't exist yet — both mean "no update on offer" */
  }
  console.log(JSON.stringify({ local: localVersion(), remote }));
  process.exit(0);
}

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

console.log('downloading the new version…');
const res = await fetch(ZIP_URL, { signal: AbortSignal.timeout(180_000) });
if (!res.ok) throw new Error(`download failed (${res.status})`);
const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));

const prevPackageJson = readFileSync(join(APP, 'package.json'), 'utf8');

// Never touch installed dependencies, test scratch space, or built output.
const SKIP = /^(node_modules\/|tests\/fixtures\/\.tmp\/|dist\/)/;

let written = 0;
for (const entry of Object.values(zip.files)) {
  if (entry.dir) continue;
  const rel = entry.name.split('/').slice(1).join('/'); // strip the "chat-atlas-main/" wrapper
  if (!rel || SKIP.test(rel)) continue;
  const target = join(APP, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, await entry.async('nodebuffer'));
  written++;
}

// Zip extraction loses the executable bit the Mac launcher needs.
const launcher = join(APP, 'Chat Atlas.app', 'Contents', 'MacOS', 'ChatAtlas');
if (existsSync(launcher)) chmodSync(launcher, 0o755);

console.log(`updated ${written} files`);

if (readFileSync(join(APP, 'package.json'), 'utf8') !== prevPackageJson) {
  console.log('installing new building blocks…');
  execSync('npm install', { cwd: APP, stdio: 'inherit' });
}

console.log(`done — now at version ${localVersion()}`);
