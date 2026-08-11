// Groups near-duplicate outputs — the three drafts of the same email, the
// plan that got revised twice — so the Library shows one card ("v3") instead
// of clutter. Same-conversation same-type outputs group readily; across
// conversations the bar is much higher (near-identical text).

import type { Conversation, OutputCard } from '../types';
import { tokenize } from './text';

const SAME_CONV_THRESHOLD = 0.35;
const CROSS_CONV_THRESHOLD = 0.75;
const MAX_TOKENS = 1500;
const CROSS_CONV_CUTOFF = 2000; // beyond this many outputs, skip cross-conv pairing

type Vec = Map<string, number>;

function vectorFor(text: string): Vec {
  const counts = new Map<string, number>();
  const toks = tokenize(text).slice(0, MAX_TOKENS);
  for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
  let norm = 0;
  for (const v of counts.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const vec = new Map<string, number>();
  for (const [t, v] of counts) vec.set(t, v / norm);
  return vec;
}

function cosine(a: Vec, b: Vec): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, v] of small) {
    const w = large.get(t);
    if (w) dot += v * w;
  }
  return dot;
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
  }
}

export function groupVersions(outputs: OutputCard[], convText: Map<string, Map<string, string>>): void {
  const vecs = new Map<string, Vec>();
  const textOf = (card: OutputCard) => convText.get(card.convId)?.get(card.msgId) ?? `${card.title}\n${card.preview}`;
  const vecOf = (card: OutputCard) => {
    let v = vecs.get(card.id);
    if (!v) {
      v = vectorFor(textOf(card));
      vecs.set(card.id, v);
    }
    return v;
  };

  const uf = new UnionFind();

  // Within one conversation, same type: drafts iterate, so the bar is low.
  const byConvType = new Map<string, OutputCard[]>();
  for (const card of outputs) {
    const key = `${card.convId}|${card.type}`;
    let list = byConvType.get(key);
    if (!list) byConvType.set(key, (list = []));
    list.push(card);
  }
  for (const list of byConvType.values()) {
    if (list.length < 2 || list.length > 40) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (normTitle(a.title) === normTitle(b.title) || cosine(vecOf(a), vecOf(b)) >= SAME_CONV_THRESHOLD) {
          uf.union(a.id, b.id);
        }
      }
    }
  }

  // Across conversations, same type only, via an inverted index over top terms
  // so we never compare all pairs.
  if (outputs.length <= CROSS_CONV_CUTOFF) {
    const postings = new Map<string, OutputCard[]>();
    for (const card of outputs) {
      const top = [...vecOf(card).entries()].sort((x, y) => y[1] - x[1]).slice(0, 20);
      for (const [term] of top) {
        const key = `${card.type}|${term}`;
        let list = postings.get(key);
        if (!list) postings.set(key, (list = []));
        list.push(card);
      }
    }
    const checked = new Set<string>();
    for (const list of postings.values()) {
      if (list.length < 2 || list.length > 50) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.convId === b.convId) continue;
          const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (checked.has(pairKey)) continue;
          checked.add(pairKey);
          if (cosine(vecOf(a), vecOf(b)) >= CROSS_CONV_THRESHOLD) uf.union(a.id, b.id);
        }
      }
    }
  }

  // groupId = the earliest member (stable across rebuilds since ids are stable).
  const groups = new Map<string, OutputCard[]>();
  for (const card of outputs) {
    const root = uf.find(card.id);
    let list = groups.get(root);
    if (!list) groups.set(root, (list = []));
    list.push(card);
  }
  for (const list of groups.values()) {
    const earliest = [...list].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    for (const card of list) card.groupId = earliest.id;
  }
}

/** Convenience: builds the convId -> msgId -> text lookup groupVersions needs. */
export function buildTextLookup(convs: Conversation[]): Map<string, Map<string, string>> {
  const lookup = new Map<string, Map<string, string>>();
  for (const conv of convs) {
    const inner = new Map<string, string>();
    for (const m of conv.messages) inner.set(m.uuid, m.text);
    lookup.set(conv.uuid, inner);
  }
  return lookup;
}
