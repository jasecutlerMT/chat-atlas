// Detects the real-world things Jason's conversations are about — companies,
// people, tools — so the Library can organise knowledge by them. Pure
// heuristics, fully local: capitalised phrases from conversation titles
// (highest signal) and repeated capitalised mentions in message text, run
// through aggressive noise gates. Users can rename, merge and hide entities;
// those corrections live in meta and are applied at view time, so they
// survive every rebuild and re-import.

import type { Conversation, Entity, EntityKind, OutputCard } from '../types';
import { KEYWORD_STOPLIST } from './text';

/** Generic words that Claude title-cases in conversation names ("Cold Email Draft For Acme"). */
const TITLE_GENERIC = new Set(
  (
    'a an the and or for with to of in on at from about my your our new old good best quick short long ' +
    'email emails draft drafts cold warm outreach research brief briefs plan plans planning script scripts ' +
    'notes note guide guides review reviews analysis interview interviews call calls meeting meetings ' +
    'follow up followup strategy strategies untitled conversation chat prep preparation template templates ' +
    'idea ideas help question questions advice feedback letter letters post posts message messages ' +
    'subject dear hi hello hey regards best cheers sincerely thanks here there this that these those ' +
    'it its im ive id also very really just still even ' +
    'is are was were am be being been do does did done can could should would will wont cant shall may might must ' +
    'have has had need needs want wants let lets get gets got make makes making made create creating created ' +
    'build building built write writing wrote written fix fixing fixed improve improving improved compare comparing ' +
    'compared reviewing reviewed summarise summarize explain explaining explained check checking checked find finding ' +
    'found show showing showed give giving gave turn turning turned convert converting converted rename renames ' +
    'renaming renamed follow-up followup thinking thoughts through today tomorrow yesterday ' + +
    'writing write rewrite summary practice practise session sessions week weekly day daily month monthly ' +
    'list checklist framework playbook cheat sheet comparison table role job jobs career work project ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july ' +
    'august september october november december morning afternoon evening today tomorrow yesterday ' +
    'first second third next last final part phase step stage version update discussion deep dive overview'
  ).split(/\s+/),
);

/** Business jargon acronyms that are roles/concepts, not organisations. */
const ACRONYM_STOPLIST = new Set(
  (
    'SDR BDR AE AM CSM CEO CTO CFO COO CMO CRO VP SVP EVP HR IT PS PPS FYI FAQ ASAP KPI OKR ROI CRM ATS ' +
    'B2B B2C SAAS API URL PDF DOCX HTML CSS JSON CSV SQL AI ML LLM GPT NPS ARR MRR OTE PTO EOD EOW EOY ' +
    'USA UK USD AUD NSW VIC QLD WA CV IMO IIRC TBH TLDR DM PM AM ANZ APAC EMEA LATAM QBR POC MVP CTA ICP'
  ).split(/\s+/),
);

/** Well-known tools/platforms; seeds the kind guess only, detection is generic. */
const SEED_TOOLS = new Set(
  (
    'salesforce hubspot outreach salesloft apollo linkedin gong chorus notion slack teams zoom gmail outlook ' +
    'excel sheets powerpoint word docusign zoominfo lusha clearbit crunchbase glassdoor seek indeed repvue ' +
    'auth0 okta stripe shopify xero myob quickbooks canva figma miro asana trello jira confluence github ' +
    'whatsapp telegram calendly loom vidyard drift intercom zendesk marketo pardot eloqua dynamics pipedrive'
  ).split(/\s+/),
);

const CAP_WORD = /^[A-Z][a-z0-9'&.-]+$/;
const ACRONYM = /^[A-Z][A-Z0-9]{1,5}$/;
const MAX_TEXT_WORDS_PER_CONV = 15_000;
const MAX_ENTITIES = 150;

interface Candidate {
  count: number;
  inTitles: number;
  convIds: Set<string>;
  surfaces: Map<string, number>;
  personCue: number;
  companyCue: number;
  textOccurrences: number;
}

function normKey(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCapToken(tok: string): boolean {
  return CAP_WORD.test(tok) || ACRONYM.test(tok);
}

function isGenericWord(word: string): boolean {
  const w = word.toLowerCase();
  return TITLE_GENERIC.has(w) || KEYWORD_STOPLIST.has(w);
}

interface CapSegment {
  tokens: string[];
  startIdx: number;
}

/**
 * Extract capitalised phrases of up to three words. Generic title-case words
 * ("Email", "Draft") act as separators, so "Cold Email Drafts For Salesforce
 * Outreach" yields just "Salesforce", and "Acme Logistics Research Brief"
 * yields "Acme Logistics".
 */
function capSegments(tokens: string[], sentenceStarts: Set<number>, requireMidSentence: boolean): CapSegment[] {
  const out: CapSegment[] = [];
  let i = 0;
  const usable = (tok: string) => isCapToken(tok) && !isGenericWord(tok) && !ACRONYM_STOPLIST.has(tok);
  while (i < tokens.length) {
    if (!usable(tokens[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && usable(tokens[j]) && j - i < 3) j++;
    const seg = tokens.slice(i, j);
    // A lone capitalised word at the start of a sentence is usually just
    // capitalisation, not a name — unless we're reading a title.
    if (!(requireMidSentence && sentenceStarts.has(i) && seg.length === 1)) {
      out.push({ tokens: seg, startIdx: i });
    }
    i = j;
  }
  return out;
}

function tokenizeWithSentences(text: string): { tokens: string[]; sentenceStarts: Set<number> } {
  const tokens: string[] = [];
  const sentenceStarts = new Set<number>();
  for (const line of text.split('\n')) {
    let atSentenceStart = true;
    for (const raw of line.split(/\s+/)) {
      const word = raw.replace(/^[("'“‘[*_`~#>-]+/, '').replace(/[)"'”’\]*_`~]+$/, '');
      if (!word) continue; // markdown furniture; the next word still starts the line/sentence
      const clean = word.replace(/[.,;:!?]+$/, '');
      if (!clean) continue;
      if (atSentenceStart) sentenceStarts.add(tokens.length);
      tokens.push(clean);
      atSentenceStart = /[.!?:]$/.test(word);
    }
  }
  return { tokens, sentenceStarts };
}

export function detectEntities(convs: Conversation[], outputs: OutputCard[]): Entity[] {
  const candidates = new Map<string, Candidate>();
  const N = convs.length || 1;

  const bump = (phrase: string[], convId: string, weight: number, fromTitle: boolean, prevWord?: string) => {
    const surface = phrase.join(' ');
    const key = normKey(surface);
    if (!key || key.length < 2) return;
    if (phrase.every((w) => isGenericWord(w) || ACRONYM_STOPLIST.has(w))) return;
    if (phrase.length === 1 && ACRONYM_STOPLIST.has(phrase[0])) return;
    let c = candidates.get(key);
    if (!c) {
      c = { count: 0, inTitles: 0, convIds: new Set(), surfaces: new Map(), personCue: 0, companyCue: 0, textOccurrences: 0 };
      candidates.set(key, c);
    }
    c.count += weight;
    c.convIds.add(convId);
    c.surfaces.set(surface, (c.surfaces.get(surface) ?? 0) + 1);
    if (fromTitle) c.inTitles += 1;
    else {
      c.textOccurrences += 1;
      if (prevWord && /^(with|from|to|met|call|called|email|emailed|spoke|thanks|dear|hi|hey)$/i.test(prevWord)) c.personCue += 1;
      if (prevWord && /^at$/i.test(prevWord)) c.companyCue += 1;
    }
    const last = phrase[phrase.length - 1].toLowerCase().replace(/[.,]$/, '');
    if (/^(inc|ltd|pty|llc|gmbh|group|logistics|technologies|software|systems|solutions|freight|labs|co)$/.test(last)) {
      c.companyCue += 2;
    }
  };

  for (const conv of convs) {
    // Titles: highest-signal source, weight ×5.
    const { tokens: titleTokens } = tokenizeWithSentences(conv.name === 'Untitled conversation' ? '' : conv.name);
    for (const seg of capSegments(titleTokens, new Set(), false)) bump(seg.tokens, conv.uuid, 5, true);

    // Message text: weight ×1, sentence-initial single words don't count.
    let wordsSeen = 0;
    for (const m of conv.messages) {
      if (wordsSeen >= MAX_TEXT_WORDS_PER_CONV) break;
      const { tokens, sentenceStarts } = tokenizeWithSentences(m.text);
      wordsSeen += tokens.length;
      for (const seg of capSegments(tokens, sentenceStarts, true)) {
        const prev = seg.startIdx > 0 ? tokens[seg.startIdx - 1] : undefined;
        bump(seg.tokens, conv.uuid, 1, false, prev);
      }
    }
  }

  // Noise gates and scoring.
  const entities: Entity[] = [];
  for (const [key, c] of candidates) {
    if (c.convIds.size / N > 0.5) continue; // corpus-wide filler ("Claude", "Subject")
    const surfacing = (c.inTitles >= 1 && c.count >= 2) || (c.convIds.size >= 2 && c.count >= 3);
    if (!surfacing) continue;

    let label = key;
    let best = 0;
    for (const [s, n] of c.surfaces) {
      if (n > best) {
        best = n;
        label = s;
      }
    }

    let kind: EntityKind | undefined;
    const words = key.split(' ');
    if (SEED_TOOLS.has(key) || (words.length === 1 && SEED_TOOLS.has(words[0]))) kind = 'tool';
    else if (c.companyCue >= 2) kind = 'company';
    else if (
      words.length === 2 &&
      words.every((w) => /^[a-z'-]+$/.test(w)) &&
      c.textOccurrences > 0 &&
      c.personCue / c.textOccurrences >= 1 / 3
    ) {
      kind = 'person';
    }

    entities.push({
      id: 'ent-' + key.replace(/[^a-z0-9]+/g, '-'),
      label,
      kind,
      convIds: [...c.convIds],
      outputIds: [],
      count: c.count,
      inTitles: c.inTitles,
      score: c.inTitles * 5 + c.convIds.size * 2 + Math.log2(1 + c.count),
    });
  }

  entities.sort((a, b) => b.score - a.score);
  const kept = entities.slice(0, MAX_ENTITIES);

  // Link outputs to entities by word-boundary label match in title + preview.
  const matchers = kept.map((e) => ({
    e,
    re: new RegExp(`\\b${e.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  }));
  for (const card of outputs) {
    const haystack = `${card.title}\n${card.convName}\n${card.preview}`;
    const matched: { e: Entity }[] = [];
    for (const m of matchers) {
      if (m.e.convIds.includes(card.convId) && m.re.test(haystack)) matched.push(m);
      else if (m.re.test(card.title) || m.re.test(card.convName)) matched.push(m);
      if (matched.length >= 3) break;
    }
    card.entityIds = matched.map((m) => m.e.id);
    for (const m of matched) m.e.outputIds.push(card.id);
  }
  // An output inside an entity's conversation still belongs on that entity's
  // page even without a text match — membership via convIds covers it there.

  return kept;
}

/** Append " — Entity" to output titles when the primary entity isn't already visible in them. */
export function decorateTitles(outputs: OutputCard[], entities: Entity[]): void {
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const card of outputs) {
    const primary = card.entityIds[0] ? byId.get(card.entityIds[0]) : undefined;
    if (!primary) continue;
    if (card.title.toLowerCase().includes(primary.label.toLowerCase())) continue;
    if (card.title.length + primary.label.length > 86) continue;
    card.title = `${card.title} — ${primary.label}`;
  }
}
