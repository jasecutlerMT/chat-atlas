// The Library: the app's home. Sidebar of knowledge sources on the left,
// the selected slice of Jason's knowledge on the right.

import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import type { ConvMeta, EntityKind, OutputCard } from '../../types';
import { LibraryRow, ConversationRow } from './LibraryRow';
import { LibrarySidebar } from './LibrarySidebar';
import { CompileDialog } from './CompileDialog';
import { FilesPage } from './FilesPage';
import { AllChatsView } from '../AllChatsView';
import { OUTPUT_TYPE_LABELS } from '../../lib/classify';
import { formatDate } from '../../lib/text';

interface CompileRequest {
  title: string;
  subtitle?: string;
  cards: OutputCard[];
}

export function LibraryView() {
  const {
    librarySel,
    groupedOutputs,
    outputs,
    scopedConvs,
    convMeta,
    visibleEntities,
    collections,
    pins,
    prevImportAt,
    renameEntity,
    hideEntity,
    mergeEntities,
    setEntityKind,
    renameCollection,
    deleteCollection,
    removeFromCollection,
    moveInCollection,
    setLibrarySel,
  } = useStore();
  const [compile, setCompile] = useState<CompileRequest | null>(null);

  const scopedIds = useMemo(() => new Set(scopedConvs.map((c) => c.uuid)), [scopedConvs]);
  const scopedOutputs = useMemo(() => groupedOutputs.filter((o) => scopedIds.has(o.convId)), [groupedOutputs, scopedIds]);
  const cardById = useMemo(() => new Map(outputs.map((o) => [o.id, o])), [outputs]);
  const convById = useMemo(() => new Map(convMeta.map((c) => [c.uuid, c])), [convMeta]);

  const newOutputs = useMemo(
    () => (prevImportAt ? scopedOutputs.filter((o) => o.date > prevImportAt) : []),
    [scopedOutputs, prevImportAt],
  );

  let content: React.ReactNode = null;
  let heading = '';
  let sub = '';
  let compilable: OutputCard[] = [];

  if (librarySel.kind === 'home') {
    const recent = scopedOutputs.slice(0, 12);
    const pinnedCards = pins.map((p) => (p.kind === 'output' ? cardById.get(p.id) : undefined)).filter(Boolean) as OutputCard[];
    content = (
      <>
        {newOutputs.length > 0 && (
          <>
            <h2 className="lib-section-head">
              New since your last export <span className="side-count side-count-hot">{newOutputs.length}</span>
            </h2>
            {newOutputs.slice(0, 6).map((c) => (
              <LibraryRow key={c.id} card={c} />
            ))}
          </>
        )}
        {pinnedCards.length > 0 && (
          <>
            <h2 className="lib-section-head">Pinned</h2>
            {pinnedCards.slice(0, 6).map((c) => (
              <LibraryRow key={c.id} card={c} />
            ))}
          </>
        )}
        <h2 className="lib-section-head">Recent things Claude made for you</h2>
        {recent.map((c) => (
          <LibraryRow key={c.id} card={c} />
        ))}
        {recent.length === 0 && (
          <div className="view-empty">
            <p>Nothing here yet — once your conversations are in, everything Claude has made for you appears here.</p>
          </div>
        )}
      </>
    );
    heading = 'Your library';
    sub = `${scopedOutputs.length} things Claude made for you, across ${scopedConvs.length} conversations. Search up top finds any sentence ever written.`;
  } else if (librarySel.kind === 'pinned') {
    const cards = pins.map((p) => (p.kind === 'output' ? cardById.get(p.id) : undefined)).filter(Boolean) as OutputCard[];
    const convs = pins.map((p) => (p.kind === 'conversation' ? convById.get(p.id) : undefined)).filter(Boolean) as ConvMeta[];
    heading = 'Pinned';
    sub = 'The things you chose to keep at hand.';
    compilable = cards;
    content = (
      <>
        {cards.map((c) => (
          <LibraryRow key={c.id} card={c} />
        ))}
        {convs.map((c) => (
          <ConversationRow key={c.uuid} conv={c} />
        ))}
        {cards.length + convs.length === 0 && (
          <div className="view-empty">
            <p>Nothing pinned yet. The pin button on any item keeps it here, always one click away.</p>
          </div>
        )}
      </>
    );
  } else if (librarySel.kind === 'recent') {
    heading = 'What’s new';
    sub = prevImportAt
      ? `Everything added since your previous export (${formatDate(prevImportAt)}).`
      : 'Everything from your most recent export.';
    const cards = newOutputs.length > 0 ? newOutputs : scopedOutputs.slice(0, 20);
    compilable = cards;
    content = (
      <>
        {cards.map((c) => (
          <LibraryRow key={c.id} card={c} />
        ))}
        {cards.length === 0 && (
          <div className="view-empty">
            <p>Nothing new since the last export. Download a fresh one from claude.ai and it lands here by itself.</p>
          </div>
        )}
      </>
    );
  } else if (librarySel.kind === 'type') {
    const cards = scopedOutputs.filter((o) => o.type === librarySel.type);
    heading = OUTPUT_TYPE_LABELS[librarySel.type] + 's';
    sub = `${cards.length} of these in your library.`;
    compilable = cards;
    content = (
      <>
        {cards.map((c) => (
          <LibraryRow key={c.id} card={c} />
        ))}
        {cards.length === 0 && (
          <div className="view-empty">
            <p>None of these yet.</p>
          </div>
        )}
      </>
    );
  } else if (librarySel.kind === 'entity') {
    const entity = visibleEntities.find((e) => e.id === librarySel.id);
    if (!entity) {
      content = (
        <div className="view-empty">
          <p>That one is gone — maybe hidden or merged. Pick another from the sidebar.</p>
        </div>
      );
    } else {
      const entityConvIds = new Set(entity.convIds);
      const cards = scopedOutputs.filter((o) => entity.outputIds.includes(o.id) || entityConvIds.has(o.convId));
      const convs = scopedConvs.filter((c) => entityConvIds.has(c.uuid));
      heading = entity.label;
      sub = `${cards.length} output${cards.length === 1 ? '' : 's'} and ${convs.length} conversation${convs.length === 1 ? '' : 's'} mention this.`;
      compilable = cards;
      content = (
        <>
          <EntityTools
            id={entity.id}
            kind={entity.kind}
            label={entity.label}
            onRename={(l) => renameEntity(entity.id, l)}
            onHide={() => hideEntity(entity.id)}
            onKind={(k) => setEntityKind(entity.id, k)}
            onMerge={(intoId) => mergeEntities(entity.id, intoId)}
            others={visibleEntities.filter((e) => e.id !== entity.id).slice(0, 40)}
          />
          {cards.map((c) => (
            <LibraryRow key={c.id} card={c} />
          ))}
          {convs.length > 0 && <h2 className="lib-section-head">Conversations</h2>}
          {convs.map((c) => (
            <ConversationRow key={c.uuid} conv={c} />
          ))}
        </>
      );
    }
  } else if (librarySel.kind === 'collection') {
    const col = collections.find((c) => c.id === librarySel.id);
    if (!col) {
      content = (
        <div className="view-empty">
          <p>This collection was deleted.</p>
        </div>
      );
    } else {
      heading = col.name;
      sub = `${col.items.length} item${col.items.length === 1 ? '' : 's'}, in the order you arranged them.`;
      compilable = col.items.map((i) => (i.kind === 'output' ? cardById.get(i.id) : undefined)).filter(Boolean) as OutputCard[];
      content = (
        <>
          <div className="collection-tools">
            <input
              className="collection-name"
              value={col.name}
              onChange={(e) => renameCollection(col.id, e.target.value)}
              aria-label="Collection name"
            />
            <button className="danger-btn" onClick={() => deleteCollection(col.id)}>
              Delete collection
            </button>
          </div>
          {col.items.map((item, i) => {
            const inner =
              item.kind === 'output' ? (
                cardById.get(item.id) ? (
                  <LibraryRow card={cardById.get(item.id)!} onRemove={() => removeFromCollection(col.id, item)} />
                ) : null
              ) : convById.get(item.id) ? (
                <ConversationRow conv={convById.get(item.id)!} />
              ) : null;
            if (!inner) return null;
            return (
              <div key={`${item.kind}-${item.id}`} className="collection-item">
                <div className="collection-reorder">
                  <button className="icon-btn" disabled={i === 0} onClick={() => moveInCollection(col.id, i, -1)} title="Move up">
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    disabled={i === col.items.length - 1}
                    onClick={() => moveInCollection(col.id, i, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                </div>
                <div className="collection-item-body">{inner}</div>
              </div>
            );
          })}
          {col.items.length === 0 && (
            <div className="view-empty">
              <p>Empty so far. Use the ＋ button on any item to add it here.</p>
            </div>
          )}
        </>
      );
    }
  } else if (librarySel.kind === 'documents') {
    heading = 'Your files';
    sub = 'Every file Claude has made for you, ready to download again — any time, forever.';
    content = <FilesPage />;
  } else if (librarySel.kind === 'conversations') {
    heading = 'All conversations';
    sub = '';
    content = <AllChatsView embedded />;
  }

  return (
    <div className="library-wrap">
      <LibrarySidebar newCount={newOutputs.length} />
      <div className="lib-content">
        {librarySel.kind !== 'conversations' && (
          <header className="lib-head">
            <div>
              <h1>{heading}</h1>
              {sub && <p className="view-sub">{sub}</p>}
            </div>
            {compilable.length > 0 && (
              <button
                className="secondary-btn"
                onClick={() => setCompile({ title: heading, subtitle: sub || undefined, cards: compilable })}
                title="Combine everything shown here into one Word or PDF document"
              >
                Make one document
              </button>
            )}
          </header>
        )}
        <div className="lib-list">{content}</div>
      </div>
      {compile && <CompileDialog initialTitle={compile.title} subtitle={compile.subtitle} cards={compile.cards} onClose={() => setCompile(null)} />}
      {librarySel.kind !== 'home' && (
        <button className="lib-back" onClick={() => setLibrarySel({ kind: 'home' })}>
          ← Overview
        </button>
      )}
    </div>
  );
}

function EntityTools({
  id,
  label,
  kind,
  onRename,
  onHide,
  onKind,
  onMerge,
  others,
}: {
  id: string;
  label: string;
  kind?: EntityKind;
  onRename: (label: string) => void;
  onHide: () => void;
  onKind: (k: EntityKind | undefined) => void;
  onMerge: (intoId: string) => void;
  others: { id: string; label: string }[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(label);
  void id;
  return (
    <div className="entity-tools">
      {renaming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onRename(name.trim());
            setRenaming(false);
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} />
        </form>
      ) : (
        <button className="ghost-btn" onClick={() => setRenaming(true)}>
          Rename
        </button>
      )}
      <select
        value={kind ?? ''}
        onChange={(e) => onKind((e.target.value || undefined) as EntityKind | undefined)}
        aria-label="What is this?"
        title="What kind of thing is this?"
      >
        <option value="">Unlabelled</option>
        <option value="company">Company</option>
        <option value="person">Person</option>
        <option value="tool">Tool</option>
      </select>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onMerge(e.target.value);
        }}
        aria-label="Merge into another entry"
        title="Same thing under a different name? Merge them."
      >
        <option value="">Merge into…</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button className="ghost-btn" onClick={onHide} title="Not useful? Hide it from the sidebar for good.">
        Hide this
      </button>
    </div>
  );
}
