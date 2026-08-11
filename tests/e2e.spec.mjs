// End-to-end walkthrough of Chat Atlas v2 (the Library redesign) in real
// Chromium. Runs serially against one shared page so IndexedDB state carries
// between steps, the way a real session does.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixtures, TMP } from './fixtures/make-fixture.mjs';

test.describe.configure({ mode: 'serial' });

let context;
let page;

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
  await expect(page.locator('[data-testid="file-card"]').first()).toBeVisible();
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
  await expect(page.locator('.secondary-btn', { hasText: 'Make one document' })).toBeVisible();
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
  await page.locator('.secondary-btn', { hasText: 'Make one document' }).click();
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
  await page.locator('.secondary-btn', { hasText: 'Make one document' }).click();
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
});

test('Your files lists every file and Download makes a real Word file', async () => {
  await page.locator('.side-item', { hasText: 'Your files' }).click();
  const row = page.locator('[data-testid="file-card"]', { hasText: 'Acme Logistics Brief' });
  await expect(row).toBeVisible();
  await expect(row.locator('.file-card-status')).toContainText('makes a fresh copy');
  // The Word filter keeps it visible; the Download button makes a real .docx.
  await page.locator('.chip', { hasText: /^Word$/ }).click();
  await expect(page.locator('[data-testid="file-card"]', { hasText: 'Acme Logistics Brief' })).toBeVisible();
  await page.locator('.chip', { hasText: /^All/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await row.locator('.file-dl-btn').click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const docXml = await zip.file('word/document.xml').async('string');
  expect(docXml).toContain('Acme Logistics');
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  // Markdown is gone from the interface.
  expect(await page.getByText('Markdown').count()).toBe(0);
});

test('the exact original file is caught from the watched folder and kept', async () => {
  const ORIGINAL_BYTES = 'ORIGINAL-DOCX-BYTES-FROM-CLAUDE-9f3a';
  await page.evaluate((bytes) => {
    const file = new File([bytes], 'acme-logistics-brief.docx', { lastModified: Date.now() });
    const fakeHandle = {
      name: 'Downloads (test)',
      kind: 'directory',
      async *values() {
        yield { kind: 'file', name: file.name, getFile: async () => file };
      },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    };
    window.__atlasTest.injectDirHandle(fakeHandle);
  }, ORIGINAL_BYTES);
  await expect(page.locator('.toast', { hasText: 'Saved “acme-logistics-brief.docx”' })).toBeVisible({ timeout: 20_000 });

  const row = page.locator('[data-testid="file-card"]', { hasText: 'Acme Logistics Brief' });
  await expect(row.locator('.file-card-status')).toContainText('exact file');
  const downloadPromise = page.waitForEvent('download');
  await row.locator('.file-dl-btn').click();
  const download = await downloadPromise;
  expect(readFileSync(await download.path(), 'utf8')).toBe(ORIGINAL_BYTES);

  // The saved file survives a restart.
  await page.reload();
  await expect(page.locator('.lib-head h1')).toHaveText('Your files', { timeout: 20_000 });
  await expect(
    page.locator('[data-testid="file-card"]', { hasText: 'Acme Logistics Brief' }).locator('.file-card-status'),
  ).toContainText('exact file', { timeout: 15_000 });
});

test('a file named like Claude names downloads still finds its conversation', async () => {
  // "Sydney tech target list" chat; downloaded file "SydneyTechTargetList100.docx".
  await page.evaluate(() => {
    const file = new File(['SYDNEY-LIST-ORIGINAL-BYTES'], 'SydneyTechTargetList100.docx', { lastModified: Date.now() });
    const fakeHandle = {
      name: 'Downloads (test)',
      kind: 'directory',
      async *values() {
        yield { kind: 'file', name: file.name, getFile: async () => file };
      },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    };
    window.__atlasTest.injectDirHandle(fakeHandle);
  });
  await expect(page.locator('.toast', { hasText: 'SydneyTechTargetList100.docx' })).toBeVisible({ timeout: 20_000 });
  const row = page.locator('[data-testid="file-card"]', { hasText: 'Sydney Tech Target List 100' });
  await expect(row).toBeVisible();
  await expect(row.locator('.file-card-sub')).toContainText('Sydney tech target list');
  await expect(row.locator('.file-card-status')).toContainText('exact file');

  // Searching finds the file first, with a working Download button.
  await page.fill('.search-bar input', 'sydney');
  const hit = page.locator('[data-testid="search-file-hit"]', { hasText: 'Sydney' }).first();
  await expect(hit).toBeVisible({ timeout: 10_000 });
  const downloadPromise = page.waitForEvent('download');
  await hit.locator('.result-file-dl').click();
  expect(readFileSync(await (await downloadPromise).path(), 'utf8')).toBe('SYDNEY-LIST-ORIGINAL-BYTES');
  await page.fill('.search-bar input', '');
  await page.keyboard.press('Escape');
});

test('an original can be attached by hand to an old file-moment', async () => {
  const row = page.locator('[data-testid="file-card"]', { hasText: 'Northwind Negotiation Plan' });
  await expect(row).toBeVisible();
  await expect(row.locator('.file-card-status')).toContainText('makes a fresh copy');
  const tmpFile = join(TMP, 'northwind-negotiation-plan.pdf');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmpFile, 'HAND-ATTACHED-ORIGINAL-PDF');
  await row.locator('[data-testid="attach-original"]').setInputFiles(tmpFile);
  await expect(row.locator('.file-card-status')).toContainText('exact file');
  const downloadPromise = page.waitForEvent('download');
  await row.locator('.file-dl-btn').click();
  expect(readFileSync(await (await downloadPromise).path(), 'utf8')).toBe('HAND-ATTACHED-ORIGINAL-PDF');
});

test('the auto-save folder receives real files', async () => {
  await page.evaluate(() => {
    window.__saves = [];
    const mock = {
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
    };
    window.__atlasTest.injectSaveHandle(mock);
  });
  await expect(page.locator('.savefolder-bar', { hasText: 'Chat Atlas Documents (test)' })).toBeVisible();
  await page.locator('.savefolder-bar .ghost-btn', { hasText: 'Copy all there now' }).click();
  await expect(page.locator('.toast', { hasText: 'to the folder' })).toBeVisible({ timeout: 30_000 });
  const saves = await page.evaluate(() => window.__saves);
  expect(saves.length).toBeGreaterThanOrEqual(2); // kept originals + rebuilt docx
  expect(saves.some((s) => s.name === 'acme-logistics-brief.docx')).toBe(true);
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
