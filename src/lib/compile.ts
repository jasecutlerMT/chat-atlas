// Builds the shared "compiled document" model that all three exporters
// (.docx, print/PDF, markdown) consume, so cover/contents/ordering logic
// exists exactly once.

import type { Entity, FileMoment, OutputCard } from '../types';
import { OUTPUT_TYPE_LABELS } from './classify';
import { formatDate } from './text';
import { outputFullText } from './download';
import { getConversation } from '../db/db';

export interface CompiledSection {
  title: string;
  typeLabel: string;
  date: string;
  sourceConv: string;
  entityLabels: string[];
  markdown: string;
}

export interface CompiledDoc {
  title: string;
  subtitle?: string;
  createdAt: string;
  sections: CompiledSection[];
}

export async function compileOutputs(
  title: string,
  subtitle: string | undefined,
  cards: OutputCard[],
  entities: Entity[],
): Promise<CompiledDoc> {
  const entityById = new Map(entities.map((e) => [e.id, e.label]));
  const sections: CompiledSection[] = [];
  for (const card of cards) {
    const markdown = await outputFullText(card);
    sections.push({
      title: card.title,
      typeLabel: OUTPUT_TYPE_LABELS[card.type],
      date: formatDate(card.date),
      sourceConv: card.convName,
      entityLabels: card.entityIds.map((id) => entityById.get(id)).filter(Boolean) as string[],
      markdown: markdown || card.preview,
    });
  }
  return { title, subtitle, createdAt: new Date().toISOString(), sections };
}

/** A rebuildable document for one file-moment: the content behind "that file Claude made". */
export async function compileMoment(m: FileMoment): Promise<CompiledDoc> {
  const conv = await getConversation(m.convId);
  const msg = conv?.messages.find((x) => x.uuid === m.sourceMsgId);
  const markdown = msg?.text?.trim() || 'The words behind this file were not included in the export.';
  const title =
    m.fileNames[0]?.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || m.convName;
  return {
    title,
    createdAt: new Date().toISOString(),
    sections: [
      {
        title,
        typeLabel: 'Document',
        date: formatDate(m.date),
        sourceConv: m.convName,
        entityLabels: [],
        markdown,
      },
    ],
  };
}

export function compiledToMarkdown(doc: CompiledDoc): string {
  const lines: string[] = [`# ${doc.title}`, ''];
  if (doc.subtitle) lines.push(doc.subtitle, '');
  lines.push(`*Compiled by Chat Atlas on ${formatDate(doc.createdAt)} · ${doc.sections.length} item${doc.sections.length === 1 ? '' : 's'}*`, '');
  if (doc.sections.length > 1) {
    lines.push('## Contents', '');
    doc.sections.forEach((s, i) => lines.push(`${i + 1}. ${s.title} — ${s.typeLabel}, ${s.date}`));
    lines.push('');
  }
  for (const s of doc.sections) {
    lines.push('---', '', `## ${s.title}`, '', `*${s.typeLabel} · ${s.date} · from “${s.sourceConv}”*`, '', s.markdown, '');
  }
  return lines.join('\n');
}
