// End-to-end walkthrough of Chat Atlas in real Chromium. Runs serially against
// one shared page so IndexedDB state carries between steps, the way a real
// session does.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtures, makeClaudeDocx, makePdfBytes, TMP, BODY_ACME } from './fixtures/make-fixture.mjs';

test.describe.configure({ mode: 'serial' });

let context;
let page;

/**
 * Hands the watcher a stand-in folder containing the given files, then waits
 * for the sweep. Bytes cross into the page as a plain array, since a Node
 * Buffer cannot be passed through page.evaluate.
 */
async function injectFolder(page, files) {
  await page.evaluate((list) => {
    const built = list.map((f) => new File([new Uint8Array(f.bytes)], f.name, { lastModified: f.lastModified }));
    window.__atlasTest.injectDirHandle({
      name: 'Downloads (test)',
      kind: 'directory',
      async *values() {
        for (const file of built) yield { kind: 'file', name: file.name, getFile: async () => file };
      },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    });
  }, files);
}

test.beforeAll(async ({ browser }) => {
  await makeFixtures();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  page = await context.newPage();
  await page.goto('/');
});

test.afterAll(async () => {
  await context?.close();
});

test('first import lands on Your files, with the library one click away', async () => {
  await expect(page.getByText('Welcome to Chat Atlas')).toBeVisible({ timeout: 15_000 });
  await page.setInputFiles('[data-testid="file-input"]', join(TMP, 'sample.zip'));
  await expect(page.locator('.toast').first()).toContainText('new conversation', { timeout: 30_000 });
  await expect(page.locator('.tab-on')).toHaveText('Library');
  await expect(page.locator('.lib-head h1')).toHaveText('Your files');
  // Nothing is saved yet, so the only rows are the files Claude made that are
  // not on this Mac — each pointing back at its chat.
  await expect(page.locator('[data-testid="wanted-card"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="file-card"]')).toHaveCount(0);
  await page.locator('.side-item', { hasText: 'Overview' }).click();
  await expect(page.locator('.side-item', { hasText: 'Research brief' })).toBeVisible();
  await expect(page.locator('.side-item', { hasText: 'Email or message draft' })).toBeVisible();
  await expect(page.locator('.lib-row').first()).toBeVisible();
});

test('entities are detected and junk never appears', async () => {
  const sidebar = page.locator('.lib-sidebar');
  await expect(sidebar.locator('.side-entity', { hasText: 'Acme Logistics' })).toBeVisible();
  await expect(sidebar.locator('.side-entity', { hasText: 'Jane Smith' })).toBeVisible();
  await expect(sidebar.locator('.side-entity', { hasText: 'Salesforce' })).toBeVisible();
  const labels = await sidebar.locator('.side-entity .side-label').allTextContents();
  for (const junk of ['Untitled', 'Conversation', 'Here', 'Subject', 'Best', 'Understanding', "I'll", "I'm", "I'd"]) {
    expect(labels, `"${junk}" must not be an entity`).not.toContain(junk);
  }
});

test('tool machinery never pollutes titles, previews or search', async () => {
  // The tool-heavy conversation's real prose comes through…
  await page.locator('.side-item', { hasText: /^Document\s*\d/ }).click();
  await expect(page.locator('.lib-row', { hasText: 'Visualising your chat history' })).toBeVisible();
  // …and no placeholder junk appears anywhere in the library.
  expect(await page.locator('.lib-row', { hasText: 'content]' }).count()).toBe(0);
  await page.locator('.side-item', { hasText: 'Overview' }).click();
  expect(await page.locator('.lib-row', { hasText: 'content]' }).count()).toBe(0);
});

test('placeholder text from old imports is cleaned up automatically', async () => {
  // Simulate data written by an older version: placeholders inside stored
  // message text, and the one-time-cleanup marker absent.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('chat-atlas');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['conversations', 'meta'], 'readwrite');
        const store = tx.objectStore('conversations');
        const req = store.getAll();
        req.onsuccess = () => {
          const conv = req.result.find((c) => c.name === 'Cold call script practice');
          conv.messages[1].text = '*[tool use content]*\n\n' + conv.messages[1].text + '\n\n*[tool result content]*';
          store.put(conv);
          tx.objectStore('meta').delete('machineryTextCleaned');
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await page.reload();
  await expect(page.locator('.lib-sidebar')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500); // let the cleanup + rebuild settle
  await page.fill('.search-bar input', 'cold call');
  await expect(page.locator('.result').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.result', { hasText: 'Cold call script practice' }).first().click();
  await expect(page.locator('.reading-pane')).toBeVisible();
  const paneText = await page.locator('.pane-body').textContent();
  expect(paneText).not.toContain('content]');
  await page.keyboard.press('Escape');
  await page.fill('.search-bar input', '');
});

test('an entity page collects its outputs and conversations', async () => {
  await page.locator('.side-entity', { hasText: 'Acme Logistics' }).click();
  await expect(page.locator('.lib-head h1')).toHaveText('Acme Logistics');
  expect(await page.locator('.lib-row').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.lib-section-head', { hasText: 'Conversations' })).toBeVisible();
  await expect(page.locator('.secondary-btn', { hasText: 'Combine into a new document' })).toBeVisible();
});

test('titles never start with conversational filler', async () => {
  await page.locator('.side-item', { hasText: 'Overview' }).click();
  const titles = await page.locator('.lib-row-title').allTextContents();
  expect(titles.length).toBeGreaterThan(3);
  for (const t of titles) {
    expect(t, `bad title: ${t}`).not.toMatch(/^(here('|’)s|sure|certainly|of course|below is)/i);
  }
});

test('near-duplicate drafts collapse into one card with versions', async () => {
  await page.locator('.side-item', { hasText: 'Email or message draft' }).click();
  const badge = page.locator('.version-badge').first();
  await expect(badge).toBeVisible();
  const label = await badge.textContent();
  expect(Number(label.replace('v', ''))).toBeGreaterThanOrEqual(3);
  await badge.click();
  await expect(page.locator('.lib-row-version').first()).toBeVisible();
});

test('keyword chips contain no junk words', async () => {
  const chips = await page.locator('.chip-row .chip').allTextContents();
  for (const c of chips) {
    expect(['untitled', 'conversation', 'artifact', 'message', 'draft']).not.toContain(c.toLowerCase());
  }
});

test('pinning keeps an item at hand', async () => {
  await page.locator('.side-item', { hasText: 'Overview' }).click();
  await page.locator('.lib-row').first().locator('button[title*="Pin"]').click();
  await page.locator('.side-item', { hasText: 'Pinned' }).click();
  await expect(page.locator('.lib-row')).toHaveCount(1);
});

test('collections: create, add, reorder, persist', async () => {
  // Use a type list: every row there is a distinct card.
  await page.locator('.side-item', { hasText: 'Plan or framework' }).click();
  await page.locator('.lib-row').nth(0).locator('button[title="Add to a collection"]').click();
  await page.locator('.popover-new input').fill('Career pack');
  await page.locator('.popover-new input').press('Enter');
  await page.locator('.lib-row').nth(1).locator('button[title="Add to a collection"]').click();
  await page.locator('.popover-item', { hasText: 'Career pack' }).click();

  await page.locator('.side-item', { hasText: 'Career pack' }).click();
  await expect(page.locator('.collection-item')).toHaveCount(2);
  const firstTitle = await page.locator('.collection-item .lib-row-title').first().textContent();
  await page.locator('.collection-item').nth(1).locator('button[title="Move up"]').click();
  const newFirst = await page.locator('.collection-item .lib-row-title').first().textContent();
  expect(newFirst).not.toBe(firstTitle);

  await page.reload();
  await expect(page.locator('.side-item', { hasText: 'Career pack' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.side-item', { hasText: 'Career pack' }).click();
  await expect(page.locator('.collection-item .lib-row-title').first()).toHaveText(newFirst);
});

test('renaming and hiding entities persists across reloads', async () => {
  await page.locator('.side-entity', { hasText: 'Jane Smith' }).click();
  await page.locator('.entity-tools .ghost-btn', { hasText: 'Rename' }).click();
  await page.locator('.entity-tools input').fill('Jane S. (recruiter)');
  await page.locator('.entity-tools input').press('Enter');
  await expect(page.locator('.side-entity', { hasText: 'Jane S. (recruiter)' })).toBeVisible();

  await page.locator('.side-entity', { hasText: 'Salesforce' }).click();
  await page.locator('.entity-tools .ghost-btn', { hasText: 'Hide this' }).click();
  await expect(page.locator('.side-entity', { hasText: 'Salesforce' })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.side-entity', { hasText: 'Jane S. (recruiter)' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.side-entity', { hasText: 'Salesforce' })).toHaveCount(0);
});

test('compile to a real Word document with cover and contents', async () => {
  await page.locator('.side-entity', { hasText: 'Acme Logistics' }).click();
  await page.locator('.secondary-btn', { hasText: 'Combine into a new document' }).click();
  await expect(page.locator('.compile-modal')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.primary-btn', { hasText: 'Word document' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const zip = await JSZip.loadAsync(readFileSync(path));
  const docXml = await zip.file('word/document.xml').async('string');
  expect(docXml).toContain('Acme Logistics');
  expect(docXml).toContain('Contents');
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
});

test('PDF export opens a print-ready page', async () => {
  await page.locator('.side-entity', { hasText: 'Acme Logistics' }).click();
  await page.locator('.secondary-btn', { hasText: 'Combine into a new document' }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('.secondary-btn', { hasText: 'PDF' }).click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => document.querySelectorAll('.section').length > 0, { timeout: 20_000 });
  await expect(popup.locator('.cover h1')).toContainText('Acme Logistics');
  await popup.waitForFunction(() => window.__printed === true, { timeout: 10_000 });
  await popup.close();
});

test('a second export merges cleanly and shows what is new', async () => {
  await page.setInputFiles('[data-testid="topbar-file-input"]', join(TMP, 'sample2.zip'));
  await expect(page.locator('.toast').last()).toContainText('1 new conversation, 1 updated', { timeout: 30_000 });
  await page.locator('.side-item', { hasText: 'What’s new' }).click();
  await expect(page.locator('.lib-row').first()).toBeVisible();
  const titles = await page.locator('.lib-row-title').allTextContents();
  expect(titles.join(' ')).toContain('Negotiation plan');

  // Importing the exact same zip again must change nothing.
  await page.setInputFiles('[data-testid="topbar-file-input"]', join(TMP, 'sample2.zip'));
  await expect(page.locator('.toast').last()).toContainText('Already up to date', { timeout: 30_000 });
});

test('typo-tolerant search still reaches the exact message', async () => {
  await page.fill('.search-bar input', 'negotation');
  await expect(page.locator('.result').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.result').first().click();
  await expect(page.locator('.reading-pane')).toBeVisible();
  await expect(page.locator('.msg-flash')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.fill('.search-bar input', '');
});

test('map and timeline still render, with a legend', async () => {
  await page.locator('.tab', { hasText: 'Map' }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator('.map-controls')).toBeVisible();
  await expect(page.locator('.map-legend').first()).toBeVisible();
  await page.locator('.tab', { hasText: 'Timeline' }).click();
  await expect(page.locator('.tl-dot').first()).toBeVisible();
  await page.locator('.tab', { hasText: 'Library' }).click();
});

test('old stored data is upgraded in place (no re-import needed)', async () => {
  // Strip the schema marker from the stored bundle, as if an older version
  // of the app had written it, then reload: entities must come back.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('chat-atlas');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('derived', 'readwrite');
        const store = tx.objectStore('derived');
        const get = store.get('bundle');
        get.onsuccess = () => {
          const bundle = get.result;
          delete bundle.schemaVersion;
          delete bundle.entities;
          store.put(bundle, 'bundle');
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await page.reload();
  await expect(page.locator('.side-entity', { hasText: 'Acme Logistics' })).toBeVisible({ timeout: 30_000 });
  // The upgrade's progress card must clear itself once the work is done —
  // it once sat on "Finding the files you asked for…" forever.
  await expect(page.locator('.progress-card')).toHaveCount(0, { timeout: 15_000 });
});

test('Your files shows only real saved files, newest first, with the time', async () => {
  await page.locator('.side-item', { hasText: 'Your files' }).click();
  await expect(page.locator('.lib-head h1')).toHaveText('Your files');

  // Three of Claude's documents, deliberately dropped into the folder in the
  // OPPOSITE order to when Claude made them. The first has a filename and a
  // title that match no chat at all — only its timestamp can place it.
  const files = [
    { name: 'export-8837.docx', title: 'Reference sheet 8837', created: '2026-06-28T09:05:30.000Z', body: BODY_ACME },
    { name: 'plan-v2.docx', title: 'Week two plan', created: '2026-06-20T11:00:00.000Z', body: 'A plan for the coming week.' },
    { name: 'older-note.docx', title: 'An older note', created: '2026-06-02T08:00:00.000Z', body: 'An older note entirely.' },
  ];
  const built = [];
  for (const f of files) built.push({ ...f, buf: await makeClaudeDocx(f) });
  // newest file gets the OLDEST modified time on disk, to prove the sort uses
  // the time Claude made it rather than when it landed here.
  await injectFolder(
    page,
    built.map((b, i) => ({ name: b.name, bytes: [...b.buf], lastModified: Date.now() - i * 1000 })),
  );
  // Wait for the whole sweep, not just the first file's toast.
  await expect(page.locator('[data-testid="file-card"]')).toHaveCount(3, { timeout: 20_000 });

  const titles = await page.locator('[data-testid="file-card"] .file-card-title').allTextContents();
  expect(titles.slice(0, 3)).toEqual(['Reference sheet 8837', 'Week two plan', 'An older note']);
  const times = await page.locator('[data-testid="file-card"] .file-card-sub').allTextContents();
  expect(times[0]).toMatch(/\d{1,2}:\d{2}/);
  // Nothing anywhere offers a made-up document.
  expect(await page.getByText(/fresh copy|rebuilt|made fresh|Markdown/i).count()).toBe(0);
});

test('a file whose name matches nothing still finds its chat, by the time Claude made it', async () => {
  // Neither "export-8837.docx" nor "Reference sheet 8837" appears anywhere in
  // the history — only the moment Claude made it, inside the Sydney chat.
  const row = page.locator('[data-testid="file-card"]', { hasText: 'Reference sheet 8837' });
  await expect(row).toBeVisible();
  await expect(row.locator('.file-card-sub')).toContainText('Sydney tech target list');
  await expect(row.locator('.file-card-status')).toContainText('Claude’s original file');
  await expect(row.locator('.file-card-status')).toContainText('right in the middle of this chat');
});

test('the download is byte-identical to the file Claude made', async () => {
  const buf = await makeClaudeDocx({
    name: 'exactness-check.docx',
    title: 'Exactness check',
    created: '2026-06-28T09:06:00.000Z',
    body: 'Every byte of this file must survive the round trip.',
  });
  await injectFolder(page, [{ name: 'exactness-check.docx', bytes: [...buf], lastModified: Date.now() }]);
  const row = page.locator('[data-testid="file-card"]', { hasText: 'Exactness check' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  const downloadPromise = page.waitForEvent('download');
  await row.locator('.file-dl-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('exactness-check.docx');
  expect(Buffer.compare(readFileSync(await download.path()), buf)).toBe(0);
});

test('files that are not Claude’s are left alone', async () => {
  const wordResave = await makeClaudeDocx({
    title: 'My own notes',
    created: '2026-05-01T09:00:00.000Z',
    body: 'Something I wrote myself in Word.',
    claudeMade: false,
  });
  const statement = makePdfBytes({ title: 'Statement', producer: 'Quartz PDFContext', created: 'D:20260501090000Z' });
  const before = await page.locator('[data-testid="file-card"]').count();
  await injectFolder(page, [
    { name: 'bank-statement-july.pdf', bytes: [...statement], lastModified: Date.now() },
    { name: 'my-own-notes.docx', bytes: [...wordResave], lastModified: Date.now() },
  ]);
  await page.waitForTimeout(2500);
  expect(await page.locator('[data-testid="file-card"]').count()).toBe(before);
  expect(await page.getByText(/bank-statement/i).count()).toBe(0);
});

test('files Claude made that are not on this Mac are listed by chat, with no fake download', async () => {
  await expect(page.locator('[data-testid="wanted-head"]')).toBeVisible();
  const wanted = page.locator('[data-testid="wanted-card"]').first();
  await expect(wanted).toBeVisible();
  expect(await wanted.locator('.file-dl-btn').getAttribute('href')).toMatch(/^https:\/\/claude\.ai\/chat\//);
  // Every Download button in the app hands over real bytes.
  const downloads = page.locator('button.file-dl-btn');
  const real = page.locator('button.file-dl-btn[data-real="1"]');
  expect(await downloads.count()).toBe(await real.count());
  // The group header links straight to the chat so "Download all" works there.
  const group = page.locator('.wanted-group-head a').first();
  expect(await group.getAttribute('href')).toMatch(/^https:\/\/claude\.ai\/chat\//);
  expect(await group.getAttribute('rel')).toContain('noopener');
});

test('a document announced twice is one row, and markdown files never appear', async () => {
  // The Docusign chat announces docusign-deep-dive.docx in two messages —
  // that's one file, so it gets one row.
  await expect(page.locator('[data-testid="wanted-card"]', { hasText: 'docusign-deep-dive.docx' })).toHaveCount(1);
  // The openclaw chat produced only SKILL.md and data.csv — not Word or PDF —
  // so it leaves no trace on this screen, not even a nameless row.
  expect(await page.getByText('SKILL.md').count()).toBe(0);
  expect(await page.getByText('data.csv').count()).toBe(0);
  expect(await page.locator('.wanted-group', { hasText: 'Openclaw skill notes' }).count()).toBe(0);
});

test('the page says how fresh it is, and walks through bringing in newer chats', async () => {
  const fresh = page.locator('[data-testid="files-freshness"]');
  await expect(fresh).toBeVisible();
  await expect(fresh).toContainText('This page knows about your chats up to');
  await page.locator('[data-testid="update-files-btn"]').click();
  const panel = page.locator('[data-testid="update-files-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('already automatic');
  // The one manual step is a plain link to Claude's own export page — the app
  // itself never reaches into the user's Claude account.
  const link = panel.locator('[data-testid="open-export-page"]');
  expect(await link.getAttribute('href')).toBe('https://claude.ai/settings/data-privacy-controls');
  expect(await link.getAttribute('rel')).toContain('noopener');
  await panel.locator('.link-btn', { hasText: 'Close' }).click();
  await expect(panel).toHaveCount(0);
});

test('an original can be added by hand to a file that is missing', async () => {
  const buf = await makeClaudeDocx({ title: 'Hand added brief', created: '2026-06-26T10:12:00.000Z', body: 'Added by hand.' });
  const tmpFile = join(TMP, 'hand-added.docx');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmpFile, buf);
  const wanted = page.locator('[data-testid="wanted-card"]').first();
  await wanted.locator('[data-testid="attach-original"]').setInputFiles(tmpFile);
  await expect(page.locator('[data-testid="file-card"]', { hasText: 'Hand added brief' })).toBeVisible({ timeout: 15_000 });
  const row = page.locator('[data-testid="file-card"]', { hasText: 'Hand added brief' });
  const downloadPromise = page.waitForEvent('download');
  await row.locator('.file-dl-btn').click();
  expect(Buffer.compare(readFileSync(await (await downloadPromise).path()), buf)).toBe(0);
});

test('saved files survive a restart', async () => {
  await page.reload();
  await expect(page.locator('.lib-head h1')).toHaveText('Your files', { timeout: 20_000 });
  await expect(page.locator('[data-testid="file-card"]', { hasText: 'Reference sheet 8837' })).toBeVisible({ timeout: 15_000 });
});

test('a lapsed permission is impossible to miss and one click fixes it', async () => {
  await page.evaluate(() => {
    let granted = false;
    window.__atlasTest.injectDirHandle({
      name: 'Downloads (lapsed)',
      kind: 'directory',
      async *values() {},
      queryPermission: async () => (granted ? 'granted' : 'prompt'),
      requestPermission: async () => {
        granted = true;
        return 'granted';
      },
    });
  });
  const banner = page.locator('[data-testid="watch-banner"]');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText('stopped watching');
  const primary = banner.locator('.primary-btn');
  await expect(primary).toHaveText('Allow watching again');
  await primary.click();
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
});

test('adding files by hand brings in a whole batch', async () => {
  const a = await makeClaudeDocx({ title: 'Batch one', created: '2026-06-10T09:00:00.000Z', body: 'One.' });
  const b = await makeClaudeDocx({ title: 'Batch two', created: '2026-06-11T09:00:00.000Z', body: 'Two.' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(TMP, 'batch-one.docx'), a);
  writeFileSync(join(TMP, 'batch-two.docx'), b);
  await page.setInputFiles('[data-testid="pick-files"]', [join(TMP, 'batch-one.docx'), join(TMP, 'batch-two.docx')]);
  await expect(page.locator('[data-testid="file-card"]', { hasText: 'Batch one' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="file-card"]', { hasText: 'Batch two' })).toBeVisible();
});

test('the auto-save folder receives only real files', async () => {
  await page.evaluate(() => {
    window.__saves = [];
    window.__atlasTest.injectSaveHandle({
      name: 'Chat Atlas Documents (test)',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (blob) => {
            window.__saves.push({ name, size: blob.size });
          },
          close: async () => {},
        }),
      }),
    });
  });
  await expect(page.locator('.savefolder-bar', { hasText: 'Chat Atlas Documents (test)' })).toBeVisible();
  await page.locator('.savefolder-bar .ghost-btn', { hasText: 'Copy all there now' }).click();
  await expect(page.locator('.toast', { hasText: 'to the folder' })).toBeVisible({ timeout: 30_000 });
  const saves = await page.evaluate(() => window.__saves);
  const storedNames = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="file-card"] .file-card-name')].map((n) => n.textContent),
  );
  expect(saves.length).toBeGreaterThan(0);
  // Nothing invented: every written filename is one we actually hold.
  expect(saves.every((s) => storedNames.includes(s.name))).toBe(true);
});

test('the update endpoints and the Update button behave', async () => {
  // The local server reports the app's version.
  const version = await page.evaluate(async () => (await (await fetch('/__atlas/version')).json()).version);
  const { readFileSync: rf } = await import('node:fs');
  const expected = JSON.parse(rf(new URL('../version.json', import.meta.url), 'utf8')).version;
  expect(version).toBe(expected);

  // The update check degrades gracefully (remote may be null offline).
  const check = await page.evaluate(async () => await (await fetch('/__atlas/update-check')).json());
  expect(check.local).toBe(expected);
  expect('remote' in check).toBe(true);

  // A POST without the guard header is refused.
  const status = await page.evaluate(async () => (await fetch('/__atlas/update', { method: 'POST' })).status);
  expect(status).toBe(403);

  // The running version is always visible next to the logo.
  await expect(page.locator('.version-tag')).toHaveText(`v${expected}`);

  // When a newer version exists, the Update button appears.
  await page.evaluate(() => window.__atlasTest.setUpdate({ local: 1, remote: 99 }));
  await expect(page.locator('[data-testid="update-btn"]')).toContainText('Update to v99');
  await page.evaluate((v) => window.__atlasTest.setUpdate({ local: v, remote: v }), expected);
  await expect(page.locator('[data-testid="update-btn"]')).toHaveCount(0);
});

test('a big export imports without freezing the app', async () => {
  test.setTimeout(180_000);
  const fresh = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await fresh.newPage();
  await p2.goto('/');
  await expect(p2.getByText('Welcome to Chat Atlas')).toBeVisible({ timeout: 15_000 });
  const start = Date.now();
  await p2.setInputFiles('[data-testid="file-input"]', join(TMP, 'big.zip'));
  await expect(p2.locator('.toast').first()).toContainText('250 new conversations', { timeout: 90_000 });
  const elapsed = (Date.now() - start) / 1000;
  expect(elapsed).toBeLessThan(60);
  await p2.locator('.side-item', { hasText: 'Overview' }).click();
  await expect(p2.locator('.lib-row').first()).toBeVisible({ timeout: 15_000 });
  await fresh.close();
});
