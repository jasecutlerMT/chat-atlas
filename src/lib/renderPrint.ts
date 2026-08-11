// PDF export without any PDF library: build a beautifully print-styled page
// in a new window and hand it to Chrome's built-in "Save as PDF".
//
// Popup-blocker rule: the window MUST be opened synchronously inside the
// click handler. Callers open it first (openPrintWindow) and we fill it in
// once the async compilation finishes.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/Markdown';
import type { CompiledDoc } from './compile';
import { formatDate } from './text';

export function openPrintWindow(): Window | null {
  return window.open('', '_blank');
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1c1d22; margin: 0; line-height: 1.6; }
  @page { margin: 22mm 18mm; }
  .cover { min-height: 60vh; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover h1 { font-size: 34px; margin: 0 0 10px; letter-spacing: -0.01em; }
  .cover .subtitle { font-size: 17px; color: #555; font-style: italic; margin: 0 0 18px; }
  .cover .meta { color: #888; font-size: 13px; }
  .contents { page-break-after: always; }
  .contents h2 { font-size: 22px; }
  .contents ol { padding-left: 20px; }
  .contents li { margin: 7px 0; }
  .contents .m { color: #888; font-size: 13px; }
  .section { page-break-before: always; }
  .section:first-of-type { page-break-before: auto; }
  .section > h2 { font-size: 23px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .section .meta { color: #888; font-size: 12.5px; margin: 0 0 18px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
  .md h1 { font-size: 20px; } .md h2 { font-size: 18px; } .md h3 { font-size: 16px; }
  .md pre { background: #f4f2ee; border: 1px solid #e2ded8; border-radius: 6px; padding: 12px; overflow-x: auto;
            font-family: 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .md code { background: #f4f2ee; padding: 1px 4px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.9em; }
  .md pre code { background: none; padding: 0; }
  .md blockquote { border-left: 3px solid #c25e3d; margin: 10px 0; padding: 2px 14px; color: #555; }
  .md table { border-collapse: collapse; width: 100%; font-size: 13px; }
  .md th, .md td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  .md th { background: #efede9; }
  .md a { color: #c25e3d; }
  .md img { max-width: 100%; }
  .code-block-bar, .copy-btn { display: none !important; }
`;

export function fillPrintWindow(w: Window, doc: CompiledDoc): void {
  const sectionsHtml = doc.sections
    .map((s, i) => {
      const body = renderToStaticMarkup(createElement(Markdown, { text: s.markdown, plain: true }));
      const meta = [s.typeLabel, s.date, s.sourceConv ? `from “${s.sourceConv}”` : '', s.entityLabels.join(', ')]
        .filter(Boolean)
        .join(' · ');
      return `<section class="section" id="s${i}"><h2>${escapeHtml(s.title)}</h2><p class="meta">${escapeHtml(meta)}</p>${body}</section>`;
    })
    .join('\n');

  const contents =
    doc.sections.length > 1
      ? `<nav class="contents"><h2>Contents</h2><ol>${doc.sections
          .map((s) => `<li>${escapeHtml(s.title)} <span class="m">— ${escapeHtml(`${s.typeLabel}, ${s.date}`)}</span></li>`)
          .join('')}</ol></nav>`
      : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${PRINT_CSS}</style></head><body>
    <div class="cover"><h1>${escapeHtml(doc.title)}</h1>${doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : ''}
      <p class="meta">${doc.sections.length} item${doc.sections.length === 1 ? '' : 's'} · compiled by Chat Atlas · ${escapeHtml(formatDate(doc.createdAt))}</p></div>
    ${contents}
    ${sectionsHtml}
  </body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the window a beat to lay out before the print dialog appears.
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* the user may have closed it */
    }
  }, 350);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
