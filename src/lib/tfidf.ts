// Turns each conversation into a vector of its most distinctive words (TF-IDF),
// measures overlap between conversations (cosine similarity) to build map edges,
// and groups connected conversations into clusters via label propagation.

import { tokenize } from './text';
import type { Conversation, GraphEdge } from '../types';

const TERMS_PER_CONV = 60;
const MAX_TOKENS_PER_CONV = 20_000;
/** Terms shared by too many conversations connect everything to everything; skip them when pairing. */
const MAX_DF_FOR_PAIRING = 150;
export const MIN_EDGE_WEIGHT = 0.03;
const EDGES_KEPT_PER_NODE = 8;

export interface TfidfResult {
  /** convId -> top keywords (most distinctive first) */
  keywords: Map<string, string[]>;
  /** convId -> wider term set for keyword chips */
  terms: Map<string, string[]>;
  /** candidate edges, each node's strongest first; filter by weight in the UI */
  edges: GraphEdge[];
  /** convId -> cluster index (ordered by cluster size, 0 = biggest) */
  clusters: Map<string, number>;
}

export function computeTfidf(convs: Conversation[]): TfidfResult {
  const N = convs.length;
  const termCounts = new Map<string, Map<string, number>>(); // convId -> term -> count
  const df = new Map<string, number>();

  for (const conv of convs) {
    const counts = new Map<string, number>();
    let total = 0;
    for (const m of conv.messages) {
      if (total >= MAX_TOKENS_PER_CONV) break;
      const toks = tokenize(m.text);
      for (const t of toks) {
        if (total >= MAX_TOKENS_PER_CONV) break;
        counts.set(t, (counts.get(t) ?? 0) + 1);
        total++;
      }
    }
    // The title counts extra: it is usually the best topic signal.
    for (const t of tokenize(conv.name)) counts.set(t, (counts.get(t) ?? 0) + 3);
    termCounts.set(conv.uuid, counts);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  // Per-conversation sparse vectors of the strongest TERMS_PER_CONV terms, L2-normalised.
  const vectors = new Map<string, Map<string, number>>();
  const keywords = new Map<string, string[]>();
  const terms = new Map<string, string[]>();

  for (const conv of convs) {
    const counts = termCounts.get(conv.uuid)!;
    const scored: [string, number][] = [];
    for (const [t, c] of counts) {
      const d = df.get(t)!;
      if (d / N > 0.6) continue; // corpus-wide filler word
      const w = (1 + Math.log(c)) * Math.log(1 + N / d);
      scored.push([t, w]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const top = scored.slice(0, TERMS_PER_CONV);
    let norm = Math.sqrt(top.reduce((s, [, w]) => s + w * w, 0)) || 1;
    const vec = new Map<string, number>();
    for (const [t, w] of top) vec.set(t, w / norm);
    vectors.set(conv.uuid, vec);
    keywords.set(conv.uuid, top.slice(0, 5).map(([t]) => t));
    terms.set(conv.uuid, top.slice(0, 30).map(([t]) => t));
  }

  // Pairwise similarity via an inverted index so we only touch pairs that share a term.
  const postings = new Map<string, [string, number][]>(); // term -> [(convId, weight)]
  for (const [convId, vec] of vectors) {
    for (const [t, w] of vec) {
      if ((df.get(t) ?? 0) > MAX_DF_FOR_PAIRING) continue;
      let list = postings.get(t);
      if (!list) postings.set(t, (list = []));
      list.push([convId, w]);
    }
  }
  const pairScores = new Map<string, number>();
  for (const list of postings.values()) {
    if (list.length < 2 || list.length > 400) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, wa] = list[i];
        const [b, wb] = list[j];
        const key = a < b ? a + '|' + b : b + '|' + a;
        pairScores.set(key, (pairScores.get(key) ?? 0) + wa * wb);
      }
    }
  }

  // Keep each node's strongest candidates; the UI's threshold slider trims further.
  const perNode = new Map<string, GraphEdge[]>();
  for (const [key, weight] of pairScores) {
    if (weight < MIN_EDGE_WEIGHT) continue;
    const [a, b] = key.split('|');
    const e: GraphEdge = { source: a, target: b, weight };
    for (const id of [a, b]) {
      let list = perNode.get(id);
      if (!list) perNode.set(id, (list = []));
      list.push(e);
    }
  }
  const kept = new Set<GraphEdge>();
  for (const list of perNode.values()) {
    list.sort((x, y) => y.weight - x.weight);
    for (const e of list.slice(0, EDGES_KEPT_PER_NODE)) kept.add(e);
  }
  const edges = [...kept].sort((a, b) => b.weight - a.weight);

  // Label propagation: everyone starts as their own cluster, then repeatedly
  // adopts the label with the strongest combined edge weight among neighbours.
  const label = new Map<string, string>();
  for (const c of convs) label.set(c.uuid, c.uuid);
  const neighbours = new Map<string, [string, number][]>();
  for (const e of edges) {
    if (!neighbours.has(e.source)) neighbours.set(e.source, []);
    if (!neighbours.has(e.target)) neighbours.set(e.target, []);
    neighbours.get(e.source)!.push([e.target, e.weight]);
    neighbours.get(e.target)!.push([e.source, e.weight]);
  }
  const ids = convs.map((c) => c.uuid).sort();
  for (let iter = 0; iter < 12; iter++) {
    let changed = 0;
    for (const id of ids) {
      const nbrs = neighbours.get(id);
      if (!nbrs || nbrs.length === 0) continue;
      const votes = new Map<string, number>();
      for (const [nid, w] of nbrs) {
        const l = label.get(nid)!;
        votes.set(l, (votes.get(l) ?? 0) + w);
      }
      let best = label.get(id)!;
      let bestScore = votes.get(best) ?? 0;
      for (const [l, s] of [...votes.entries()].sort()) {
        if (s > bestScore) {
          best = l;
          bestScore = s;
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best);
        changed++;
      }
    }
    if (changed === 0) break;
  }
  const sizes = new Map<string, number>();
  for (const l of label.values()) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const ordered = [...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const clusterIndex = new Map(ordered.map((l, i) => [l, i]));
  const clusters = new Map<string, number>();
  for (const [id, l] of label) clusters.set(id, clusterIndex.get(l)!);

  return { keywords, terms, edges, clusters };
}
