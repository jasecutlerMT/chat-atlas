// Adapter for the official Claude.ai data export: a zip containing
// conversations.json (and usually projects.json + users.json) at its root.
// Parsing must fail soft — anything that does not match is skipped with a
// plain-English reason instead of crashing the import.

import JSZip from 'jszip';
import type { Attachment, ChatMessage, Conversation, SkippedItem } from '../types';
import { countWords, detectCode, detectTable } from '../lib/text';
import type { DataSourceAdapter, ParseResult } from './adapter';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Removes "*[tool use content]*"-style placeholders. Older versions of this
 * app wrote them into stored text, and some raw exports carry similar
 * markers; either way they are noise, not words anyone said.
 */
export function stripMachineryPlaceholders(text: string): string {
  if (!text.includes('content]')) return text;
  return text
    .replace(/\*?\[[a-z0-9_ -]{1,40} content\]\*?/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:\s*·\s*)+(?=\s*·|\s*$)/gm, '')
    .trim();
}

function normaliseMessage(raw: Record<string, unknown>, convName: string, skipped: SkippedItem[]): ChatMessage | null {
  const uuid = asString(raw.uuid);
  if (!uuid) {
    skipped.push({ where: `A message in “${convName}”`, reason: 'It has no ID, so it cannot be stored reliably.' });
    return null;
  }
  const senderRaw = asString(raw.sender);
  const sender: 'human' | 'assistant' = senderRaw === 'human' ? 'human' : 'assistant';

  // Prefer joining the structured content blocks; fall back to the flat text
  // field. Only visible prose counts: tool activity, thinking and other
  // machinery blocks are skipped entirely — turning them into placeholder
  // text would pollute titles, previews, search and word counts.
  let text = '';
  if (Array.isArray(raw.content)) {
    const parts: string[] = [];
    for (const block of raw.content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if ((b.type === 'text' || b.type === undefined) && typeof b.text === 'string' && b.text.trim()) {
          parts.push(b.text);
        }
      }
    }
    text = parts.join('\n\n').trim();
  }
  if (!text) text = asString(raw.text).trim();
  text = stripMachineryPlaceholders(text);

  const attachments: Attachment[] = [];
  if (Array.isArray(raw.attachments)) {
    for (const a of raw.attachments) {
      if (a && typeof a === 'object') {
        const ar = a as Record<string, unknown>;
        attachments.push({
          file_name: asString(ar.file_name) || undefined,
          file_type: asString(ar.file_type) || undefined,
          file_size: typeof ar.file_size === 'number' ? ar.file_size : undefined,
          extracted_content: asString(ar.extracted_content) || undefined,
        });
      }
    }
  }
  const fileNames: string[] = [];
  if (Array.isArray(raw.files)) {
    for (const f of raw.files) {
      if (f && typeof f === 'object' && typeof (f as Record<string, unknown>).file_name === 'string') {
        fileNames.push((f as Record<string, string>).file_name);
      }
    }
  }

  const searchableText = text || (attachments.length || fileNames.length ? '' : '');
  return {
    uuid,
    sender,
    text: searchableText,
    created_at: asString(raw.created_at),
    attachments,
    fileNames,
    hasCode: detectCode(text),
    hasTable: detectTable(text),
    isLong: countWords(text) > 300,
    hasAttachment: attachments.length > 0 || fileNames.length > 0,
  };
}

export function parseConversations(
  rawConvs: unknown,
  projectNames: Map<string, string>,
): ParseResult {
  const skipped: SkippedItem[] = [];
  const conversations: Conversation[] = [];

  if (!Array.isArray(rawConvs)) {
    skipped.push({
      where: 'conversations.json',
      reason: 'The file is not the expected list of conversations, so nothing could be read from it.',
    });
    return { conversations, skipped };
  }

  for (const raw of rawConvs) {
    try {
      if (!raw || typeof raw !== 'object') {
        skipped.push({ where: 'A conversation entry', reason: 'It is not in a readable format.' });
        continue;
      }
      const r = raw as Record<string, unknown>;
      const uuid = asString(r.uuid);
      const name = asString(r.name) || 'Untitled conversation';
      if (!uuid) {
        skipped.push({ where: `Conversation “${name}”`, reason: 'It has no ID, so it cannot be stored or updated reliably.' });
        continue;
      }

      // Project membership can appear as a nested object or as a bare uuid.
      let projectUuid: string | undefined;
      let projectName: string | undefined;
      if (r.project && typeof r.project === 'object') {
        const p = r.project as Record<string, unknown>;
        projectUuid = asString(p.uuid) || undefined;
        projectName = asString(p.name) || undefined;
      } else if (asString(r.project_uuid)) {
        projectUuid = asString(r.project_uuid);
      }
      if (projectUuid && !projectName) projectName = projectNames.get(projectUuid);

      const messages: ChatMessage[] = [];
      if (Array.isArray(r.chat_messages)) {
        for (const rawMsg of r.chat_messages) {
          if (!rawMsg || typeof rawMsg !== 'object') continue;
          const m = normaliseMessage(rawMsg as Record<string, unknown>, name, skipped);
          if (m) messages.push(m);
        }
      }

      const created = asString(r.created_at);
      const updated = asString(r.updated_at) || created;
      conversations.push({
        uuid,
        name,
        created_at: created || updated,
        updated_at: updated,
        projectUuid,
        projectName,
        messages,
      });
    } catch (err) {
      skipped.push({
        where: 'A conversation entry',
        reason: `Something unexpected in its data stopped it being read (${err instanceof Error ? err.message : 'unknown error'}).`,
      });
    }
  }
  return { conversations, skipped };
}

async function findEntry(zip: JSZip, baseName: string): Promise<JSZip.JSZipObject | null> {
  // The file usually sits at the zip root, but tolerate a nested folder.
  const direct = zip.file(baseName);
  if (direct) return direct;
  const nested = zip.file(new RegExp(`(^|/)${baseName}$`));
  return nested.length ? nested[0] : null;
}

export const claudeExportAdapter: DataSourceAdapter = {
  id: 'claude-export-zip',
  label: 'Claude.ai data export (zip)',

  async sniff(buf: ArrayBuffer, fileName: string): Promise<boolean> {
    if (!/\.zip$/i.test(fileName)) return false;
    try {
      const zip = await JSZip.loadAsync(buf);
      return (await findEntry(zip, 'conversations.json')) !== null;
    } catch {
      return false;
    }
  },

  async parse(buf: ArrayBuffer): Promise<ParseResult> {
    const skipped: SkippedItem[] = [];
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
      return {
        conversations: [],
        skipped: [{ where: 'The zip file', reason: 'It could not be opened — it may be incomplete or not a real zip.' }],
      };
    }

    // projects.json gives us names for project uuids when conversations only carry the id.
    const projectNames = new Map<string, string>();
    const projEntry = await findEntry(zip, 'projects.json');
    if (projEntry) {
      try {
        const projects = JSON.parse(await projEntry.async('string'));
        if (Array.isArray(projects)) {
          for (const p of projects) {
            if (p && typeof p === 'object' && typeof p.uuid === 'string' && typeof p.name === 'string') {
              projectNames.set(p.uuid, p.name);
            }
          }
        }
      } catch {
        skipped.push({ where: 'projects.json', reason: 'The project list could not be read, so project names may be missing.' });
      }
    }

    const convEntry = await findEntry(zip, 'conversations.json');
    if (!convEntry) {
      return {
        conversations: [],
        skipped: [
          ...skipped,
          { where: 'The zip file', reason: 'No conversations.json inside — this does not look like a Claude.ai export.' },
        ],
      };
    }
    let rawConvs: unknown;
    try {
      rawConvs = JSON.parse(await convEntry.async('string'));
    } catch {
      return {
        conversations: [],
        skipped: [...skipped, { where: 'conversations.json', reason: 'The conversation list is not valid JSON and could not be read.' }],
      };
    }
    const result = parseConversations(rawConvs, projectNames);
    return { conversations: result.conversations, skipped: [...skipped, ...result.skipped] };
  },
};
