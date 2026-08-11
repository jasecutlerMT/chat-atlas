// Shared shapes used across the app, the worker and the database.

export interface Attachment {
  file_name?: string;
  file_type?: string;
  file_size?: number;
  extracted_content?: string;
}

export interface ChatMessage {
  uuid: string;
  sender: 'human' | 'assistant';
  /** Combined display text (joined from content blocks, falling back to `text`). */
  text: string;
  created_at: string;
  attachments: Attachment[];
  fileNames: string[];
  hasCode: boolean;
  hasTable: boolean;
  isLong: boolean;
  hasAttachment: boolean;
}

export interface Conversation {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  projectUuid?: string;
  projectName?: string;
  messages: ChatMessage[];
}

/** Lightweight per-conversation record kept in memory for the map, timeline and lists. */
export interface ConvMeta {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  projectUuid?: string;
  projectName?: string;
  messageCount: number;
  wordCount: number;
  /** Top distinctive words, most distinctive first. */
  keywords: string[];
  /** Wider set of distinctive terms used by keyword chips. */
  terms: string[];
  cluster: number;
  firstLine: string;
}

export type OutputType = 'research' | 'email' | 'script' | 'plan' | 'document' | 'code';

export interface OutputCard {
  id: string; // convId/msgId
  convId: string;
  msgId: string;
  type: OutputType;
  title: string;
  preview: string;
  date: string;
  convName: string;
  wordCount: number;
  /** Ids of the companies/people/tools this output is about (top 3 by entity score). */
  entityIds: string[];
  /** Version group: near-duplicate drafts share a groupId; equals own id when ungrouped. */
  groupId: string;
}

// ---- knowledge organisation ----

export type EntityKind = 'company' | 'person' | 'tool';

/** A real-world thing detected across conversations: a company, person or tool. */
export interface Entity {
  id: string; // 'ent-' + normalised key
  label: string; // most frequent surface form
  kind?: EntityKind;
  convIds: string[];
  outputIds: string[];
  count: number;
  inTitles: number;
  score: number;
}

/** User corrections to detected entities; keyed by entity id so they survive rebuilds. */
export interface EntityOverrides {
  hidden: string[];
  renames: Record<string, string>;
  merges: Record<string, string>; // id -> canonical id
  kinds: Record<string, EntityKind>;
}

export interface LibraryItemRef {
  kind: 'output' | 'conversation';
  id: string;
}

export interface Collection {
  id: string;
  name: string;
  items: LibraryItemRef[];
  createdAt: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface SkippedItem {
  where: string;
  reason: string;
}

export interface ImportSummary {
  fileName: string;
  added: number;
  updated: number;
  unchanged: number;
  skipped: SkippedItem[];
}

export interface Workspace {
  id: string;
  name: string;
  convIds: string[];
}

export interface SnippetPart {
  text: string;
  hl: boolean;
}

export interface SearchHit {
  convId: string;
  msgId: string;
  convName: string;
  sender: 'human' | 'assistant';
  date: string;
  snippet: SnippetPart[];
  fromAttachment: boolean;
  score: number;
}

export interface SearchFilters {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
  sender?: 'human' | 'assistant';
  convId?: string;
  hasCode?: boolean;
  hasTable?: boolean;
  isLong?: boolean;
  hasAttachment?: boolean;
  /** When set, only these conversations are searched (workspace / project scope). */
  scopeConvIds?: string[];
  keyword?: string;
}

export interface SearchResponse {
  id: number;
  hits: SearchHit[];
  matchedConvIds: string[];
  totalHits: number;
}

// ---- Worker protocol ----

export type ToWorker =
  | { t: 'init' }
  | { t: 'import'; buf: ArrayBuffer; fileName: string }
  | { t: 'search'; id: number; q: string; filters: SearchFilters }
  | { t: 'rebuild' };

export type FromWorker =
  | { t: 'ready'; convCount: number }
  | { t: 'progress'; label: string; pct: number }
  | { t: 'imported'; summary: ImportSummary }
  | { t: 'results'; id: number; hits: SearchHit[]; matchedConvIds: string[]; totalHits: number }
  | { t: 'rebuilt' }
  | { t: 'error'; message: string };
