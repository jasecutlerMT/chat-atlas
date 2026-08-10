// Build or edit a named workspace: pick conversations by hand, by search,
// or select everything in a date range.

import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';
import { CloseIcon } from './Icons';

export function WorkspaceModal({ editId, onClose }: { editId: string | null; onClose: () => void }) {
  const { convMeta, workspaces, saveWorkspace, deleteWorkspace, setScope } = useStore();
  const editing = workspaces.find((w) => w.id === editId) ?? null;
  const [name, setName] = useState(editing?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(editing?.convIds ?? []));
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const list = useMemo(() => {
    let l = convMeta;
    if (filter.trim()) {
      const f = filter.toLowerCase();
      l = l.filter((c) => c.name.toLowerCase().includes(f) || c.keywords.some((k) => k.includes(f)));
    }
    return l;
  }, [convMeta, filter]);

  const inRange = useMemo(
    () =>
      list.filter((c) => {
        const d = (c.updated_at || c.created_at).slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [list, from, to],
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal workspace-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{editing ? 'Edit workspace' : 'New workspace'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={17} />
          </button>
        </header>
        <p className="modal-sub">
          A workspace is a hand-picked group of conversations — like “Career” — that the whole app can be narrowed down to.
        </p>
        <input className="ws-name" placeholder="Workspace name, e.g. Career" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="ws-tools">
          <input
            type="search"
            placeholder="Search conversations…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search conversations to add"
          />
          <label>
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            className="ghost-btn"
            onClick={() => setSelected(new Set([...selected, ...inRange.map((c) => c.uuid)]))}
            title="Select every conversation currently shown in the list"
          >
            Select all shown ({inRange.length})
          </button>
          <button className="ghost-btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>

        <div className="ws-list">
          {inRange.map((c) => (
            <label key={c.uuid} className="ws-row">
              <input type="checkbox" checked={selected.has(c.uuid)} onChange={() => toggle(c.uuid)} />
              <span className="ws-row-name">{c.name}</span>
              <span className="ws-row-meta">
                {c.projectName ? `${c.projectName} · ` : ''}
                {formatDate(c.updated_at)}
              </span>
            </label>
          ))}
          {inRange.length === 0 && <p className="view-empty">Nothing matches that search or date range.</p>}
        </div>

        <footer className="modal-foot">
          {editing && (
            <button
              className="danger-btn"
              onClick={() => {
                void deleteWorkspace(editing.id);
                onClose();
              }}
            >
              Delete workspace
            </button>
          )}
          <span className="modal-count">{selected.size} selected</span>
          <button
            className="primary-btn"
            disabled={!name.trim() || selected.size === 0}
            onClick={() => {
              void saveWorkspace(name.trim(), [...selected], editing?.id).then((id) => {
                // Jump straight into the workspace so the effect is obvious.
                setScope({ kind: 'workspace', id, name: name.trim() });
              });
              onClose();
            }}
          >
            Save workspace
          </button>
        </footer>
      </div>
    </div>
  );
}
