// One item in the Library: an output (or conversation) with its actions.

import { useMemo, useRef, useState } from 'react';
import type { ConvMeta, OutputCard } from '../../types';
import { OUTPUT_TYPE_LABELS } from '../../lib/classify';
import { formatDate } from '../../lib/text';
import { outputFullText, downloadText } from '../../lib/download';
import { useStore } from '../../state/store';
import { ArrowRightIcon, CheckIcon, CopyIcon, DownloadIcon, PinIcon } from '../Icons';
import { exportSingleCard } from './exporters';

function AddToCollectionButton({ refItem }: { refItem: { kind: 'output' | 'conversation'; id: string } }) {
  const { collections, createCollection, addToCollection } = useStore();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div className="popover-wrap" ref={wrapRef}>
      <button className="icon-btn" title="Add to a collection" onClick={() => setOpen((o) => !o)}>
        <span className="plus-icon">＋</span>
      </button>
      {open && (
        <div className="popover" onMouseLeave={() => setOpen(false)}>
          <p className="popover-title">Add to collection</p>
          {collections.map((c) => (
            <button
              key={c.id}
              className="popover-item"
              onClick={() => {
                addToCollection(c.id, refItem);
                setOpen(false);
              }}
            >
              {c.name} <span className="popover-count">{c.items.length}</span>
            </button>
          ))}
          <form
            className="popover-new"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              // Create with the item already inside — adding right after
              // creating would read not-yet-updated state and silently miss.
              createCollection(newName.trim(), [refItem]);
              setNewName('');
              setOpen(false);
            }}
          >
            <input placeholder="New collection…" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </form>
        </div>
      )}
    </div>
  );
}

export function LibraryRow({
  card,
  onRemove,
  showVersions = true,
}: {
  card: OutputCard;
  onRemove?: () => void;
  showVersions?: boolean;
}) {
  const { openConversation, togglePin, isPinned, versionsOf, visibleEntities, setLibrarySel } = useStore();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const refItem = { kind: 'output' as const, id: card.id };
  const pinned = isPinned(refItem);

  const versions = useMemo(() => (showVersions ? versionsOf(card.groupId) : [card]), [showVersions, versionsOf, card]);
  const entityChips = useMemo(
    () => visibleEntities.filter((e) => card.entityIds.includes(e.id)).slice(0, 3),
    [visibleEntities, card.entityIds],
  );

  return (
    <>
      <article className="lib-row">
        <button className="lib-row-main" onClick={() => openConversation(card.convId, card.msgId)}>
          <div className="lib-row-top">
            <span className={`badge badge-${card.type}`}>{OUTPUT_TYPE_LABELS[card.type]}</span>
            {versions.length > 1 && (
              <span
                className="version-badge"
                title={`${versions.length} drafts of this — click to ${expanded ? 'hide' : 'see'} the others`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => !x);
                }}
              >
                v{versions.length}
              </span>
            )}
            <span className="lib-row-title">{card.title}</span>
          </div>
          <p className="lib-row-preview">{card.preview}</p>
          <div className="lib-row-meta">
            {entityChips.map((e) => (
              <span
                key={e.id}
                className="entity-chip"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setLibrarySel({ kind: 'entity', id: e.id });
                }}
              >
                {e.label}
              </span>
            ))}
            <span>{formatDate(card.date)}</span>
            <span className="lib-row-conv">from “{card.convName}”</span>
          </div>
        </button>
        <div className="lib-row-actions">
          <button
            className="icon-btn"
            title="Copy the full text"
            onClick={() => {
              void outputFullText(card).then((t) => {
                void navigator.clipboard.writeText(t);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
          <button className={`icon-btn ${pinned ? 'icon-btn-on' : ''}`} title={pinned ? 'Unpin' : 'Pin to the top of your library'} onClick={() => togglePin(refItem)}>
            <PinIcon size={15} />
          </button>
          <AddToCollectionButton refItem={refItem} />
          <ExportMenu card={card} />
          {onRemove && (
            <button className="icon-btn" title="Remove from this collection" onClick={onRemove}>
              ✕
            </button>
          )}
          <button className="icon-btn" title="Open in the conversation" onClick={() => openConversation(card.convId, card.msgId)}>
            <ArrowRightIcon size={15} />
          </button>
        </div>
      </article>
      {expanded &&
        versions
          .filter((v) => v.id !== card.id)
          .map((v) => (
            <div key={v.id} className="lib-row-version">
              <LibraryRow card={v} showVersions={false} />
            </div>
          ))}
    </>
  );
}

function ExportMenu({ card }: { card: OutputCard }) {
  const { visibleEntities } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="popover-wrap">
      <button className="icon-btn" title="Save as a file (Word, PDF or markdown)" onClick={() => setOpen((o) => !o)}>
        <DownloadIcon size={15} />
      </button>
      {open && (
        <div className="popover" onMouseLeave={() => setOpen(false)}>
          <p className="popover-title">Save as…</p>
          <button
            className="popover-item"
            onClick={() => {
              setOpen(false);
              void exportSingleCard(card, visibleEntities, 'docx');
            }}
          >
            Word document (.docx)
          </button>
          <button
            className="popover-item"
            onClick={() => {
              setOpen(false);
              void exportSingleCard(card, visibleEntities, 'pdf');
            }}
          >
            PDF (via print)
          </button>
          <button
            className="popover-item"
            onClick={() => {
              setOpen(false);
              void outputFullText(card).then((t) => downloadText(card.title, t));
            }}
          >
            Markdown (.md)
          </button>
        </div>
      )}
    </div>
  );
}

export function ConversationRow({ conv }: { conv: ConvMeta }) {
  const { openConversation, togglePin, isPinned } = useStore();
  const refItem = { kind: 'conversation' as const, id: conv.uuid };
  const pinned = isPinned(refItem);
  return (
    <article className="lib-row lib-row-conv-item">
      <button className="lib-row-main" onClick={() => openConversation(conv.uuid)}>
        <div className="lib-row-top">
          <span className="badge badge-conversation">Conversation</span>
          <span className="lib-row-title">{conv.name}</span>
        </div>
        <div className="lib-row-meta">
          <span>{conv.messageCount} messages</span>
          <span>{formatDate(conv.updated_at)}</span>
          {conv.projectName && <span>{conv.projectName}</span>}
        </div>
      </button>
      <div className="lib-row-actions">
        <button className={`icon-btn ${pinned ? 'icon-btn-on' : ''}`} title={pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(refItem)}>
          <PinIcon size={15} />
        </button>
        <AddToCollectionButton refItem={refItem} />
        <button className="icon-btn" title="Open" onClick={() => openConversation(conv.uuid)}>
          <ArrowRightIcon size={15} />
        </button>
      </div>
    </article>
  );
}
