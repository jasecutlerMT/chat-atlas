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
  /**
   * What Claude passed to a tool — usually the full text of a document it was
   * building. Used to match a downloaded file to its chat and to preview what
   * a file contained. Never offered as a downloadable document.
   */
  toolText?: string;
  /** Artifact or file titles seen inside tool calls. */
  toolTitles?: string[];
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

/** A point in the history where a real file was asked for or produced. */
export interface FileMoment {
  id: string; // convId/msgId
  convId: string;
  msgId: string;
  /** The message whose text a rebuild uses (the file card itself is often just "here you go"). */
  sourceMsgId: string;
  convName: string;
  date: string;
  fileNames: string[];
  /** True when the preceding human message explicitly asked for a file. */
  asked: boolean;
}

/** How a stored file came to be linked to a conversation. */
export type LinkMethod = 'filename' | 'title' | 'time' | 'content' | 'manual' | 'none';

/** A real file kept forever in the local archive (captured from a folder or added by hand). */
export interface StoredFileMeta {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  capturedAt: string;
  source: 'watched' | 'attached' | 'picked' | 'dropped';
  linkedMomentId?: string;
  linkedConvId?: string;
  linkedMsgId?: string;

  // What the file says about itself (see lib/fileIdentity.ts).
  /** When Claude made it — the only honest answer to "when did I get this?". */
  producedAt?: string;
  producedAtSource?: 'docx-core' | 'pdf-info' | 'pdf-xmp' | 'message' | 'file-mtime' | 'none';
  docTitle?: string;
  docDescription?: string;
  isClaudeMade?: boolean;
  claudeScore?: number;
  identitySignals?: string[];
  identityVersion?: number;

  // How it found its conversation.
  linkMethod?: LinkMethod;
  linkConfidence?: number;
  linkWhy?: string;

  /** Where it was found, for the user's own orientation. */
  folderName?: string;
  relPath?: string;
  /** Set when the file is neither recognisably Claude's nor linked to a chat. */
  needsReview?: boolean;
}

/** One assistant message's timestamp, used to match a file to the chat that produced it. */
export interface MsgStamp {
  convId: string;
  convName: string;
  msgId: string;
  date: string;
  words: number;
  isMoment: boolean;
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
