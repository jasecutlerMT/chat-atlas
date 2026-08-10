// Spots deliverables inside Claude's replies and labels them by structural clues:
// fenced code, greetings and sign-offs, step headings, section headings, length.

import { countWords, firstLine } from './text';
import type { ChatMessage, Conversation, OutputCard, OutputType } from '../types';

const GREETING = /^(hi|hello|dear|hey|hiya|g'day|good (morning|afternoon|evening))\b/i;
const SIGNOFF = /^(best|best regards|kind regards|warm regards|regards|cheers|sincerely|thanks|thank you|many thanks|talk soon|yours|warmly)[,.!\s]*$/i;
const SUBJECT = /^subject\s*:/im;
const DIALOGUE_LINE = /^[A-Z][\w '().-]{0,24}:\s+\S/;
const SCRIPT_CUES = /\b(INT\.|EXT\.|FADE IN|FADE OUT|\[scene|voice.?over|V\.O\.)\b/i;
const STEP_HEADING = /^#{1,4}\s.*\b(step|phase|week|day|stage|month|part)\b/im;
const PLAN_WORDS = /\b(plan|roadmap|framework|checklist|playbook|strategy|schedule|cheat sheet)\b/i;
const RESEARCH_HEADINGS = /^#{1,4}\s.*\b(overview|background|summary|findings|analysis|research|competitors?|market|numbers|pricing|product|buyers?|key|comparison|pros|cons|sources?|ammunition)\b/im;

export const OUTPUT_TYPE_LABELS: Record<OutputType, string> = {
  research: 'Research brief',
  email: 'Email or message draft',
  script: 'Script',
  plan: 'Plan or framework',
  document: 'Document',
  code: 'Code',
};

function countMatches(text: string, re: RegExp): number {
  let n = 0;
  for (const line of text.split('\n')) if (re.test(line.trim())) n++;
  return n;
}

export function classifyMessage(text: string): OutputType | null {
  const words = countWords(text);
  const lines = text.split('\n');
  const headings = countMatches(text, /^#{1,4}\s+\S/);

  // Code: a substantial fenced block dominating the message.
  const fenceParts = text.split(/^```.*$/m);
  let codeLines = 0;
  for (let i = 1; i < fenceParts.length; i += 2) {
    codeLines += fenceParts[i].split('\n').filter((l) => l.trim()).length;
  }
  if (codeLines >= 6 && codeLines / Math.max(lines.length, 1) >= 0.3) return 'code';

  if (words < 40 && codeLines === 0) return null; // a short chat reply, not a deliverable

  // Email or message draft: a Subject line, or greeting near the top plus a sign-off near the end.
  const head = lines.slice(0, 4).map((l) => l.trim());
  const tail = lines.slice(-8).map((l) => l.trim());
  const hasGreeting = head.some((l) => GREETING.test(l));
  const hasSignoff = tail.some((l) => SIGNOFF.test(l));
  if (SUBJECT.test(text) || (hasGreeting && hasSignoff && words <= 1200)) return 'email';

  // Script: screenplay cues or a run of dialogue lines like "Them: ..." / "You: ...".
  const dialogueLines = countMatches(text, DIALOGUE_LINE);
  if (SCRIPT_CUES.test(text) || dialogueLines >= 5) return 'script';

  // Plan or framework: step/phase/week headings, or plan words plus numbered structure.
  const numbered = countMatches(text, /^\d+[.)]\s+\S/);
  if (STEP_HEADING.test(text) || (PLAN_WORDS.test(text.slice(0, 200)) && (numbered >= 3 || headings >= 3))) {
    return 'plan';
  }

  // Research brief: several headings including research-y section names.
  if (headings >= 3 && words >= 100 && RESEARCH_HEADINGS.test(text)) return 'research';

  // Document: any other long-form structured piece.
  if (words >= 300) return 'document';

  return null;
}

export function extractOutputs(conv: Conversation): OutputCard[] {
  const cards: OutputCard[] = [];
  for (const m of conv.messages) {
    if (m.sender !== 'assistant' || !m.text.trim()) continue;
    const type = classifyMessage(m.text);
    if (!type) continue;
    cards.push({
      id: `${conv.uuid}/${m.uuid}`,
      convId: conv.uuid,
      msgId: m.uuid,
      type,
      title: titleFor(m, conv),
      preview: previewFor(m.text),
      date: m.created_at || conv.updated_at,
      convName: conv.name,
      wordCount: countWords(m.text),
    });
  }
  return cards;
}

function titleFor(m: ChatMessage, conv: Conversation): string {
  const heading = m.text.match(/^#{1,4}\s+(.+)$/m);
  if (heading) return heading[1].replace(/[*_`]/g, '').trim();
  const subject = m.text.match(/^subject\s*:\s*(.+)$/im);
  if (subject) return subject[1].trim();
  return firstLine(m.text) || conv.name;
}

function previewFor(text: string): string {
  const noCode = text.replace(/```[\s\S]*?```/g, ' [code] ');
  const lines = noCode
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/[*_`>|]/g, '').trim())
    .filter(Boolean);
  const joined = lines.slice(0, 4).join(' · ');
  return joined.length > 220 ? joined.slice(0, 217) + '…' : joined;
}
