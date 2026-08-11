// "Turn these into one document" — pick the order, pick the format.

import { useState } from 'react';
import type { OutputCard } from '../../types';
import { useStore } from '../../state/store';
import { compileOutputs } from '../../lib/compile';
import { exportCompiled, exportCompiledPdf } from './exporters';
import { CloseIcon } from '../Icons';
import { OUTPUT_TYPE_LABELS } from '../../lib/classify';
import { formatDate } from '../../lib/text';

export function CompileDialog({
  initialTitle,
  subtitle,
  cards,
  onClose,
}: {
  initialTitle: string;
  subtitle?: string;
  cards: OutputCard[];
  onClose: () => void;
}) {
  const { visibleEntities } = useStore();
  const [title, setTitle] = useState(initialTitle);
  const [order, setOrder] = useState<OutputCard[]>(cards);
  const [busy, setBusy] = useState(false);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const build = () => compileOutputs(title.trim() || initialTitle, subtitle, order, visibleEntities);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal compile-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Make one document</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={17} />
          </button>
        </header>
        <p className="modal-sub">
          These {order.length} item{order.length === 1 ? '' : 's'} become a single tidy file with a cover and contents page. Reorder them if
          you like, then pick a format.
        </p>
        <input className="ws-name" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Document title" />
        <div className="compile-list">
          {order.map((c, i) => (
            <div key={c.id} className="compile-row">
              <span className="compile-num">{i + 1}</span>
              <div className="compile-row-main">
                <span className="compile-row-title">{c.title}</span>
                <span className="compile-row-meta">
                  {OUTPUT_TYPE_LABELS[c.type]} · {formatDate(c.date)}
                </span>
              </div>
              <div className="compile-row-actions">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  ↑
                </button>
                <button className="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Move down">
                  ↓
                </button>
                <button className="icon-btn" onClick={() => setOrder(order.filter((x) => x.id !== c.id))} title="Leave this one out">
                  ✕
                </button>
              </div>
            </div>
          ))}
          {order.length === 0 && <p className="view-empty">Nothing left — close this and pick some items.</p>}
        </div>
        <footer className="modal-foot">
          <button
            className="secondary-btn"
            disabled={busy || order.length === 0}
            onClick={() => {
              void (async () => {
                setBusy(true);
                await exportCompiled(await build(), 'md');
                setBusy(false);
                onClose();
              })();
            }}
          >
            Markdown
          </button>
          <button
            className="secondary-btn"
            disabled={busy || order.length === 0}
            onClick={() => {
              exportCompiledPdf(build);
              onClose();
            }}
          >
            PDF
          </button>
          <button
            className="primary-btn"
            disabled={busy || order.length === 0}
            onClick={() => {
              void (async () => {
                setBusy(true);
                await exportCompiled(await build(), 'docx');
                setBusy(false);
                onClose();
              })();
            }}
          >
            {busy ? 'Making it…' : 'Word document'}
          </button>
        </footer>
      </div>
    </div>
  );
}
