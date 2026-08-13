// Shared download and text-fetch helpers used by rows, pages and dialogs.

import { getConversation } from '../db/db';
import type { OutputCard } from '../types';

export function safeFilename(name: string, ext: string): string {
  const base = name
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return (base || 'chat-atlas-export') + ext;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Attach before clicking, and release the URL long after: revoking it
  // straight away can truncate a large download, and handing over the exact
  // bytes is the whole point of this app.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

export function downloadText(name: string, text: string, ext = '.md', mime = 'text/markdown'): void {
  downloadBlob(new Blob([text], { type: mime }), safeFilename(name, ext));
}

/** Full message text behind an output card, fetched from the local database. */
export async function outputFullText(card: OutputCard): Promise<string> {
  const conv = await getConversation(card.convId);
  const msg = conv?.messages.find((m) => m.uuid === card.msgId);
  return msg?.text ?? '';
}
