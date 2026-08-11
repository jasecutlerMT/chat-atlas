// Turns a CompiledDoc into a real Word file, entirely in the browser.
// Loaded via dynamic import so the docx library stays out of the initial
// bundle. The contents page is hand-built (plain paragraphs) rather than a
// Word TOC field, which would prompt to "update fields" in Word and is
// ignored by Pages and Google Docs.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { CompiledDoc } from './compile';
import { formatDate } from './text';

type MdNode = {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  url?: string;
  lang?: string;
  align?: (string | null)[];
};

const MONO = { font: 'Courier New', size: 19 } as const;
const CODE_SHADE = { type: ShadingType.CLEAR, fill: 'F2F0EC' } as const;

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

let orderedListInstance = 0;

function inlineRuns(nodes: MdNode[] | undefined, style: RunStyle = {}): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  for (const n of nodes ?? []) {
    try {
      if (n.type === 'text') {
        runs.push(new TextRun({ text: n.value ?? '', bold: style.bold, italics: style.italics, strike: style.strike, ...(style.code ? MONO : {}) }));
      } else if (n.type === 'strong') {
        runs.push(...inlineRuns(n.children, { ...style, bold: true }));
      } else if (n.type === 'emphasis') {
        runs.push(...inlineRuns(n.children, { ...style, italics: true }));
      } else if (n.type === 'delete') {
        runs.push(...inlineRuns(n.children, { ...style, strike: true }));
      } else if (n.type === 'inlineCode') {
        runs.push(new TextRun({ text: n.value ?? '', ...MONO, shading: CODE_SHADE }));
      } else if (n.type === 'link') {
        runs.push(
          new ExternalHyperlink({
            link: n.url ?? '',
            children: inlineRuns(n.children, style).filter((r): r is TextRun => r instanceof TextRun),
          }),
        );
      } else if (n.type === 'break') {
        runs.push(new TextRun({ break: 1 }));
      } else if (n.type === 'image') {
        runs.push(new TextRun({ text: `[image: ${n.url ?? ''}]`, italics: true }));
      } else if (n.children) {
        runs.push(...inlineRuns(n.children, style));
      } else if (n.value) {
        runs.push(new TextRun({ text: n.value }));
      }
    } catch {
      runs.push(new TextRun({ text: plainText(n) }));
    }
  }
  return runs;
}

function plainText(node: MdNode): string {
  if (node.value) return node.value;
  return (node.children ?? []).map(plainText).join('');
}

function headingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  // Section titles are Heading1, so markdown headings start one level down.
  switch (Math.min(depth + 1, 6)) {
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

function blockToDocx(node: MdNode, out: (Paragraph | Table)[], listDepth = 0, listRef?: string, listInstance?: number): void {
  try {
    switch (node.type) {
      case 'heading':
        out.push(new Paragraph({ heading: headingLevel(node.depth ?? 2), children: inlineRuns(node.children) }));
        break;
      case 'paragraph':
        out.push(
          new Paragraph({
            children: inlineRuns(node.children),
            spacing: { after: 140 },
            ...(listRef
              ? { numbering: { reference: listRef, level: Math.min(listDepth, 3), instance: listInstance ?? 0 } }
              : {}),
            ...(!listRef && listDepth > 0 ? { bullet: { level: Math.min(listDepth, 3) } } : {}),
          }),
        );
        break;
      case 'list': {
        const ordered = !!node.ordered;
        const instance = ordered ? ++orderedListInstance : undefined;
        for (const item of node.children ?? []) {
          let first = true;
          for (const child of item.children ?? []) {
            if (child.type === 'paragraph' && first) {
              blockToDocx(child, out, listDepth, ordered ? 'atlas-ol' : undefined, instance);
            } else if (child.type === 'list') {
              blockToDocx(child, out, listDepth + 1);
            } else {
              blockToDocx(child, out, listDepth);
            }
            first = false;
          }
        }
        break;
      }
      case 'code': {
        const lines = (node.value ?? '').split('\n');
        for (const line of lines) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line || ' ', ...MONO })],
              shading: CODE_SHADE,
              spacing: { after: 0 },
              indent: { left: 240 },
            }),
          );
        }
        out.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
        break;
      }
      case 'blockquote':
        for (const child of node.children ?? []) {
          const before = out.length;
          blockToDocx(child, out);
          for (let i = before; i < out.length; i++) {
            const p = out[i];
            if (p instanceof Paragraph) {
              out[i] = new Paragraph({
                children: inlineRuns([{ type: 'text', value: plainText(child) }], { italics: true }),
                indent: { left: 360 },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C25E3D' } },
                spacing: { after: 140 },
              });
              break;
            }
          }
        }
        break;
      case 'table': {
        const rows = (node.children ?? []).map(
          (row, ri) =>
            new TableRow({
              children: (row.children ?? []).map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: inlineRuns(cell.children, ri === 0 ? { bold: true } : {}) })],
                    shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'EFEDEA' } : undefined,
                  }),
              ),
            }),
        );
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        out.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
        break;
      }
      case 'thematicBreak':
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB' } },
            spacing: { after: 200 },
            children: [],
          }),
        );
        break;
      case 'html':
        // Raw HTML in chat markdown is rare and usually noise; keep the text.
        out.push(new Paragraph({ children: [new TextRun({ text: node.value ?? '', italics: true })], spacing: { after: 140 } }));
        break;
      default:
        if (node.children) for (const child of node.children) blockToDocx(child, out, listDepth);
        else if (node.value) out.push(new Paragraph({ children: [new TextRun({ text: node.value })], spacing: { after: 140 } }));
    }
  } catch {
    // Fail soft: an odd node becomes plain text, never a broken document.
    out.push(new Paragraph({ children: [new TextRun({ text: plainText(node) })], spacing: { after: 140 } }));
  }
}

export async function renderDocxBlob(doc: CompiledDoc): Promise<Blob> {
  orderedListInstance = 0;
  const parser = unified().use(remarkParse).use(remarkGfm);

  const children: (Paragraph | Table)[] = [];

  // Cover
  children.push(
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE, spacing: { before: 2400, after: 200 } }),
    ...(doc.subtitle ? [new Paragraph({ children: [new TextRun({ text: doc.subtitle, italics: true, size: 26 })], spacing: { after: 200 } })] : []),
    new Paragraph({
      children: [
        new TextRun({
          text: `${doc.sections.length} item${doc.sections.length === 1 ? '' : 's'} · compiled by Chat Atlas · ${formatDate(doc.createdAt)}`,
          color: '888888',
        }),
      ],
      spacing: { after: 400 },
    }),
  );

  // Contents (hand-built)
  if (doc.sections.length > 1) {
    children.push(new Paragraph({ children: [new PageBreak()] }), new Paragraph({ text: 'Contents', heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));
    doc.sections.forEach((s, i) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${i + 1}.  ${s.title}`, bold: true }),
            new TextRun({ text: `   —  ${s.typeLabel}, ${s.date}`, color: '888888' }),
          ],
          spacing: { after: 80 },
        }),
      );
    });
  }

  // Sections
  doc.sections.forEach((s, i) => {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1, spacing: { after: 60 } }),
      new Paragraph({
        children: [
          new TextRun({
            text: [s.typeLabel, s.date, s.sourceConv ? `from “${s.sourceConv}”` : '', s.entityLabels.join(', ')]
              .filter(Boolean)
              .join('  ·  '),
            color: '888888',
            size: 19,
          }),
        ],
        spacing: { after: 240 },
      }),
    );
    try {
      const tree = parser.parse(s.markdown) as unknown as MdNode;
      for (const block of tree.children ?? []) blockToDocx(block, children);
    } catch {
      children.push(new Paragraph({ children: [new TextRun({ text: s.markdown })] }));
    }
    void i;
  });

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'atlas-ol',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 300 } } },
      },
    },
    sections: [{ children }],
  });

  return Packer.toBlob(document);
}
