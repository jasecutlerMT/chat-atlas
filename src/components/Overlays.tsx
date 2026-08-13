// Small overlay pieces: toasts, the import progress card, the stale-data
// banner, the skipped-items panel and the drag-and-drop catcher.

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { daysBetween } from '../lib/text';
import { CloseIcon } from './Icons';

export function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ProgressCard() {
  const { progress } = useStore();
  if (!progress) return null;
  return (
    <div className="progress-card">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
      </div>
      <span>{progress.label}</span>
    </div>
  );
}

export function StaleBanner() {
  const { newestDataAt, convMeta } = useStore();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || convMeta.length === 0 || !newestDataAt) return null;
  const days = daysBetween(newestDataAt);
  if (days < 8) return null;
  return (
    <div className="stale-banner">
      <span>
        Your newest saved chat is {days} days old. Fancy a refresh? On claude.ai go to Settings → Privacy → Export data, and the new zip
        will flow in here by itself.
      </span>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function SkippedModal({ onClose }: { onClose: () => void }) {
  const { skipped } = useStore();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>What was skipped, and why</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={17} />
          </button>
        </header>
        <p className="modal-sub">
          Sometimes an export contains bits in a shape Chat Atlas does not recognise. Everything readable was kept — only the items below
          were left out.
        </p>
        <ul className="skipped-list">
          {skipped.map((s, i) => (
            <li key={i}>
              <strong>{s.where}</strong>
              <span>{s.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const MAX_DROP_DEPTH = 3;
const MAX_DROP_ENTRIES = 2000;
const SKIP_DIR = /^(node_modules|\.git|Library|System|Applications|\.Trash|\.)/i;

interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: DroppedEntry[]) => void, err: (e: unknown) => void) => void };
}

/**
 * Walks a dropped folder. `readEntries` hands back at most 100 entries per
 * call, so it has to be called repeatedly until it returns nothing — a classic
 * source of "only some of my files appeared".
 */
async function collectDropped(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];
  const budget = { left: MAX_DROP_ENTRIES };

  const readAll = (entry: DroppedEntry): Promise<DroppedEntry[]> =>
    new Promise((resolve) => {
      const reader = entry.createReader?.();
      if (!reader) return resolve([]);
      const all: DroppedEntry[] = [];
      const step = () =>
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) return resolve(all);
            all.push(...batch);
            step();
          },
          () => resolve(all),
        );
      step();
    });

  const walk = async (entry: DroppedEntry, depth: number): Promise<void> => {
    if (budget.left <= 0) return;
    if (entry.isFile) {
      budget.left--;
      const file = await new Promise<File | null>((resolve) => entry.file?.((f) => resolve(f), () => resolve(null)));
      if (file) out.push(file);
      return;
    }
    if (entry.isDirectory && depth < MAX_DROP_DEPTH && !SKIP_DIR.test(entry.name)) {
      for (const child of await readAll(entry)) await walk(child, depth + 1);
    }
  };

  const roots: DroppedEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const asEntry = (items[i] as unknown as { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry?.();
    if (asEntry) roots.push(asEntry);
  }
  for (const root of roots) await walk(root, 0);
  return out;
}

export function DropCatcher() {
  const { importFiles, addFilesByHand } = useStore();
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        depth++;
        setActive(true);
      }
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setActive(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      void (async () => {
        // A dropped folder only shows up through the entry API; fall back to
        // the plain file list when it isn't available.
        let files: File[] = [];
        try {
          if (dt.items?.length) files = await collectDropped(dt.items);
        } catch {
          /* fall through */
        }
        if (files.length === 0) files = Array.from(dt.files);
        const zips = files.filter((f) => /\.zip$/i.test(f.name));
        const docs = files.filter((f) => /\.(pdf|docx?)$/i.test(f.name));
        if (zips.length) await importFiles(zips);
        if (docs.length) await addFilesByHand(docs, { source: 'dropped' });
      })();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles, addFilesByHand]);

  if (!active) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-inner">Drop an export zip, a file, or a whole folder</div>
    </div>
  );
}
