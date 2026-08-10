// Data intake is deliberately pluggable. Everything downstream of the app —
// storage, search, the map, the outputs shelf — only ever sees the normalised
// `Conversation` shape from ../types. To support a brand-new source one day
// (for example an official live Anthropic API), implement this interface and
// register it below; nothing else in the app needs to change.

import type { Conversation, SkippedItem } from '../types';

export interface ParseResult {
  conversations: Conversation[];
  skipped: SkippedItem[];
}

export interface DataSourceAdapter {
  id: string;
  label: string;
  /** True when the given raw bytes look like something this adapter understands. */
  sniff(buf: ArrayBuffer, fileName: string): Promise<boolean>;
  /** Turn raw bytes into normalised conversations. Must fail soft: keep what parses, report the rest. */
  parse(buf: ArrayBuffer, fileName: string): Promise<ParseResult>;
}

const registry: DataSourceAdapter[] = [];

export function registerAdapter(a: DataSourceAdapter): void {
  registry.push(a);
}

export async function findAdapter(buf: ArrayBuffer, fileName: string): Promise<DataSourceAdapter | undefined> {
  for (const a of registry) {
    if (await a.sniff(buf, fileName)) return a;
  }
  return undefined;
}
