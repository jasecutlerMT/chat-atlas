// Finds every "make me a file" moment in the history: the points where Jason
// asked for (or Claude produced) a PDF / Word / spreadsheet file. These power
// the Documents shelf and tell the folder watcher which downloaded files are
// Claude's, so their originals can be kept.

import type { Conversation, FileMoment } from '../types';
import { countWords } from './text';

const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|md|rtf)\b/i;
// No spaces: generated filenames are slug-like; allowing spaces would swallow
// the words before the name ("ve created northwind-plan.pdf").
const FILENAME_RE = /[\w][\w.-]{0,80}\.(pdf|docx?|xlsx?|pptx?|csv|md|rtf)\b/gi;

/** Human asking for a file. */
const ASK_RE =
  /\b(as|into|in|to) a (pdf|word|docx?|document file|doc file|spreadsheet|excel)\b|\bmake (this|it|that) (a|an|into a) (pdf|docx?|word)\b|\bconvert\b.{0,40}\b(pdf|docx?|word|file)\b|\b(pdf|docx?|word) (file|document|version)\b|\bdownload(able)? (file|version|copy)\b/i;

/** Claude announcing a produced file. */
const MADE_RE =
  /\b(i('|’)?ve|i have|here('|’)?s|here is|attached is|i('|’)?ve (also )?(created|generated|prepared|saved|made|put together|exported))\b.{0,80}\b(pdf|docx?|word|file|document|spreadsheet)\b|\bready (for you )?to download\b|\bdownload (it|the file|link)\b/i;

function filenamesIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(FILENAME_RE)) names.add(m[0].trim());
  return [...names];
}

export function detectFileMoments(convs: Conversation[]): FileMoment[] {
  const moments: FileMoment[] = [];
  for (const conv of convs) {
    const msgs = conv.messages;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.sender !== 'assistant') continue;

      const fileRefs = m.fileNames.filter((f) => DOC_EXT.test(f));
      const namedInText = filenamesIn(m.text);
      const announced = MADE_RE.test(m.text);
      // Did any earlier human message ask for a file? (The ask and the file
      // often sit a couple of messages apart: ask → draft → "make it a file".)
      const asked = msgs.slice(0, i).some((x) => x.sender === 'human' && (ASK_RE.test(x.text) || filenamesIn(x.text).length > 0));

      if (fileRefs.length === 0 && namedInText.length === 0 && !(announced && asked)) continue;

      // The message with the file card is often just "here you go" — the
      // substance usually lives in it or in the nearest meaty assistant
      // message before it. That message is what a rebuild uses.
      let sourceMsgId = m.uuid;
      if (countWords(m.text) < 80) {
        for (let j = i - 1; j >= 0; j--) {
          if (msgs[j].sender === 'assistant' && countWords(msgs[j].text) >= 80) {
            sourceMsgId = msgs[j].uuid;
            break;
          }
        }
      }

      moments.push({
        id: `${conv.uuid}/${m.uuid}`,
        convId: conv.uuid,
        msgId: m.uuid,
        sourceMsgId,
        convName: conv.name,
        date: m.created_at || conv.updated_at,
        fileNames: [...new Set([...fileRefs, ...namedInText])],
        asked,
      });
    }
  }
  moments.sort((a, b) => (a.date < b.date ? 1 : -1));
  return moments;
}

/** Every doc-like filename referenced anywhere — the watcher's capture list. */
export function referencedFilenames(moments: FileMoment[]): string[] {
  const names = new Set<string>();
  for (const mo of moments) for (const f of mo.fileNames) names.add(f.toLowerCase());
  return [...names];
}
