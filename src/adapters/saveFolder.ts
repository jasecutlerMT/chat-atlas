// The auto-save folder: a folder Jason picks once (e.g. "Chat Atlas
// Documents") where new documents are written as real files — kept originals
// exactly as captured, and rebuilt Word files for file-moments that have no
// original. Uses the File System Access API with write permission.

import { getMeta, setMeta } from '../db/db';

export interface WritableDirHandle {
  name: string;
  queryPermission(opts: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(opts: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

export type SaveFolderStatus =
  | { state: 'off' }
  | { state: 'needs-permission'; folderName: string }
  | { state: 'on'; folderName: string };

export class SaveFolder {
  private handle: WritableDirHandle | null = null;
  private onStatus: (s: SaveFolderStatus) => void;

  constructor(onStatus: (s: SaveFolderStatus) => void) {
    this.onStatus = onStatus;
  }

  /**
   * True when this folder is also one the watcher reads from — writing into it
   * would mean copying a file back over itself.
   */
  async isWatchedBy(watcher: { isWatched(handle: unknown): Promise<boolean> } | null | undefined): Promise<boolean> {
    if (!this.handle || !watcher) return false;
    return watcher.isWatched(this.handle);
  }

  async restore(): Promise<void> {
    const saved = await getMeta<WritableDirHandle>('saveFolderHandle');
    if (!saved) {
      this.onStatus({ state: 'off' });
      return;
    }
    this.handle = saved;
    try {
      const perm = await saved.queryPermission({ mode: 'readwrite' });
      this.onStatus(perm === 'granted' ? { state: 'on', folderName: saved.name } : { state: 'needs-permission', folderName: saved.name });
    } catch {
      this.onStatus({ state: 'needs-permission', folderName: saved.name });
    }
  }

  /** Ask the user to choose the folder (must run inside a click). */
  async pick(): Promise<boolean> {
    const picker = (window as unknown as Record<string, unknown>).showDirectoryPicker as
      | ((opts: { id: string; mode: string }) => Promise<WritableDirHandle>)
      | undefined;
    if (!picker) return false;
    try {
      const handle = await picker({ id: 'chat-atlas-save', mode: 'readwrite' });
      this.handle = handle;
      await setMeta('saveFolderHandle', handle);
      this.onStatus({ state: 'on', folderName: handle.name });
      return true;
    } catch {
      return false; // cancelled
    }
  }

  /** Re-grant write access after a browser restart (must run inside a click). */
  async resume(): Promise<boolean> {
    if (!this.handle) return false;
    try {
      const perm = await this.handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.onStatus({ state: 'on', folderName: this.handle.name });
        return true;
      }
    } catch {
      /* fall through */
    }
    this.onStatus({ state: 'needs-permission', folderName: this.handle?.name ?? 'your folder' });
    return false;
  }

  async turnOff(): Promise<void> {
    this.handle = null;
    await setMeta('saveFolderHandle', undefined);
    this.onStatus({ state: 'off' });
  }

  /** Test hook: inject a fake writable handle. */
  setHandleForTesting(handle: WritableDirHandle): void {
    this.handle = handle;
    this.onStatus({ state: 'on', folderName: handle.name });
  }

  async ready(): Promise<boolean> {
    if (!this.handle) return false;
    try {
      return (await this.handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch {
      return false;
    }
  }

  /** Write a file, returning true on success. Never throws. */
  async writeFile(name: string, blob: Blob): Promise<boolean> {
    if (!this.handle) return false;
    try {
      const fh = await this.handle.getFileHandle(sanitise(name), { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch {
      return false;
    }
  }
}

function sanitise(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').slice(0, 120) || 'chat-atlas-file';
}
