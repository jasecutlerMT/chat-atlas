// Reads what a document says about itself.
//
// Files Claude makes carry their own fingerprint. A Claude .docx has
// docProps/core.xml holding the real title and description, `Un-named` as the
// last person to save it, revision 1, created and modified within milliseconds
// of each other — and an EMPTY docProps/app.xml, because no word processor
// ever touched it. Its PDF twin carries /Title and /CreationDate in the Info
// dictionary. Word re-saves the same file and every one of those signals
// changes.
//
// This gives us three things nothing else can: whether a file is Claude's, the
// exact instant Claude made it (the only honest sort key for "when did I get
// this?"), and a human title far better than a mangled filename.
//
// Nothing here ever throws: an unreadable file is "unknown", which is not the
// same as "not Claude's".

import JSZip from 'jszip';

export const IDENTITY_VERSION = 1;

export type FileKind = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'pptx' | 'csv' | 'rtf' | 'other';
export type ProducedAtSource = 'docx-core' | 'pdf-info' | 'pdf-xmp' | 'none';

export interface FileIdentity {
  kind: FileKind;
  /** The instant the file itself records as its creation. */
  producedAt?: string;
  producedAtSource: ProducedAtSource;
  title?: string;
  description?: string;
  creator?: string;
  lastModifiedBy?: string;
  revision?: number;
  application?: string;
  producer?: string;
  creatorTool?: string;
  isClaudeMade: boolean;
  claudeScore: number;
  /** Plain-English reasons, kept so a future diagnosis needs no re-derivation. */
  signals: string[];
  /** Body text of a docx, for matching against conversations. Never shown as a document. */
  sampleText?: string;
}

/**
 * Every docx threshold in one place. If Claude's file format ever changes,
 * this block is the only thing that needs revisiting.
 */
export const DOCX_SIGNALS = {
  noWordProcessorStamp: 40,
  neverOpenedByEditor: 25,
  firstRevision: 15,
  writtenInOneGo: 20,
  noEditorExtraParts: 15,
  carriesTitleAndDescription: 10,
  savedByKnownEditor: -60,
  editedMoreThanOnce: -15,
  realLastSaver: -15,
  /** Claude puts the account holder's name on its documents; generic builders leave it anonymous. */
  anonymousAuthor: -45,
  /** Claude always names its documents. A file with no title of its own is unlikely to be one. */
  noTitleOfItsOwn: -25,
  threshold: 55,
  sameGoMs: 5000,
} as const;

/**
 * Documents this app produced itself carry this line on their cover, and their
 * filenames carry the prefix. They must never be mistaken for Claude's work —
 * this is a hard veto, not a score.
 */
const CHAT_ATLAS_MARKER = /compiled by chat atlas/i;
const CHAT_ATLAS_FILENAME = /^chat-atlas-/i;

const KNOWN_EDITOR = /word|excel|powerpoint|libreoffice|openoffice|pages|numbers|keynote|google|wps|onlyoffice|abiword/i;

/** PDF producers worth treating as a hint that a tool, not a person's editor, made it. */
export const CLAUDE_PDF_PRODUCER_HINTS = [
  /skia\/pdf/i,
  /headless\s*chrom/i,
  /chromium/i,
  /weasyprint/i,
  /reportlab/i,
  /typst/i,
  /pandoc/i,
  /libreoffice/i,
  /wkhtmltopdf/i,
];
const PERSONAL_PDF_PRODUCER = /microsoft|acrobat|distiller|quartz pdfcontext|preview|scanner|xerox|canon|epson|hp\s|foxit|nitro/i;
const PDF_THRESHOLD = 45;

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const MAX_PDF_FULL_BYTES = 25 * 1024 * 1024;
const PDF_EDGE_BYTES = 512 * 1024;
const SAMPLE_TEXT_CHARS = 4000;

export function kindFromName(name: string): FileKind {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  switch (m?.[1]) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'doc':
      return 'doc';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    case 'pptx':
    case 'ppt':
      return 'pptx';
    case 'csv':
      return 'csv';
    case 'rtf':
      return 'rtf';
    default:
      return 'other';
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Reads one XML element's text, ignoring namespace prefixes. The lookahead
 * after the tag name matters: without it `modified` would also match
 * `lastModifiedBy`.
 */
function tagText(xml: string, name: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${name}(?=[\\s>])[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i');
  const raw = xml.match(re)?.[1];
  if (raw === undefined) return undefined;
  const out = decodeEntities(raw).trim();
  return out || undefined;
}

function isoOrUndefined(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function emptyIdentity(kind: FileKind, reason: string): FileIdentity {
  return { kind, producedAtSource: 'none', isClaudeMade: false, claudeScore: 0, signals: [reason] };
}

// ---- docx ----

async function identifyDocx(blob: Blob, kind: FileKind, name: string): Promise<FileIdentity> {
  if (blob.size > MAX_ZIP_BYTES) return emptyIdentity(kind, 'this file is too large to inspect');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await blob.arrayBuffer());
  } catch {
    return emptyIdentity(kind, 'Chat Atlas could not open this file');
  }
  if (!zip.file(/word\/document\.xml$/).length) {
    return emptyIdentity('other', 'this is not a Word file');
  }

  const signals: string[] = [];
  let score = 0;
  const add = (points: number, why: string) => {
    score += points;
    signals.push(why);
  };

  const coreFile = zip.file('docProps/core.xml');
  const core = coreFile ? await coreFile.async('string').catch(() => '') : '';
  const title = core ? tagText(core, 'title') : undefined;
  const description = core ? tagText(core, 'description') : undefined;
  const creator = core ? tagText(core, 'creator') : undefined;
  const lastModifiedByRaw = core ? core.match(/<(?:\w+:)?lastModifiedBy[^>]*>([\s\S]*?)<\//i)?.[1] : undefined;
  const lastModifiedBy = lastModifiedByRaw === undefined ? undefined : decodeEntities(lastModifiedByRaw).trim();
  const revisionText = core ? tagText(core, 'revision') : undefined;
  const revision = revisionText && /^\d+$/.test(revisionText) ? Number(revisionText) : undefined;
  const created = isoOrUndefined(core ? tagText(core, 'created') : undefined);
  const modified = isoOrUndefined(core ? tagText(core, 'modified') : undefined);

  const appFile = zip.file('docProps/app.xml');
  const appXml = appFile ? await appFile.async('string').catch(() => '') : undefined;
  const application = appXml ? tagText(appXml, 'Application') : undefined;

  if (!appFile || !application) add(DOCX_SIGNALS.noWordProcessorStamp, 'no word-processor stamp inside');
  if (lastModifiedBy === '' || lastModifiedBy === 'Un-named') add(DOCX_SIGNALS.neverOpenedByEditor, 'never opened by a word processor');
  if (revision === undefined || revision <= 1) add(DOCX_SIGNALS.firstRevision, 'first and only revision');
  if (created && modified && Math.abs(new Date(created).getTime() - new Date(modified).getTime()) <= DOCX_SIGNALS.sameGoMs) {
    add(DOCX_SIGNALS.writtenInOneGo, 'written in one go');
  }
  if (!zip.file('word/theme/theme1.xml') && !zip.file('word/webSettings.xml')) {
    add(DOCX_SIGNALS.noEditorExtraParts, "none of a word processor's extra parts");
  }
  if (title && description) add(DOCX_SIGNALS.carriesTitleAndDescription, 'carries its own title and description');
  if (!title) add(DOCX_SIGNALS.noTitleOfItsOwn, 'carries no title of its own');
  if (!creator || creator === 'Un-named') add(DOCX_SIGNALS.anonymousAuthor, 'no author name inside');
  if (application && KNOWN_EDITOR.test(application)) add(DOCX_SIGNALS.savedByKnownEditor, `saved by ${application}`);
  if (revision !== undefined && revision >= 2) add(DOCX_SIGNALS.editedMoreThanOnce, 'edited more than once');
  if (lastModifiedBy && lastModifiedBy !== 'Un-named') add(DOCX_SIGNALS.realLastSaver, `last saved by ${lastModifiedBy}`);

  let sampleText: string | undefined;
  const docFile = zip.file('word/document.xml');
  if (docFile) {
    try {
      const xml = await docFile.async('string');
      sampleText = decodeEntities(xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim()
        .slice(0, SAMPLE_TEXT_CHARS);
    } catch {
      /* body text is a bonus, never required */
    }
  }

  // Hard veto: a document this app built itself is never Claude's, whatever
  // else it looks like.
  const ourOwn = CHAT_ATLAS_FILENAME.test(name) || (sampleText ? CHAT_ATLAS_MARKER.test(sampleText) : false);
  const claudeScore = ourOwn ? 0 : Math.max(0, Math.min(100, score));
  return {
    kind,
    producedAt: created,
    producedAtSource: created ? 'docx-core' : 'none',
    title,
    description,
    creator,
    lastModifiedBy,
    revision,
    application,
    isClaudeMade: !ourOwn && claudeScore >= DOCX_SIGNALS.threshold,
    claudeScore,
    signals: ourOwn ? ['Chat Atlas made this document, so it is not one of Claude’s files'] : signals,
    sampleText,
  };
}

// ---- pdf ----

/** Turns "D:20260811063541Z" (and its offset forms) into an ISO string. */
export function parsePdfDate(raw: string): string | undefined {
  const m = raw.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/);
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz, tzh = '00', tzm = '00'] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (tz === '+' || tz === '-') {
    const offset = (Number(tzh) * 60 + Number(tzm)) * 60_000;
    ms += tz === '+' ? -offset : offset;
  }
  const date = new Date(ms);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** PDF strings are either literal "(text)" or UTF-16BE hex "<0054...>". */
function decodePdfString(raw: string, isHex: boolean): string {
  if (isHex) {
    const hex = raw.replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    if (hex.slice(0, 4).toUpperCase() === 'FEFF') {
      for (let i = 4; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    } else {
      for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out.replace(/\u0000/g, '').trim();
  }
  return raw
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function pdfField(text: string, key: string): string | undefined {
  const literal = text.match(new RegExp(`/${key}\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)`));
  if (literal) return decodePdfString(literal[1], false) || undefined;
  const hex = text.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`));
  if (hex) return decodePdfString(hex[1], true) || undefined;
  return undefined;
}

async function identifyPdf(blob: Blob, kind: FileKind): Promise<FileIdentity> {
  let text: string;
  try {
    const decoder = new TextDecoder('latin1');
    if (blob.size <= MAX_PDF_FULL_BYTES) {
      text = decoder.decode(await blob.arrayBuffer());
    } else {
      // Info dictionaries and XMP live near the ends of the file.
      const head = decoder.decode(await blob.slice(0, PDF_EDGE_BYTES).arrayBuffer());
      const tail = decoder.decode(await blob.slice(blob.size - PDF_EDGE_BYTES).arrayBuffer());
      text = head + '\n' + tail;
    }
  } catch {
    return emptyIdentity(kind, 'Chat Atlas could not read this file’s details');
  }

  let producedAt: string | undefined;
  let producedAtSource: ProducedAtSource = 'none';
  const created = pdfField(text, 'CreationDate');
  if (created) {
    const iso = parsePdfDate(created.replace(/^D:/, ''));
    if (iso) {
      producedAt = iso;
      producedAtSource = 'pdf-info';
    }
  }
  if (!producedAt) {
    const xmp = text.match(/<(?:xmp|xap):CreateDate>([^<]+)</i)?.[1];
    const iso = isoOrUndefined(xmp);
    if (iso) {
      producedAt = iso;
      producedAtSource = 'pdf-xmp';
    }
  }

  const title =
    pdfField(text, 'Title') ?? text.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)</i)?.[1]?.trim() ?? undefined;
  const producer = pdfField(text, 'Producer') ?? text.match(/<pdf:Producer>([^<]+)</i)?.[1];
  const creatorTool = pdfField(text, 'Creator') ?? text.match(/<xmp:CreatorTool>([^<]+)</i)?.[1];

  const signals: string[] = [];
  let score = 0;
  const probe = `${producer ?? ''} ${creatorTool ?? ''}`;
  if (CLAUDE_PDF_PRODUCER_HINTS.some((re) => re.test(probe))) {
    score += 35;
    signals.push(`made by a tool (${producer ?? creatorTool})`);
  }
  if (/<dc:title>/i.test(text) && !/<xmp:CreatorTool>/i.test(text)) {
    score += 10;
    signals.push('carries its own title but no editor name');
  }
  // A generated PDF names its document; a scan or a printout rarely does.
  if (title && title.length >= 8 && !/\.(pdf|docx?)$/i.test(title)) {
    score += 15;
    signals.push('carries a real document title');
  }
  if (PERSONAL_PDF_PRODUCER.test(probe)) {
    score -= 50;
    signals.push(`made by ${producer ?? creatorTool}`);
  }
  if (signals.length === 0) signals.push('nothing inside says who made it');

  const claudeScore = Math.max(0, Math.min(100, score));
  return {
    kind,
    producedAt,
    producedAtSource,
    title,
    producer,
    creatorTool,
    // PDF evidence is thin by design: a PDF normally earns its place by
    // matching a conversation, not by looking like Claude's.
    isClaudeMade: claudeScore >= PDF_THRESHOLD,
    claudeScore,
    signals,
  };
}

export async function identifyFile(blob: Blob, name: string): Promise<FileIdentity> {
  const kind = kindFromName(name);
  try {
    if (kind === 'docx') return await identifyDocx(blob, kind, name);
    if (kind === 'pdf') return await identifyPdf(blob, kind);
  } catch {
    /* fall through to the honest "unknown" shape */
  }
  return emptyIdentity(kind, 'Chat Atlas could not read this file’s details');
}
