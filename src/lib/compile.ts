// Builds the shared "compiled document" model behind the Library's
// "Combine these into a new document" feature.
//
// IMPORTANT: everything produced here is a BRAND-NEW document assembled from
// what Claude wrote in the chats. It is never a reproduction of a file Claude
// gave the user — those are only ever served as the exact stored bytes, from
// the Files view. Nothing in this module may be used to answer "give me that
// file again", and its output is always named with a `chat-atlas-` prefix so
// it can never be mistaken for, or overwrite, one of Claude's originals.

import type { Entity, OutputCard } from '../types';
import { OUTPUT_TYPE_LABELS } from './classify';
import { formatDate } from './text';
import { outputFullText } from './download';

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
