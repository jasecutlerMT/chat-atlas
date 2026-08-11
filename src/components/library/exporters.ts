// Bridges UI actions to the document renderers. The print window must open
// synchronously inside the click, so the PDF path opens it first and fills
// it once compilation finishes.

import type { Entity, FileMoment, OutputCard } from '../../types';
import { compileMoment, compileOutputs, compiledToMarkdown, type CompiledDoc } from '../../lib/compile';
import { downloadBlob, downloadText, safeFilename } from '../../lib/download';
import { fillPrintWindow, openPrintWindow } from '../../lib/renderPrint';

export async function exportCompiled(doc: CompiledDoc, format: 'docx' | 'md'): Promise<void> {
  if (format === 'md') {
    downloadText(doc.title, compiledToMarkdown(doc));
    return;
  }
  const { renderDocxBlob } = await import('../../lib/renderDocx');
  const blob = await renderDocxBlob(doc);
  downloadBlob(blob, safeFilename(doc.title, '.docx'));
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

export async function exportMoment(moment: FileMoment, format: 'docx' | 'pdf' | 'md'): Promise<void> {
  if (format === 'pdf') {
    exportCompiledPdf(() => compileMoment(moment));
    return;
  }
  const doc = await compileMoment(moment);
  await exportCompiled(doc, format);
}
