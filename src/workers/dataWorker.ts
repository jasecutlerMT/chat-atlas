// The heavy-lifting background thread. It owns:
//  - unzipping + parsing export files (via the adapter registry)
//  - merging into IndexedDB by conversation uuid, newest updated_at wins
//  - the MiniSearch full-text index (built here, queried here)
//  - derived artefacts: TF-IDF keywords, map edges, clusters, output cards
// The page thread only ever sends small messages and receives small results,
// so the interface stays responsive no matter how big the export is.

import MiniSearch from 'minisearch';
import { registerAdapter, findAdapter } from '../adapters/adapter';
import { claudeExportAdapter } from '../adapters/claudeExport';
import {
  getAllConversations,
  getConversation,
  putConversations,
  getSkipped,
  setSkipped,
  setDerived,
  setMeta,
} from '../db/db';
import { computeTfidf } from '../lib/tfidf';
import { extractOutputs } from '../lib/classify';
import { countWords, firstLine } from '../lib/text';
import type {
  Conversation,
  ConvMeta,
  FromWorker,
  OutputCard,
  SearchFilters,
  SearchHit,
  SkippedItem,
  SnippetPart,
  ToWorker,
} from '../types';

registerAdapter(claudeExportAdapter);

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

interface SearchDoc {
  id: string; // convId/msgId
  convId: string;
  msgId: string;
  convName: string;
  sender: 'human' | 'assistant';
  date: string;
  text: string;
  attachmentText: string;
  hasCode: boolean;
  hasTable: boolean;
  isLong: boolean;
  hasAttachment: boolean;
}

let index: MiniSearch<SearchDoc> | null = null;
/** Full doc text kept here for snippet building and filters. */
const docStore = new Map<string, SearchDoc>();
/** convId -> its doc ids, so a replaced conversation can be cleanly re-indexed. */
const convDocIds = new Map<string, string[]>();

function newIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ['text', 'attachmentText', 'convName'],
    storeFields: [],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
      boost: { convName: 1.5 },
    },
  });
}

function docsFor(conv: Conversation): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const m of conv.messages) {
    const attachmentText = m.attachments
      .map((a) => [a.file_name, a.extracted_content].filter(Boolean).join('\n'))
      .join('\n');
    if (!m.text.trim() && !attachmentText.trim()) continue;
    docs.push({
      id: `${conv.uuid}/${m.uuid}`,
      convId: conv.uuid,
      msgId: m.uuid,
      convName: conv.name,
      sender: m.sender,
      date: m.created_at || conv.updated_at,
      text: m.text,
      attachmentText,
      hasCode: m.hasCode,
      hasTable: m.hasTable,
      isLong: m.isLong,
      hasAttachment: m.hasAttachment,
    });
  }
  return docs;
}

function indexConversation(conv: Conversation): void {
  if (!index) index = newIndex();
  const old = convDocIds.get(conv.uuid);
  if (old) {
    for (const id of old) {
      if (index.has(id)) index.discard(id);
      docStore.delete(id);
    }
  }
  const docs = docsFor(conv);
  index.addAll(docs);
  for (const d of docs) docStore.set(d.id, d);
  convDocIds.set(
    conv.uuid,
    docs.map((d) => d.id),
  );
}

// ---- derived data ----

function buildDerived(convs: Conversation[]): void {
  post({ t: 'progress', label: 'Mapping connections between conversations…', pct: 0.8 });
  const tfidf = computeTfidf(convs);
  const convMeta: ConvMeta[] = convs.map((c) => ({
    uuid: c.uuid,
    name: c.name,
    created_at: c.created_at,
    updated_at: c.updated_at,
    projectUuid: c.projectUuid,
    projectName: c.projectName,
    messageCount: c.messages.length,
    wordCount: c.messages.reduce((s, m) => s + countWords(m.text), 0),
    keywords: tfidf.keywords.get(c.uuid) ?? [],
    terms: tfidf.terms.get(c.uuid) ?? [],
    cluster: tfidf.clusters.get(c.uuid) ?? 0,
    firstLine: firstLine(c.messages[0]?.text ?? ''),
  }));
  post({ t: 'progress', label: 'Collecting your outputs…', pct: 0.9 });
  const outputs: OutputCard[] = [];
  for (const c of convs) outputs.push(...extractOutputs(c));
  outputs.sort((a, b) => (a.date < b.date ? 1 : -1));
  convMeta.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  void setDerived({ convMeta, edges: tfidf.edges, outputs });
}

// ---- import ----

async function handleImport(buf: ArrayBuffer, fileName: string): Promise<void> {
  post({ t: 'progress', label: 'Opening the export…', pct: 0.05 });
  const adapter = await findAdapter(buf, fileName);
  if (!adapter) {
    post({
      t: 'imported',
      summary: {
        fileName,
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: [
          {
            where: fileName,
            reason: 'This file does not look like a Claude.ai export (no conversations.json inside), so it was left alone.',
          },
        ],
      },
    });
    return;
  }

  post({ t: 'progress', label: 'Reading conversations…', pct: 0.2 });
  const { conversations, skipped } = await adapter.parse(buf, fileName);

  post({ t: 'progress', label: 'Merging with what you already have…', pct: 0.5 });
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const toWrite: Conversation[] = [];
  for (const incoming of conversations) {
    const existing = await getConversation(incoming.uuid);
    if (!existing) {
      added++;
      toWrite.push(incoming);
    } else if (incoming.updated_at > existing.updated_at) {
      updated++;
      toWrite.push(incoming);
    } else {
      unchanged++;
    }
  }
  await putConversations(toWrite);

  post({ t: 'progress', label: 'Updating the search index…', pct: 0.65 });
  for (const c of toWrite) indexConversation(c);

  const all = await getAllConversations();
  if (toWrite.length > 0) buildDerived(all);

  // Keep the skipped-items panel current: latest import's issues replace older ones.
  const prevSkipped = await getSkipped();
  const merged: SkippedItem[] = toWrite.length > 0 || skipped.length > 0 ? skipped : prevSkipped;
  await setSkipped(merged);
  await setMeta('lastImportAt', new Date().toISOString());
  await setMeta('lastImportFile', fileName);

  post({ t: 'progress', label: 'Done', pct: 1 });
  post({
    t: 'imported',
    summary: { fileName, added, updated, unchanged, skipped: merged },
  });
}

// ---- search ----

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeSnippet(text: string, terms: string[]): SnippetPart[] {
  const lower = text.toLowerCase();
  let firstPos = -1;
  for (const t of terms) {
    const p = lower.indexOf(t.toLowerCase());
    if (p !== -1 && (firstPos === -1 || p < firstPos)) firstPos = p;
  }
  if (firstPos === -1) firstPos = 0;
  let start = Math.max(0, firstPos - 70);
  let end = Math.min(text.length, firstPos + 160);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < firstPos) start = sp + 1;
  }
  const windowText = (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
  if (terms.length === 0) return [{ text: windowText, hl: false }];
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts: SnippetPart[] = [];
  let last = 0;
  for (const m of windowText.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: windowText.slice(last, i), hl: false });
    parts.push({ text: m[0], hl: true });
    last = i + m[0].length;
  }
  if (last < windowText.length) parts.push({ text: windowText.slice(last), hl: false });
  return parts;
}

function runSearch(id: number, q: string, filters: SearchFilters): void {
  if (!index || !q.trim()) {
    post({ t: 'results', id, hits: [], matchedConvIds: [], totalHits: 0 });
    return;
  }
  const scope = filters.scopeConvIds ? new Set(filters.scopeConvIds) : null;
  const results = index.search(q, {
    filter: (r) => {
      const d = docStore.get(String(r.id));
      if (!d) return false;
      if (scope && !scope.has(d.convId)) return false;
      if (filters.sender && d.sender !== filters.sender) return false;
      if (filters.convId && d.convId !== filters.convId) return false;
      if (filters.hasCode && !d.hasCode) return false;
      if (filters.hasTable && !d.hasTable) return false;
      if (filters.isLong && !d.isLong) return false;
      if (filters.hasAttachment && !d.hasAttachment) return false;
      if (filters.from && d.date && d.date.slice(0, 10) < filters.from) return false;
      if (filters.to && d.date && d.date.slice(0, 10) > filters.to) return false;
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        if (!d.text.toLowerCase().includes(kw) && !d.convName.toLowerCase().includes(kw)) return false;
      }
      return true;
    },
  });

  const matchedConvIds = [...new Set(results.map((r) => docStore.get(String(r.id))?.convId).filter(Boolean))] as string[];
  const hits: SearchHit[] = [];
  for (const r of results.slice(0, 60)) {
    const d = docStore.get(String(r.id));
    if (!d) continue;
    const terms = (r.terms ?? []).filter((t: string) => t.length > 1);
    const inText = d.text && terms.some((t) => d.text.toLowerCase().includes(t.toLowerCase()));
    const source = inText || !d.attachmentText ? d.text : d.attachmentText;
    hits.push({
      convId: d.convId,
      msgId: d.msgId,
      convName: d.convName,
      sender: d.sender,
      date: d.date,
      snippet: makeSnippet(source || d.attachmentText || '', terms),
      fromAttachment: !inText && !!d.attachmentText,
      score: r.score,
    });
  }
  post({ t: 'results', id, hits, matchedConvIds, totalHits: results.length });
}

// ---- boot ----

async function init(): Promise<void> {
  const all = await getAllConversations();
  index = newIndex();
  docStore.clear();
  convDocIds.clear();
  for (const c of all) indexConversation(c);
  post({ t: 'ready', convCount: all.length });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  (async () => {
    try {
      if (msg.t === 'init') await init();
      else if (msg.t === 'import') await handleImport(msg.buf, msg.fileName);
      else if (msg.t === 'search') runSearch(msg.id, msg.q, msg.filters);
    } catch (err) {
      post({ t: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
