// Tests the Mac launcher's folder-resolution ladder without launching
// anything: the script supports --resolve-only, and mdfind/osascript are
// stubbed on PATH so the suite runs on any OS.
//
//   npm run test:launcher
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'Chat Atlas.app');
const LAUNCHER = join(APP, 'Contents', 'MacOS', 'ChatAtlas');

let root;
/** A copy of the .app in a neutral folder, so the sibling stage cannot resolve. */
let isolatedLauncher;

function makeAtlasDir(path) {
  mkdirSync(join(path, 'src'), { recursive: true });
  writeFileSync(join(path, 'package.json'), '{"name":"chat-atlas"}');
  writeFileSync(join(path, 'vite.config.ts'), 'export default {}');
}

function makeStubs(dir, { mdfindOut = '', pickerOut = '' } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mdfind'), `#!/bin/sh\nprintf '%b' "${mdfindOut}"\n`);
  // The script calls osascript both for the folder picker and for alerts;
  // only the picker call contains "choose folder".
  writeFileSync(
    join(dir, 'osascript'),
    `#!/bin/sh\ncase "$*" in *"choose folder"*) printf '%s' "${pickerOut}" ;; *) : ;; esac\n`,
  );
  writeFileSync(join(dir, 'curl'), '#!/bin/sh\nexit 1\n');
  for (const f of ['mdfind', 'osascript', 'curl']) chmodSync(join(dir, f), 0o755);
}

function resolveWith({ home, stubs, launcher = LAUNCHER }) {
  return execFileSync('sh', [launcher, '--resolve-only'], {
    env: { ...process.env, HOME: home, PATH: `${stubs}:${process.env.PATH}` },
    encoding: 'utf8',
  }).trim();
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-launcher-'));
  const isolated = join(root, 'isolated');
  cpSync(APP, join(isolated, 'Chat Atlas.app'), { recursive: true });
  isolatedLauncher = join(isolated, 'Chat Atlas.app', 'Contents', 'MacOS', 'ChatAtlas');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

test('remembered location wins', () => {
  const home = join(root, 'home1');
  const atlas = join(root, 'somewhere', 'chat-atlas');
  makeAtlasDir(atlas);
  mkdirSync(join(home, 'Library', 'Application Support', 'ChatAtlas'), { recursive: true });
  writeFileSync(join(home, 'Library', 'Application Support', 'ChatAtlas', 'location'), atlas + '\n');
  const stubs = join(root, 'stubs1');
  makeStubs(stubs);
  assert.equal(resolveWith({ home, stubs }), atlas);
});

test('a stale memo is ignored and the sibling folder is found', () => {
  const home = join(root, 'home2');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, 'Library', 'Application Support', 'ChatAtlas'), { recursive: true });
  writeFileSync(join(home, 'Library', 'Application Support', 'ChatAtlas', 'location'), join(root, 'gone') + '\n');
  // Place a copy of the .app inside a valid chat-atlas folder.
  const atlas = join(root, 'projects', 'chat-atlas');
  makeAtlasDir(atlas);
  cpSync(APP, join(atlas, 'Chat Atlas.app'), { recursive: true });
  const stubs = join(root, 'stubs2');
  makeStubs(stubs);
  const out = resolveWith({ home, stubs, launcher: join(atlas, 'Chat Atlas.app', 'Contents', 'MacOS', 'ChatAtlas') });
  assert.equal(out, atlas);
  // And the found location is remembered for next time.
  const memo = readFileSync(join(home, 'Library', 'Application Support', 'ChatAtlas', 'location'), 'utf8').trim();
  assert.equal(memo, atlas);
});

test('a single Spotlight hit is accepted', () => {
  const home = join(root, 'home3');
  mkdirSync(home, { recursive: true });
  const atlas = join(root, 'documents', 'chat-atlas');
  makeAtlasDir(atlas);
  const stubs = join(root, 'stubs3');
  makeStubs(stubs, { mdfindOut: join(atlas, 'vite.config.ts') + '\\n' });
  assert.equal(resolveWith({ home, stubs, launcher: isolatedLauncher }), atlas);
});

test('multiple Spotlight hits are never guessed between; the picker decides', () => {
  const home = join(root, 'home4');
  mkdirSync(home, { recursive: true });
  const a = join(root, 'a', 'chat-atlas');
  const b = join(root, 'b', 'chat-atlas');
  makeAtlasDir(a);
  makeAtlasDir(b);
  const stubs = join(root, 'stubs4');
  makeStubs(stubs, {
    mdfindOut: `${join(a, 'vite.config.ts')}\\n${join(b, 'vite.config.ts')}\\n`,
    pickerOut: b,
  });
  assert.equal(resolveWith({ home, stubs, launcher: isolatedLauncher }), b);
});

test('picker cancel means a clear failure, not a wrong guess', () => {
  const home = join(root, 'home5');
  mkdirSync(home, { recursive: true });
  const stubs = join(root, 'stubs5');
  makeStubs(stubs); // no mdfind results, picker returns nothing
  assert.throws(() =>
    execFileSync('sh', [isolatedLauncher, '--resolve-only'], {
      env: { ...process.env, HOME: home, PATH: `${stubs}:${process.env.PATH}` },
      encoding: 'utf8',
    }),
  );
});

test('a folder that merely exists but is not chat-atlas is rejected', () => {
  const home = join(root, 'home6');
  const notAtlas = join(root, 'not-atlas', 'chat-atlas');
  mkdirSync(notAtlas, { recursive: true }); // no package.json etc.
  mkdirSync(join(home, 'Library', 'Application Support', 'ChatAtlas'), { recursive: true });
  writeFileSync(join(home, 'Library', 'Application Support', 'ChatAtlas', 'location'), notAtlas + '\n');
  const stubs = join(root, 'stubs6');
  makeStubs(stubs, { pickerOut: '' });
  assert.throws(() =>
    execFileSync('sh', [isolatedLauncher, '--resolve-only'], {
      env: { ...process.env, HOME: home, PATH: `${stubs}:${process.env.PATH}` },
      encoding: 'utf8',
    }),
  );
});
