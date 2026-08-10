// The Outputs shelf: every deliverable Claude produced, auto-classified and
// browsable as cards with copy / open / save actions.

import { useMemo, useState } from 'react';
import type { OutputCard, OutputType } from '../types';
import { OUTPUT_TYPE_LABELS } from '../lib/classify';
import { getConversation } from '../db/db';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';
import { ArrowRightIcon, CheckIcon, CopyIcon, DownloadIcon } from './Icons';

const TYPE_ORDER: OutputType[] = ['research', 'email', 'script', 'plan', 'document', 'code'];

async function fullText(card: OutputCard): Promise<string> {
  const conv = await getConversation(card.convId);
  const msg = conv?.messages.find((m) => m.uuid === card.msgId);
  return msg?.text ?? '';
}

function Card({ card }: { card: OutputCard }) {
  const { openConversation } = useStore();
  const [copied, setCopied] = useState(false);

  return (
    <article className={`output-card output-${card.type}`}>
      <div className="output-top">
        <span className={`badge badge-${card.type}`}>{OUTPUT_TYPE_LABELS[card.type]}</span>
        <span className="output-date">{formatDate(card.date)}</span>
      </div>
      <h3 className="output-title">{card.title}</h3>
      <p className="output-preview">{card.preview}</p>
      <div className="output-foot">
        <span className="output-conv" title={card.convName}>
          {card.convName}
        </span>
        <div className="output-actions">
          <button
            className="icon-btn"
            title="Copy the full text"
            onClick={() => {
              void fullText(card).then((t) => {
                void navigator.clipboard.writeText(t);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
          <button
            className="icon-btn"
            title="Save as a markdown file"
            onClick={() => {
              void fullText(card).then((t) => {
                const blob = new Blob([t], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = card.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) + '.md';
                a.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            <DownloadIcon size={15} />
          </button>
          <button className="icon-btn" title="Open in the conversation" onClick={() => openConversation(card.convId, card.msgId)}>
            <ArrowRightIcon size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function OutputsView() {
  const { outputs, scopedConvs } = useStore();
  const [typeFilter, setTypeFilter] = useState<OutputType | 'all'>('all');

  const scopedIds = useMemo(() => new Set(scopedConvs.map((c) => c.uuid)), [scopedConvs]);
  const visible = useMemo(
    () => outputs.filter((o) => scopedIds.has(o.convId) && (typeFilter === 'all' || o.type === typeFilter)),
    [outputs, scopedIds, typeFilter],
  );
  const counts = useMemo(() => {
    const m = new Map<OutputType, number>();
    for (const o of outputs) if (scopedIds.has(o.convId)) m.set(o.type, (m.get(o.type) ?? 0) + 1);
    return m;
  }, [outputs, scopedIds]);

  return (
    <div className="view-scroll">
      <div className="view-inner">
        <header className="view-head">
          <h1>Outputs</h1>
          <p className="view-sub">Everything Claude made for you — briefs, drafts, plans, scripts, documents and code — pulled out automatically.</p>
        </header>
        <div className="chip-row chip-row-static">
          <button className={`chip ${typeFilter === 'all' ? 'chip-on' : ''}`} onClick={() => setTypeFilter('all')}>
            All · {[...counts.values()].reduce((a, b) => a + b, 0)}
          </button>
          {TYPE_ORDER.filter((t) => counts.get(t)).map((t) => (
            <button key={t} className={`chip ${typeFilter === t ? 'chip-on' : ''}`} onClick={() => setTypeFilter(t)}>
              {OUTPUT_TYPE_LABELS[t]} · {counts.get(t)}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="view-empty">
            <p>
              No outputs here yet. Once your conversations are in, anything that looks like a finished piece — a brief, a draft, a plan, a
              script or code — shows up here as a card.
            </p>
          </div>
        ) : (
          <div className="output-grid">
            {visible.map((c) => (
              <Card key={c.id} card={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
