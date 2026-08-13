// Bridges UI actions to the document renderers. The print window must open
// synchronously inside the click, so the PDF path opens it first and fills
// it once compilation finishes.

// Exports for the Library's "Combine these into a new document" feature.
//
// Every file produced here is a NEW document built from chat content, so its
// filename always carries the `chat-atlas-` prefix — it can never be confused
// with, or overwrite, one of the original files Claude made. Reproducing one
// of Claude's files is not possible from text and is never attempted: those
// are served as exact stored bytes from the Files view.

import type { Entity, OutputCard } from '../../types';
import { compileOutputs, compiledToMarkdown, type CompiledDoc } from '../../lib/compile';
import { downloadBlob, downloadText, safeFilename } from '../../lib/download';
import { fillPrintWindow, openPrintWindow } from '../../lib/renderPrint';

const NEW_DOC_PREFIX = 'chat-atlas-';

export async function exportCompiled(doc: CompiledDoc, format: 'docx' | 'md'): Promise<void> {
  if (format === 'md') {
    downloadText(NEW_DOC_PREFIX + doc.title, compiledToMarkdown(doc));
    return;
  }
  const { renderDocxBlob } = await import('../../lib/renderDocx');
  const blob = await renderDocxBlob(doc);
  downloadBlob(blob, safeFilename(NEW_DOC_PREFIX + doc.title, '.docx'));
}

export function exportCompiledPdf(build: () => Promise<CompiledDoc>): void {
  // Open the window inside the click; fill it when the document is ready.
  const w = openPrintWindow();
  if (!w) return;
  w.document.write('<p style="font-family:sans-serif;color:#888;padding:24px">Preparing your document…</p>');
  void build().then((doc) => fillPrintWindow(w, doc));
}

export async function exportSingleCard(card: OutputCard, entities: Entity[], format: 'docx' | 'pdf' | 'md'): Promise<void> {
  if (format === 'pdf') {
    exportCompiledPdf(() => compileOutputs(card.title, undefined, [card], entities));
    return;
  }
  const doc = await compileOutputs(card.title, undefined, [card], entities);
  await exportCompiled(doc, format);
}

