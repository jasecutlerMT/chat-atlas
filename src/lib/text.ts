// Tokenising and content-flag helpers used by the parser, search and the map maths.

const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just like me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
    'im ive id youre youll dont doesnt didnt cant wont isnt arent wasnt werent hasnt havent its lets thats theres heres whats ' +
    'get got make makes made want wants need needs use using used one two three first second new good great really thing things way ways lot bit still even much many may might must shall let know think see look going go come back take help please thanks thank yes okay ok sure right well'
  ).split(/\s+/),
);

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const raw = lower.match(/[a-z][a-z0-9'’-]{2,}/g) ?? [];
  const out: string[] = [];
  for (let w of raw) {
    w = w.replace(/['’]/g, '');
    if (w.length < 3 || w.length > 24) continue;
    if (STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

export function detectCode(text: string): boolean {
  return /```/.test(text);
}

export function detectTable(text: string): boolean {
  // A markdown table needs a header row of pipes plus a separator row like |---|---|.
  return /^\s*\|.+\|\s*$/m.test(text) && /^\s*\|[\s:|-]+\|\s*$/m.test(text);
}

export function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
    if (t) return t.length > 120 ? t.slice(0, 117) + '…' : t;
  }
  return '';
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function daysBetween(iso: string, now = Date.now()): number {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return 0;
  return Math.floor((now - d) / 86_400_000);
}
