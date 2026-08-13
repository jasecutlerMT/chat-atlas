// Works out which conversation a downloaded file came from.
//
// Claude names its downloads nothing like the chat that produced them —
// "Sydney tech target list 100" arrives as SydneyTechTargetList100.docx, and
// sometimes as export-8837.docx. So we try, in order of how certain each is:
// the exact filename, the filename against known titles, the file's OWN title
// (Claude writes one inside every document), the instant it was made against
// the messages in each chat, and finally the words inside it.
//
// Every answer carries a plain-English `why`, shown on the row, so a wrong
// guess is visible and correctable rather than silent.

import type { ConvMeta, FileMoment, MsgStamp, OutputCard, LinkMethod } from '../types';
import type { FileIdentity } from './fileIdentity';
import { fileKeyScore } from './fileMoments';
import { tokenize, KEYWORD_STOPLIST, formatDateTime } from './text';

export interface MatchSources {
  moments: FileMoment[];
  outputs: OutputCard[];
  convs: ConvMeta[];
  /** Assistant messages sorted ascending by date. */
  msgStamps: MsgStamp[];
}

export interface FileMatch {
  convId?: string;
  momentId?: string;
  msgId?: string;
  how: LinkMethod;
  confidence: number;
  why: string;
}

const NO_MATCH: FileMatch = { how: 'none', confidence: 0, why: 'Not linked to a chat yet.' };

const TITLE_SCORE_MIN = 0.6;
const NEAR_WINDOW_MS = 120_000;
const WIDE_WINDOW_MS = 30 * 60_000;
const CONTENT_MIN_SHARED = 6;

function convNameOf(convId: string, src: MatchSources): string {
  return src.convs.find((c) => c.uuid === convId)?.name ?? 'a chat';
}

/** Rung A: a message names this exact file. */
function byExactFilename(name: string, id: FileIdentity, src: MatchSources): FileMatch | null {
  const lower = name.toLowerCase();
  const hits = src.moments.filter((m) => m.fileNames.some((n) => n.toLowerCase() === lower));
  if (hits.length === 0) return null;
  const best = id.producedAt
    ? hits.reduce((a, b) =>
        Math.abs(new Date(a.date).getTime() - new Date(id.producedAt!).getTime()) <=
        Math.abs(new Date(b.date).getTime() - new Date(id.producedAt!).getTime())
          ? a
          : b,
      )
    : hits.reduce((a, b) => (a.date > b.date ? a : b));
  return {
    convId: best.convId,
    momentId: best.id,
    msgId: best.msgId,
    how: 'filename',
    confidence: 1,
    why: `This chat names this exact file.`,
  };
}

interface Candidate {
  convId: string;
  momentId?: string;
  msgId?: string;
  score: number;
}

/** Scores a needle against every known title, returning the strongest. */
function bestTitleCandidate(needle: string, src: MatchSources): Candidate | null {
  let best: Candidate | null = null;
  const consider = (c: Candidate) => {
    if (c.score >= TITLE_SCORE_MIN && (!best || c.score > best.score)) best = c;
  };
  for (const m of src.moments) {
    for (const fn of m.fileNames) {
      consider({ convId: m.convId, momentId: m.id, msgId: m.msgId, score: fileKeyScore(needle, fn) });
    }
  }
  for (const o of src.outputs) {
    consider({ convId: o.convId, msgId: o.msgId, score: fileKeyScore(needle, o.title) * 0.95 });
  }
  for (const c of src.convs) {
    consider({ convId: c.uuid, score: fileKeyScore(needle, c.name) * 0.9 });
  }
  return best;
}

/** Rung D: Claude stamped the file with the instant it was made; find the chat that was live then. */
function byTimestamp(id: FileIdentity, src: MatchSources): FileMatch | null {
  if (!id.producedAt) return null;
  const target = new Date(id.producedAt).getTime();
  if (isNaN(target)) return null;

  const inWindow = (windowMs: number) =>
    src.msgStamps.filter((s) => Math.abs(new Date(s.date).getTime() - target) <= windowMs);

  for (const [windowMs, confidence, requireMoment] of [
    [NEAR_WINDOW_MS, 0.7, false],
    [WIDE_WINDOW_MS, 0.55, true],
  ] as const) {
    const hits = inWindow(windowMs);
    if (hits.length === 0) continue;
    const convIds = [...new Set(hits.map((h) => h.convId))];
    if (convIds.length !== 1) continue;
    if (requireMoment && !hits.some((h) => h.isMoment) && !src.moments.some((m) => m.convId === convIds[0])) continue;
    // Prefer a message that actually delivered a file, then the nearest in time.
    const ranked = [...hits].sort((a, b) => {
      if (a.isMoment !== b.isMoment) return a.isMoment ? -1 : 1;
      const da = Math.abs(new Date(a.date).getTime() - target);
      const db = Math.abs(new Date(b.date).getTime() - target);
      if (da !== db) return da - db;
      return b.words - a.words;
    });
    const pick = ranked[0];
    const moment = src.moments.find((m) => m.convId === pick.convId && m.msgId === pick.msgId);
    return {
      convId: pick.convId,
      momentId: moment?.id,
      msgId: pick.msgId,
      how: 'time',
      confidence,
      why: `Claude made this at ${formatDateTime(id.producedAt)}, right in the middle of this chat.`,
    };
  }
  return null;
}

/** Rung E: the distinctive words inside the file appear in one chat far more than any other. */
function byContent(id: FileIdentity, src: MatchSources): FileMatch | null {
  if (!id.sampleText) return null;
  const counts = new Map<string, number>();
  for (const t of tokenize(id.sampleText)) {
    if (KEYWORD_STOPLIST.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([t]) => t),
  );
  if (top.size < CONTENT_MIN_SHARED) return null;

  let best: { convId: string; score: number } | null = null;
  let runnerUp = 0;
  for (const c of src.convs) {
    let score = 0;
    for (const t of c.terms) if (top.has(t)) score++;
    for (const t of tokenize(c.name)) if (top.has(t)) score += 2;
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { convId: c.uuid, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score < CONTENT_MIN_SHARED || best.score < runnerUp * 2) return null;
  return {
    convId: best.convId,
    how: 'content',
    confidence: 0.5,
    why: `The wording inside this file matches “${convNameOf(best.convId, src)}”.`,
  };
}

export function matchFile(name: string, id: FileIdentity, src: MatchSources): FileMatch {
  const exact = byExactFilename(name, id, src);
  if (exact) return exact;

  const byName = bestTitleCandidate(name, src);
  if (byName) {
    return {
      convId: byName.convId,
      momentId: byName.momentId,
      msgId: byName.msgId,
      how: 'filename',
      confidence: 0.85,
      why: `The file name matches “${convNameOf(byName.convId, src)}”.`,
    };
  }

  // The file's own title, which Claude writes inside every document it makes.
  if (id.title) {
    const byOwnTitle = bestTitleCandidate(id.title, src);
    if (byOwnTitle) {
      return {
        convId: byOwnTitle.convId,
        momentId: byOwnTitle.momentId,
        msgId: byOwnTitle.msgId,
        how: 'title',
        confidence: 0.8,
        why: `The file's own title matches “${convNameOf(byOwnTitle.convId, src)}”.`,
      };
    }
  }
  if (id.description) {
    const words = new Set(tokenize(id.description).filter((t) => !KEYWORD_STOPLIST.has(t)));
    if (words.size >= 3) {
      let best: { convId: string; shared: number; union: number } | null = null;
      for (const c of src.convs) {
        const convWords = new Set([...c.terms, ...tokenize(c.name)]);
        let shared = 0;
        for (const w of words) if (convWords.has(w)) shared++;
        const union = words.size + convWords.size - shared;
        if (shared >= 3 && (!best || shared > best.shared)) best = { convId: c.uuid, shared, union };
      }
      if (best && best.shared / best.union >= 0.25) {
        return {
          convId: best.convId,
          how: 'title',
          confidence: 0.8,
          why: `What this file says it is about matches “${convNameOf(best.convId, src)}”.`,
        };
      }
    }
  }

  const byTime = byTimestamp(id, src);
  if (byTime) return byTime;

  const byWords = byContent(id, src);
  if (byWords) return byWords;

  return { ...NO_MATCH };
}
