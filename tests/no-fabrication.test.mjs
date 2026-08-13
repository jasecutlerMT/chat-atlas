// A tripwire, not a unit test.
//
// The worst bug this app ever had was inventing a document from chat text and
// handing it over as though Claude had made it — once even writing it into the
// user's folder under the real filename. These checks fail loudly if that
// capability creeps back in.
//
//   npm run test:no-fabrication
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function allSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = allSourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

test('no code rebuilds one of Claude’s files from chat text', () => {
  for (const { path, text } of files) {
    assert.ok(!/\bcompileMoment\b/.test(text), `${path} refers to compileMoment, which fabricated documents`);
    assert.ok(!/\bexportMoment\b/.test(text), `${path} refers to exportMoment, which fabricated documents`);
  }
});

test('the document generator can never write into the user’s save folder', () => {
  // Any module that can build a .docx must not also be able to write to disk:
  // that combination is exactly how fabricated files ended up masquerading as
  // Claude's originals.
  for (const { path, text } of files) {
    const buildsDocuments = /renderDocx|renderDocxBlob/.test(text);
    const writesToFolder = /\bwriteFile\s*\(/.test(text) || /saveFolderRef\.current/.test(text);
    assert.ok(
      !(buildsDocuments && writesToFolder),
      `${path} can both build a document and write to the save folder — keep those apart`,
    );
  }
});

test('documents the app builds itself are named so they cannot be mistaken for Claude’s', () => {
  const exporters = files.find((f) => f.path.endsWith('exporters.ts'));
  assert.ok(exporters, 'exporters.ts should exist');
  assert.match(exporters.text, /chat-atlas-/, 'newly built documents must carry the chat-atlas- filename prefix');
});
