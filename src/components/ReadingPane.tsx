// The slide-over reading pane: the full conversation, rendered as proper
// markdown, scrolled to the exact message a search result pointed at.

import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '../types';
import { getConversation } from '../db/db';
import { useStore } from '../state/store';
import { formatDate, formatDateTime } from '../lib/text';
import { downloadBlob, safeFilename } from '../lib/download';
import { CopyButton, Markdown } from './Markdown';
import { CloseIcon, DownloadIcon, PaperclipIcon, PinIcon } from './Icons';

function conversationToMarkdown(conv: Conversation): string {
  const lines = [`# ${conv.name}`, ''];
  if (conv.projectName) lines.push(`Project: ${conv.projectName}`, '');
  for (const m of conv.messages) {
    lines.push(`## ${m.sender === 'human' ? 'You' : 'Claude'} — ${formatDateTime(m.created_at)}`, '');
    if (m.text) lines.push(m.text, '');
    for (const a of m.attachments) {
      if (a.file_name) lines.push(`*Attachment: ${a.file_name}*`, '');
      if (a.extracted_content) lines.push('> ' + a.extracted_content.split('\n').join('\n> '), '');
    }
  }
  return lines.join('\n');
}

export function ReadingPane() {
  const { reading, closeReading, togglePin, isPinned } = useStore();
  const [conv, setConv] = useState<Conversation | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const targetMsg = reading?.msgId;

  useEffect(() => {
    let cancelled = false;
    if (reading) {
      void getConversation(reading.convId).then((c) => {
        if (!cancelled) setConv(c ?? null);
      });
    } else {
      setConv(null);
    }
    return () => {
      cancelled = true;
    };
  }, [reading]);

  useEffect(() => {
    if (!conv || !bodyRef.current) return;
    const id = targetMsg ? `msg-${targetMsg}` : null;
    if (id) {
      const el = bodyRef.current.querySelector(`[data-msg="${targetMsg}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('msg-flash');
        const t = setTimeout(() => el.classList.remove('msg-flash'), 2400);
        return () => clearTimeout(t);
      }
    } else {
      bodyRef.current.scrollTop = 0;
    }
  }, [conv, targetMsg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReading();
    };
    if (reading) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reading, closeReading]);

  if (!reading) return null;

  return (
    <div className="pane-backdrop" onClick={closeReading}>
      <aside className="reading-pane" onClick={(e) => e.stopPropagation()} aria-label="Conversation reader">
        {!conv ? (
          <div className="pane-empty">
            <p>This conversation is not in your saved data yet.</p>
          </div>
        ) : (
          <>
            <header className="pane-head">
              <div className="pane-head-text">
                <h2>{conv.name}</h2>
                <p className="pane-sub">
                  {conv.projectName ? `${conv.projectName} · ` : ''}
                  {formatDate(conv.created_at)} · {conv.messages.length} message{conv.messages.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="pane-actions">
                <button
                  className={`icon-btn ${isPinned({ kind: 'conversation', id: conv.uuid }) ? 'icon-btn-on' : ''}`}
                  title={isPinned({ kind: 'conversation', id: conv.uuid }) ? 'Unpin this conversation' : 'Pin this conversation'}
                  onClick={() => togglePin({ kind: 'conversation', id: conv.uuid })}
                >
                  <PinIcon size={15} />
                </button>
                <button
                  className="ghost-btn"
                  title="Save this whole conversation as a Word document"
                  onClick={() => {
                    void (async () => {
                      const { renderDocxBlob } = await import('../lib/renderDocx');
                      const blob = await renderDocxBlob({
                        title: conv.name,
                        createdAt: new Date().toISOString(),
                        sections: [
                          {
                            title: conv.name,
                            typeLabel: 'Conversation',
                            date: formatDate(conv.created_at),
                            sourceConv: conv.name,
                            entityLabels: [],
                            markdown: conversationToMarkdown(conv),
                          },
                        ],
                      });
                      downloadBlob(blob, safeFilename(conv.name, '.docx'));
                    })();
                  }}
                >
                  <DownloadIcon size={15} />
                  <span>Save as Word file</span>
                </button>
                <button className="icon-btn" aria-label="Close reader" onClick={closeReading}>
                  <CloseIcon size={17} />
                </button>
              </div>
            </header>
            <div className="pane-body" ref={bodyRef}>
              {conv.messages.map((m) => (
                <article key={m.uuid} data-msg={m.uuid} className={`msg msg-${m.sender}`}>
                  <div className="msg-head">
                    <span className="msg-who">{m.sender === 'human' ? 'You' : 'Claude'}</span>
                    <span className="msg-when">{formatDateTime(m.created_at)}</span>
                    <span className="msg-spacer" />
                    {(m.text || m.attachments.length > 0) && (
                      <CopyButton
                        text={m.text || m.attachments.map((a) => a.extracted_content ?? '').join('\n')}
                        label="Copy"
                      />
                    )}
                  </div>
                  {m.text ? (
                    <Markdown text={m.text} />
                  ) : m.attachments.length === 0 && m.fileNames.length === 0 ? (
                    <p className="msg-empty">This message has no readable text.</p>
                  ) : null}
                  {m.attachments.map((a, i) => (
                    <details key={i} className="attachment">
                      <summary>
                        <PaperclipIcon size={13} /> {a.file_name ?? 'Attached file'}
                        <span className="attachment-hint">attached — click to read</span>
                      </summary>
                      {a.extracted_content ? (
                        <pre className="attachment-text">{a.extracted_content}</pre>
                      ) : (
                        <p className="msg-empty">No readable text inside this attachment.</p>
                      )}
                    </details>
                  ))}
                  {m.fileNames.map((f) => (
                    <p key={f} className="attachment-file">
                      <PaperclipIcon size={13} /> {f} <span className="attachment-hint">(file — contents not included in exports)</span>
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
