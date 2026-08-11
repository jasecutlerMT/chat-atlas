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
  GraphEdge,
  LibraryItemRef,
  OutputCard,
  SkippedItem,
  Workspace,
} from '../types';

const DB_NAME = 'chat-atlas';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('conversations', { keyPath: 'uuid' });
        db.createObjectStore('meta');
        db.createObjectStore('derived');
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

export const DERIVED_SCHEMA_VERSION = 2;

export interface DerivedBundle {
  schemaVersion?: number;
  convMeta: ConvMeta[];
  edges: GraphEdge[];
  outputs: OutputCard[];
  entities?: Entity[];
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

export const EMPTY_OVERRIDES: EntityOverrides = { hidden: [], renames: {}, merges: {}, kinds: {} };

export async function getEntityOverrides(): Promise<EntityOverrides> {
  return (await getMeta<EntityOverrides>('entityOverrides')) ?? { ...EMPTY_OVERRIDES };
}

export async function setEntityOverrides(o: EntityOverrides): Promise<void> {
  await setMeta('entityOverrides', o);
}
