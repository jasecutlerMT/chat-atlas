// IndexedDB layer, shared by the main thread and the worker.
// Store layout:
//   conversations — full conversations (with messages), keyed by uuid
//   meta          — small key/value records: settings, folder handle, seen zips, workspaces
//   derived       — computed artefacts: conversation metadata, graph edges, output cards

import { openDB, type IDBPDatabase } from 'idb';
import type {
  Collection,
  Conversation,
  ConvMeta,
  Entity,
  EntityOverrides,
  FileMoment,
  GraphEdge,
  LibraryItemRef,
  MsgStamp,
  OutputCard,
  SkippedItem,
  StoredFileMeta,
  Workspace,
} from '../types';

const DB_NAME = 'chat-atlas';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Guarded creates: runs for fresh installs and for v1 -> v2 upgrades.
        if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'uuid' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('derived')) db.createObjectStore('derived');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

// ---- conversations ----

export async function getConversation(uuid: string): Promise<Conversation | undefined> {
  return (await getDB()).get('conversations', uuid);
}

export async function getAllConversations(): Promise<Conversation[]> {
  return (await getDB()).getAll('conversations');
}

export async function putConversations(convs: Conversation[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('conversations', 'readwrite');
  for (const c of convs) tx.store.put(c);
  await tx.done;
}

// ---- meta key/value ----

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDB()).get('meta', key);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put('meta', value, key);
}

// ---- derived ----

export const DERIVED_SCHEMA_VERSION = 6;

export interface DerivedBundle {
  schemaVersion?: number;
  convMeta: ConvMeta[];
  edges: GraphEdge[];
  outputs: OutputCard[];
  entities?: Entity[];
  fileMoments?: FileMoment[];
  /** Doc-like filenames mentioned anywhere; used to link a captured file to its chat. */
  referencedFiles?: string[];
  /** Assistant message timestamps, so a file can be matched to the chat that was live when Claude made it. */
  msgStamps?: MsgStamp[];
}

export async function getDerived(): Promise<DerivedBundle | undefined> {
  return (await getDB()).get('derived', 'bundle');
}

export async function setDerived(bundle: DerivedBundle): Promise<void> {
  await (await getDB()).put('derived', bundle, 'bundle');
}

export async function getSkipped(): Promise<SkippedItem[]> {
  return (await getMeta<SkippedItem[]>('skipped')) ?? [];
}

export async function setSkipped(items: SkippedItem[]): Promise<void> {
  await setMeta('skipped', items);
}

export async function getWorkspaces(): Promise<Workspace[]> {
  return (await getMeta<Workspace[]>('workspaces')) ?? [];
}

export async function setWorkspaces(ws: Workspace[]): Promise<void> {
  await setMeta('workspaces', ws);
}

// ---- knowledge organisation (all additive meta keys) ----

export async function getPins(): Promise<LibraryItemRef[]> {
  return (await getMeta<LibraryItemRef[]>('pins')) ?? [];
}

export async function setPins(pins: LibraryItemRef[]): Promise<void> {
  await setMeta('pins', pins);
}

export async function getCollections(): Promise<Collection[]> {
  return (await getMeta<Collection[]>('collections')) ?? [];
}

export async function setCollections(cols: Collection[]): Promise<void> {
  await setMeta('collections', cols);
}

// ---- the local file archive (kept originals) ----

interface StoredFileRecord extends StoredFileMeta {
  blob: Blob;
}

export function fileArchiveId(name: string, size: number, lastModified: number): string {
  return `${name.toLowerCase()}|${size}|${lastModified}`;
}

export async function putStoredFile(meta: StoredFileMeta, blob: Blob): Promise<void> {
  await (await getDB()).put('files', { ...meta, blob } satisfies StoredFileRecord);
}

export async function listStoredFiles(): Promise<StoredFileMeta[]> {
  const all: StoredFileRecord[] = await (await getDB()).getAll('files');
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}

export async function getStoredFileBlob(id: string): Promise<Blob | undefined> {
  const rec: StoredFileRecord | undefined = await (await getDB()).get('files', id);
  return rec?.blob;
}

export async function updateStoredFileMeta(id: string, patch: Partial<StoredFileMeta>): Promise<void> {
  const db = await getDB();
  const rec: StoredFileRecord | undefined = await db.get('files', id);
  if (rec) await db.put('files', { ...rec, ...patch });
}

export async function deleteStoredFile(id: string): Promise<void> {
  await (await getDB()).delete('files', id);
}

export const EMPTY_OVERRIDES: EntityOverrides = { hidden: [], renames: {}, merges: {}, kinds: {} };

export async function getEntityOverrides(): Promise<EntityOverrides> {
  return (await getMeta<EntityOverrides>('entityOverrides')) ?? { ...EMPTY_OVERRIDES };
}

export async function setEntityOverrides(o: EntityOverrides): Promise<void> {
  await setMeta('entityOverrides', o);
}
