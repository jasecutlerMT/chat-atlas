// The Library's navigation: every way of slicing Jason's knowledge.

import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import type { OutputType } from '../../types';
import { OUTPUT_TYPE_LABELS } from '../../lib/classify';

const TYPE_ORDER: OutputType[] = ['research', 'email', 'plan', 'script', 'document', 'code'];

export function LibrarySidebar({ newCount }: { newCount: number }) {
  const { librarySel, setLibrarySel, groupedOutputs, scopedConvs, visibleEntities, collections, pins, createCollection, fileMoments, originalsByMoment } =
    useStore();
  const [showAllEntities, setShowAllEntities] = useState(false);
  const [newCol, setNewCol] = useState('');
  const [addingCol, setAddingCol] = useState(false);

  const scopedIds = useMemo(() => new Set(scopedConvs.map((c) => c.uuid)), [scopedConvs]);
  const typeCounts = useMemo(() => {
    const m = new Map<OutputType, number>();
    for (const o of groupedOutputs) if (scopedIds.has(o.convId)) m.set(o.type, (m.get(o.type) ?? 0) + 1);
    return m;
  }, [groupedOutputs, scopedIds]);

  const entities = useMemo(
    () => visibleEntities.filter((e) => e.convIds.some((id) => scopedIds.has(id))),
    [visibleEntities, scopedIds],
  );
  const shownEntities = showAllEntities ? entities : entities.slice(0, 12);

  const is = (kind: string, id?: string) =>
    librarySel.kind === kind &&
    ((librarySel.kind === 'entity' && librarySel.id === id) ||
      (librarySel.kind === 'collection' && librarySel.id === id) ||
      (librarySel.kind === 'type' && librarySel.type === id) ||
      (librarySel.kind !== 'entity' && librarySel.kind !== 'collection' && librarySel.kind !== 'type'));

  const kindDot = (kind?: string) =>
    kind === 'company' ? 'ent-dot-company' : kind === 'person' ? 'ent-dot-person' : kind === 'tool' ? 'ent-dot-tool' : 'ent-dot-other';

  return (
    <nav className="lib-sidebar" aria-label="Library">
      <button className={`side-item ${is('home') ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'home' })}>
        Overview
      </button>
      <button className={`side-item ${is('pinned') ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'pinned' })}>
        Pinned <span className="side-count">{pins.length}</span>
      </button>
      <button className={`side-item ${is('recent') ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'recent' })}>
        What’s new {newCount > 0 && <span className="side-count side-count-hot">{newCount}</span>}
      </button>
      <button className={`side-item ${is('documents') ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'documents' })}>
        Documents & files{' '}
        <span className="side-count" title={`${originalsByMoment.size} with the original kept`}>
          {fileMoments.length}
        </span>
      </button>

      <p className="side-head">By type</p>
      {TYPE_ORDER.filter((t) => typeCounts.get(t)).map((t) => (
        <button key={t} className={`side-item ${is('type', t) ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'type', type: t })}>
          {OUTPUT_TYPE_LABELS[t]} <span className="side-count">{typeCounts.get(t)}</span>
        </button>
      ))}

      {entities.length > 0 && (
        <>
          <p className="side-head">Companies, people & tools</p>
          {shownEntities.map((e) => (
            <button
              key={e.id}
              className={`side-item side-entity ${is('entity', e.id) ? 'side-on' : ''}`}
              onClick={() => setLibrarySel({ kind: 'entity', id: e.id })}
              title={`${e.convIds.length} conversation${e.convIds.length === 1 ? '' : 's'}`}
            >
              <span className={`ent-dot ${kindDot(e.kind)}`} />
              <span className="side-label">{e.label}</span>
              <span className="side-count">{e.convIds.length}</span>
            </button>
          ))}
          {entities.length > 12 && (
            <button className="side-more" onClick={() => setShowAllEntities((s) => !s)}>
              {showAllEntities ? 'Show fewer' : `Show all ${entities.length}…`}
            </button>
          )}
        </>
      )}

      <p className="side-head">Collections</p>
      {collections.map((c) => (
        <button key={c.id} className={`side-item ${is('collection', c.id) ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'collection', id: c.id })}>
          <span className="side-label">{c.name}</span> <span className="side-count">{c.items.length}</span>
        </button>
      ))}
      {addingCol ? (
        <form
          className="side-new-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCol.trim()) {
              const id = createCollection(newCol.trim());
              setLibrarySel({ kind: 'collection', id });
            }
            setNewCol('');
            setAddingCol(false);
          }}
        >
          <input
            autoFocus
            placeholder="Name it… e.g. Cold call playbook"
            value={newCol}
            onChange={(e) => setNewCol(e.target.value)}
            onBlur={() => setAddingCol(false)}
          />
        </form>
      ) : (
        <button className="side-more" onClick={() => setAddingCol(true)}>
          ＋ New collection
        </button>
      )}

      <p className="side-head">Everything</p>
      <button className={`side-item ${is('conversations') ? 'side-on' : ''}`} onClick={() => setLibrarySel({ kind: 'conversations' })}>
        All conversations <span className="side-count">{scopedConvs.length}</span>
      </button>
    </nav>
  );
}
