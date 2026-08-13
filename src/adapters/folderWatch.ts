// Watches folders for two things: new Claude export zips, and the PDF/Word
// files Claude makes. Chrome-only (File System Access API). Folder handles are
// stored in IndexedDB so future visits need at most one "Allow" click.
//
// Jason's files are scattered, so this watches SEVERAL folders and looks
// inside sub-folders too. Every document it finds is offered to the store,
// which decides what is worth keeping — the watcher itself keeps nothing.

import { getMeta, setMeta } from '../db/db';

const SCAN_INTERVAL_MS = 30_000;
const MAX_DEPTH = 3;
const MAX_ENTRIES_PER_SWEEP = 2000;
/** After this many sweeps that found nothing, slow down to save battery. */
const IDLE_SWEEPS_BEFORE_BACKOFF = 10;
const BACKOFF_EVERY_NTH_TICK = 5;

const DOC_FILE = /\.(pdf|docx?)$/i;
const SKIP_DIR = /^(node_modules|\.git|Library|System|Applications|\.Trash|\.|Photos Library|Music|Movies)/i;

// Minimal typings for the File System Access API (not yet in TypeScript's DOM lib).
export interface DirHandle {
  name: string;
  kind?: string;
  values(): AsyncIterable<DirEntry>;
  queryPermission(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  isSameEntry?(other: unknown): Promise<boolean>;
}

interface DirEntry {
  kind: string;
  name: string;
  getFile?(): Promise<File>;
  values?(): AsyncIterable<DirEntry>;
  queryPermission?(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: string; startIn?: string }) => Promise<DirHandle>;
  }
}

export function browserSupportsWatching(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export interface WatchedFolder {
  id: string;
  name: string;
  handle: DirHandle;
  addedAt: string;
}

export type WatcherStatus =
  | { state: 'unsupported' }
  | { state: 'off' }
  | { state: 'watching'; folders: { id: string; name: string }[] }
  | { state: 'needs-permission'; lapsed: { id: string; name: string }[]; watching: { id: string; name: string }[] }
  | { state: 'error'; message: string };

/** Where a file was found, passed to the store so it can explain itself later. */
export interface DocContext {
  source: 'watched' | 'attached' | 'picked' | 'dropped';
  folderName?: string;
  relPath?: string;
  force?: boolean;
}

export type DocResult = 'kept' | 'ignored' | 'duplicate';

interface SeenDoc {
  kept: boolean;
  storedId?: string;
  at: string;
}

type SeenZips = Record<string, true>;
type SeenDocs = Record<string, SeenDoc>;

function zipKey(name: string, size: number, lastModified: number): string {
  return `${name}|${size}|${lastModified}`;
}

function docKey(folderId: string, relPath: string, size: number, lastModified: number): string {
  return `${folderId}:${relPath}|${size}|${lastModified}`;
}

export interface WatcherCallbacks {
  onZip: (file: File) => Promise<boolean>;
  onDocFile: (file: File, ctx: DocContext) => Promise<DocResult>;
  onStatus: (s: WatcherStatus) => void;
}

export class FolderWatcher {
  private folders: WatchedFolder[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private idleSweeps = 0;
  private tick = 0;
  private cb: WatcherCallbacks;

  /** Callbacks arrive at construction so a scan can never run without them. */
  constructor(cb: WatcherCallbacks) {
    this.cb = cb;
  }

  // ---- folder bookkeeping ----

  private async persist(): Promise<void> {
    await setMeta(
      'watchFolders',
      this.folders.map((f) => ({ id: f.id, name: f.name, handle: f.handle, addedAt: f.addedAt })),
    );
  }

  private async permissionOf(f: WatchedFolder): Promise<'granted' | 'denied' | 'prompt'> {
    try {
      return await f.handle.queryPermission({ mode: 'read' });
    } catch {
      return 'denied';
    }
  }

  private async reportStatus(): Promise<void> {
    if (!browserSupportsWatching()) {
      this.cb.onStatus({ state: 'unsupported' });
      return;
    }
    if (this.folders.length === 0) {
      this.cb.onStatus({ state: 'off' });
      return;
    }
    const watching: { id: string; name: string }[] = [];
    const lapsed: { id: string; name: string }[] = [];
    for (const f of this.folders) {
      const perm = await this.permissionOf(f);
      (perm === 'granted' ? watching : lapsed).push({ id: f.id, name: f.name });
    }
    this.cb.onStatus(lapsed.length > 0 ? { state: 'needs-permission', lapsed, watching } : { state: 'watching', folders: watching });
  }

  /** Resume watching from previously saved folders. */
  async restore(): Promise<void> {
    if (!browserSupportsWatching()) {
      this.cb.onStatus({ state: 'unsupported' });
      return;
    }
    const saved = await getMeta<WatchedFolder[]>('watchFolders');
    if (saved && saved.length > 0) {
      this.folders = saved;
    } else {
      // Carry over the single folder older versions stored.
      const legacy = await getMeta<DirHandle>('dirHandle');
      if (legacy) {
        this.folders = [{ id: 'legacy', name: legacy.name, handle: legacy, addedAt: new Date().toISOString() }];
        await this.persist();
      }
    }
    await this.reportStatus();
    if (this.folders.length > 0) this.begin();
  }

  /** Ask the user to add a folder (must run inside a click). */
  async addFolder(): Promise<boolean> {
    if (!window.showDirectoryPicker) return false;
    try {
      const handle = await window.showDirectoryPicker({ id: 'chat-atlas-downloads', mode: 'read', startIn: 'downloads' });
      const id = `wf-${Date.now()}`;
      this.folders.push({ id, name: handle.name, handle, addedAt: new Date().toISOString() });
      await this.persist();
      this.begin();
      return true;
    } catch {
      return false; // the user cancelled
    }
  }

  async removeFolder(id: string): Promise<void> {
    this.folders = this.folders.filter((f) => f.id !== id);
    await this.persist();
    if (this.folders.length === 0) this.stop();
    await this.reportStatus();
  }

  /** Re-grant access after a browser restart (must run inside a click). */
  async resume(): Promise<number> {
    let granted = 0;
    for (const f of this.folders) {
      if ((await this.permissionOf(f)) === 'granted') continue;
      try {
        if ((await f.handle.requestPermission({ mode: 'read' })) === 'granted') granted++;
      } catch {
        /* keep going: one refusal should not block the others */
      }
    }
    await this.reportStatus();
    if (granted > 0) {
      this.idleSweeps = 0;
      this.begin();
    }
    return granted;
  }

  folderNames(): string[] {
    return this.folders.map((f) => f.name);
  }

  /** Is this handle one of the folders we read from? Used to avoid writing over a source. */
  async isWatched(handle: unknown): Promise<boolean> {
    for (const f of this.folders) {
      try {
        if (f.handle.isSameEntry && (await f.handle.isSameEntry(handle))) return true;
      } catch {
        /* isSameEntry is unavailable in some browsers; fall through */
      }
    }
    return false;
  }

  // ---- scanning ----

  private begin(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.tick++;
      const slowed = this.idleSweeps >= IDLE_SWEEPS_BEFORE_BACKOFF;
      if (slowed && this.tick % BACKOFF_EVERY_NTH_TICK !== 0) return;
      void this.scan();
    }, SCAN_INTERVAL_MS);
    void this.scan();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Forget one stored file so a rescan can pick it up again. */
  async forgetDoc(storedId: string): Promise<void> {
    const seen = (await getMeta<SeenDocs>('seenDocs')) ?? {};
    let changed = false;
    for (const [k, v] of Object.entries(seen)) {
      if (v.storedId === storedId) {
        delete seen[k];
        changed = true;
      }
    }
    if (changed) await setMeta('seenDocs', seen);
  }

  /** Re-examine every document in every folder, as if none had been seen before. */
  async clearSeenDocs(): Promise<void> {
    await setMeta('seenDocs', {});
  }

  private async *walk(
    dir: DirHandle | DirEntry,
    relPath: string,
    depth: number,
    budget: { left: number },
  ): AsyncGenerator<{ file: File; relPath: string }> {
    if (depth > MAX_DEPTH || budget.left <= 0) return;
    const values = dir.values?.bind(dir);
    if (!values) return;
    for await (const entry of values()) {
      if (budget.left <= 0) return;
      const childPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (SKIP_DIR.test(entry.name)) continue;
        yield* this.walk(entry, childPath, depth + 1, budget);
        continue;
      }
      if (entry.kind !== 'file' || !entry.getFile) continue;
      const isZip = /\.zip$/i.test(entry.name);
      if (!isZip && !DOC_FILE.test(entry.name)) continue;
      budget.left--;
      try {
        yield { file: await entry.getFile(), relPath: childPath };
      } catch {
        /* the file may be mid-download; the next sweep will see it */
      }
    }
  }

  async scan(): Promise<{ looked: number; kept: number }> {
    if (this.scanning || this.folders.length === 0) return { looked: 0, kept: 0 };
    this.scanning = true;
    let looked = 0;
    let kept = 0;
    try {
      const seenZips = (await getMeta<SeenZips>('seenZips')) ?? {};
      const seenDocs = (await getMeta<SeenDocs>('seenDocs')) ?? {};
      let seenDocsChanged = false;
      let seenZipsChanged = false;
      const budget = { left: MAX_ENTRIES_PER_SWEEP };

      for (const folder of this.folders) {
        if ((await this.permissionOf(folder)) !== 'granted') continue;
        const zips: { file: File; relPath: string }[] = [];
        const docs: { file: File; relPath: string }[] = [];
        try {
          for await (const found of this.walk(folder.handle, '', 0, budget)) {
            looked++;
            if (/\.zip$/i.test(found.file.name)) {
              if (!seenZips[zipKey(found.file.name, found.file.size, found.file.lastModified)]) zips.push(found);
            } else if (!seenDocs[docKey(folder.id, found.relPath, found.file.size, found.file.lastModified)]) {
              docs.push(found);
            }
          }
        } catch {
          await this.reportStatus();
          continue;
        }

        // Oldest first, so a backlog of exports merges in the right order.
        zips.sort((a, b) => a.file.lastModified - b.file.lastModified);
        for (const { file } of zips) {
          if (await this.cb.onZip(file)) {
            seenZips[zipKey(file.name, file.size, file.lastModified)] = true;
            seenZipsChanged = true;
          }
        }

        for (const { file, relPath } of docs) {
          const result = await this.cb.onDocFile(file, { source: 'watched', folderName: folder.name, relPath });
          seenDocs[docKey(folder.id, relPath, file.size, file.lastModified)] = {
            kept: result === 'kept',
            at: new Date().toISOString(),
          };
          seenDocsChanged = true;
          if (result === 'kept') kept++;
        }
      }

      if (seenZipsChanged) await setMeta('seenZips', seenZips);
      if (seenDocsChanged) await setMeta('seenDocs', seenDocs);
      this.idleSweeps = kept === 0 ? this.idleSweeps + 1 : 0;
      await this.reportStatus();
    } catch (err) {
      this.cb.onStatus({ state: 'error', message: err instanceof Error ? err.message : 'The folder could not be read.' });
    } finally {
      this.scanning = false;
    }
    return { looked, kept };
  }

  /** One-off sweep of a folder the user picks, without watching it forever. */
  async scanFolderOnce(): Promise<{ looked: number; kept: number } | null> {
    if (!window.showDirectoryPicker) return null;
    let handle: DirHandle;
    try {
      handle = await window.showDirectoryPicker({ id: 'chat-atlas-oneshot', mode: 'read' });
    } catch {
      return null;
    }
    let looked = 0;
    let kept = 0;
    const budget = { left: MAX_ENTRIES_PER_SWEEP };
    for await (const { file, relPath } of this.walk(handle, '', 0, budget)) {
      if (/\.zip$/i.test(file.name)) continue;
      looked++;
      const result = await this.cb.onDocFile(file, { source: 'picked', folderName: handle.name, relPath });
      if (result === 'kept') kept++;
    }
    return { looked, kept };
  }

  /** Test hook: drive the watcher with a stand-in folder. */
  setHandleForTesting(handle: DirHandle): void {
    this.folders = [{ id: 'test', name: handle.name, handle, addedAt: new Date().toISOString() }];
    this.begin();
  }
}
