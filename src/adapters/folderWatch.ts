// Watches a folder (normally Downloads) for new Claude export zips using the
// File System Access API — Chrome only. The chosen folder handle is saved in
// IndexedDB so future visits need at most one "Allow" click. Every ~30 seconds
// the folder is scanned; a zip we have not successfully processed before is
// handed to the import pipeline. Files are remembered by name + size +
// modified time, so re-downloading a genuinely new export always triggers.

import { getMeta, setMeta } from '../db/db';

const SCAN_INTERVAL_MS = 30_000;

// Minimal typings for the File System Access API (not yet in TypeScript's DOM lib).
export interface DirHandle {
  name: string;
  values(): AsyncIterable<{ kind: string; name: string; getFile(): Promise<File> }>;
  queryPermission(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(opts: { mode: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: string; startIn?: string }) => Promise<DirHandle>;
  }
}

export function browserSupportsWatching(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export type WatcherStatus =
  | { state: 'unsupported' }
  | { state: 'off' }
  | { state: 'needs-permission'; folderName: string }
  | { state: 'watching'; folderName: string }
  | { state: 'error'; message: string };

type SeenMap = Record<string, true>;

function fileKey(name: string, size: number, lastModified: number): string {
  return `${name}|${size}|${lastModified}`;
}

export class FolderWatcher {
  private handle: DirHandle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private onZip: (file: File) => Promise<boolean>;
  private onStatus: (s: WatcherStatus) => void;

  constructor(onZip: (file: File) => Promise<boolean>, onStatus: (s: WatcherStatus) => void) {
    this.onZip = onZip;
    this.onStatus = onStatus;
  }

  /** Try to resume watching from a previously saved folder handle. */
  async restore(): Promise<void> {
    if (!browserSupportsWatching()) {
      this.onStatus({ state: 'unsupported' });
      return;
    }
    const saved = await getMeta<DirHandle>('dirHandle');
    if (!saved) {
      this.onStatus({ state: 'off' });
      return;
    }
    this.handle = saved;
    try {
      const perm = await saved.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        this.begin();
      } else {
        this.onStatus({ state: 'needs-permission', folderName: saved.name });
      }
    } catch {
      this.onStatus({ state: 'needs-permission', folderName: saved.name });
    }
  }

  /** Ask the user to choose a folder (must run inside a click). */
  async pickFolder(): Promise<boolean> {
    if (!window.showDirectoryPicker) return false;
    try {
      const handle = await window.showDirectoryPicker({ id: 'chat-atlas-downloads', mode: 'read', startIn: 'downloads' });
      this.handle = handle;
      await setMeta('dirHandle', handle);
      // Anything already sitting in the folder gets a first look too — mark
      // nothing as seen, so an export downloaded before setup is picked up.
      this.begin();
      return true;
    } catch {
      return false; // user cancelled the picker
    }
  }

  /** Re-grant access after a browser restart (must run inside a click). */
  async resume(): Promise<boolean> {
    if (!this.handle) return false;
    try {
      const perm = await this.handle.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        this.begin();
        return true;
      }
    } catch {
      /* fall through */
    }
    this.onStatus({ state: 'needs-permission', folderName: this.handle.name });
    return false;
  }

  /** Test hook: inject a fake directory handle (used by automated tests only). */
  setHandleForTesting(handle: DirHandle): void {
    this.handle = handle;
    this.begin();
  }

  private begin(): void {
    if (!this.handle) return;
    this.onStatus({ state: 'watching', folderName: this.handle.name });
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    void this.scan();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan(): Promise<void> {
    if (!this.handle || this.scanning) return;
    this.scanning = true;
    try {
      const seen = (await getMeta<SeenMap>('seenZips')) ?? {};
      const candidates: File[] = [];
      for await (const entry of this.handle.values()) {
        if (entry.kind !== 'file' || !/\.zip$/i.test(entry.name)) continue;
        try {
          const file = await entry.getFile();
          if (!seen[fileKey(file.name, file.size, file.lastModified)]) candidates.push(file);
        } catch {
          /* the file may be mid-download; try again next scan */
        }
      }
      // Oldest first so a backlog of exports merges in the right order.
      candidates.sort((a, b) => a.lastModified - b.lastModified);
      for (const file of candidates) {
        const processed = await this.onZip(file);
        if (processed) {
          const fresh = (await getMeta<SeenMap>('seenZips')) ?? {};
          fresh[fileKey(file.name, file.size, file.lastModified)] = true;
          await setMeta('seenZips', fresh);
        }
      }
    } catch (err) {
      const perm = this.handle ? await this.handle.queryPermission({ mode: 'read' }).catch(() => 'denied') : 'denied';
      if (perm !== 'granted') {
        this.onStatus({ state: 'needs-permission', folderName: this.handle?.name ?? 'your folder' });
        this.stop();
      } else {
        this.onStatus({ state: 'error', message: err instanceof Error ? err.message : 'The folder could not be read.' });
      }
    } finally {
      this.scanning = false;
    }
  }
}
