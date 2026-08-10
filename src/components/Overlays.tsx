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

export function DropCatcher() {
  const { importFiles } = useStore();
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
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
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
  }, [importFiles]);

  if (!active) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-inner">Drop your Claude export zip anywhere</div>
    </div>
  );
}
