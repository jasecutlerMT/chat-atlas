// Your files: every PDF and Word document Claude has made, newest first.
//
// Two guarantees hold this screen together:
//   1. A Download button here always hands over the exact bytes Claude made.
//      The app never invents a document — if the real file is not on this Mac,
//      the row says so and points back at the chat where it can be downloaded.
//   2. Every row's date is the moment Claude made the file (read from inside
//      the file itself where possible), and the row can say where that date
//      came from.
//
// The view deliberately ignores the project/workspace scope: the promise is
// "every file, ever", and a file that isn't linked to a chat has no scope.

import { useMemo, useRef, useState } from 'react';
import type { FileMoment, StoredFileMeta } from '../../types';
import { useStore } from '../../state/store';
import { formatDateTime } from '../../lib/text';
import { ArrowRightIcon, FolderIcon, PaperclipIcon } from '../Icons';

type Ext = 'PDF' | 'Word' | 'File';

function extOf(name: string | undefined): Ext {
  if (!name) return 'File';
  if (/\.pdf$/i.test(name)) return 'PDF';
  if (/\.docx?$/i.test(name)) return 'Word';
  return 'File';
}

function prettyTitle(raw: string): string {
  const base = raw.replace(/\.[a-z0-9]+$/i, '');
  const spaced = base
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .trim();
  if (spaced.length <= 2) return raw;
  return spaced
    .split(' ')
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const DATE_SOURCE_WORDS: Record<string, string> = {
  'docx-core': 'This is the time recorded inside the file itself.',
  'pdf-info': 'This is the time recorded inside the file itself.',
  'pdf-xmp': 'This is the time recorded inside the file itself.',
  message: 'Taken from the message that delivered it.',
  'file-mtime': 'Taken from when the file arrived on this Mac.',
  none: '',
};

interface SavedRow {
  kind: 'saved';
  key: string;
  meta: StoredFileMeta;
  producedAt: string;
  title: string;
  ext: Ext;
  convId?: string;
  convName?: string;
}

function SavedFileRow({ row }: { row: SavedRow }) {
  const { downloadOriginal, removeStoredFile, openConversation, convMeta, linkFileToConversation, keepReviewedFile } = useStore();
  const [linking, setLinking] = useState(false);
  const m = row.meta;

  const status = m.isClaudeMade
    ? 'Claude’s original file, exactly as you downloaded it.'
    : m.source === 'attached' || m.source === 'picked' || m.source === 'dropped'
      ? 'The exact file you added.'
      : `The exact file from ${m.folderName ?? 'your folder'}.`;

  return (
    <article className="file-card" data-testid="file-card">
      <div className="file-card-icon" aria-hidden>
        <span className={`file-ext file-ext-${row.ext.toLowerCase()}`}>{row.ext === 'Word' ? 'DOC' : row.ext === 'PDF' ? 'PDF' : 'FILE'}</span>
      </div>
      <div className="file-card-main">
        <span className="file-card-title">{row.title}</span>
        <span className="file-card-name">{m.name}</span>
        <span className="file-card-sub">
          {row.ext} · <span title={DATE_SOURCE_WORDS[m.producedAtSource ?? 'none']}>{formatDateTime(row.producedAt)}</span>
          {row.convName && (
            <>
              {' · from '}
              <button className="file-card-convlink" onClick={() => row.convId && openConversation(row.convId, m.linkedMsgId)}>
                “{row.convName}”
              </button>
            </>
          )}
        </span>
        <span className="file-card-status">
          ✓ {status}
          {m.linkWhy && m.linkMethod !== 'none' && <span className="file-card-why"> {m.linkWhy}</span>}
        </span>
        {!row.convId && (
          <span className="file-card-unlinked">
            Not linked to a chat.{' '}
            {linking ? (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void linkFileToConversation(m.id, e.target.value);
                  setLinking(false);
                }}
                onBlur={() => setLinking(false)}
              >
                <option value="">Pick a chat…</option>
                {convMeta.map((c) => (
                  <option key={c.uuid} value={c.uuid}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <button className="link-btn" onClick={() => setLinking(true)}>
                Link it to a chat…
              </button>
            )}
          </span>
        )}
      </div>
      <div className="file-card-actions">
        <button className="primary-btn file-dl-btn" data-real="1" onClick={() => void downloadOriginal(m.id)}>
          Download
        </button>
        {m.needsReview && (
          <button className="ghost-btn" title="Keep this file in your library" onClick={() => void keepReviewedFile(m.id)}>
            Keep
          </button>
        )}
        <button className="icon-btn" title="Remove this file from Chat Atlas" onClick={() => void removeStoredFile(m.id)}>
          ✕
        </button>
        {row.convId && (
          <button className="icon-btn" title="Open the chat this came from" onClick={() => openConversation(row.convId!, m.linkedMsgId)}>
            <ArrowRightIcon size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

function WantedFileRow({ moment }: { moment: FileMoment }) {
  const { attachOriginal, openConversation } = useStore();
  const attachRef = useRef<HTMLInputElement>(null);
  const name = moment.fileNames[0];
  const ext = extOf(name);

  return (
    <article className="file-card file-card-wanted" data-testid="wanted-card">
      <div className="file-card-icon file-card-icon-ghost" aria-hidden>
        <span className={`file-ext file-ext-ghost`}>{ext === 'Word' ? 'DOC' : ext === 'PDF' ? 'PDF' : 'FILE'}</span>
      </div>
      <div className="file-card-main">
        <span className="file-card-title">{prettyTitle(name ?? moment.convName)}</span>
        {name && <span className="file-card-name">{name}</span>}
        <span className="file-card-sub">
          {formatDateTime(moment.date)} ·{' '}
          <button className="file-card-convlink" onClick={() => openConversation(moment.convId, moment.msgId)}>
            open the chat here
          </button>
        </span>
      </div>
      <div className="file-card-actions">
        <a
          className="secondary-btn file-dl-btn"
          href={`https://claude.ai/chat/${moment.convId}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Opens this chat on claude.ai, where Claude's own Download button is waiting"
        >
          Get it from Claude ↗
        </a>
        <button className="icon-btn" title="Already have this file? Add it and it's kept for good." onClick={() => attachRef.current?.click()}>
          <PaperclipIcon size={15} />
        </button>
        <input
          ref={attachRef}
          type="file"
          hidden
          data-testid="attach-original"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attachOriginal(moment, f);
            e.target.value = '';
          }}
        />
      </div>
    </article>
  );
}

export function FilesPage() {
  const {
    fileMoments,
    storedFiles,
    convMeta,
    watcherStatus,
    chooseFolder,
    resumeWatching,
    rescanFolders,
    addWatchFolder,
    scanFolderOnce,
    addFilesByHand,
    backfillProgress,
    saveFolderStatus,
    chooseSaveFolder,
    resumeSaveFolder,
    turnOffSaveFolder,
    saveAllToFolder,
    supportsWatching,
  } = useStore();
  const [kindFilter, setKindFilter] = useState<'all' | 'Word' | 'PDF'>('all');
  const [text, setText] = useState('');
  const [showReview, setShowReview] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);

  const convName = useMemo(() => new Map(convMeta.map((c) => [c.uuid, c.name])), [convMeta]);

  const savedRows = useMemo<SavedRow[]>(() => {
    const rows = storedFiles
      .filter((f) => !f.needsReview)
      .map<SavedRow>((f) => ({
        kind: 'saved',
        key: `f-${f.id}`,
        meta: f,
        producedAt: f.producedAt ?? f.capturedAt,
        title: f.docTitle?.trim() || prettyTitle(f.name),
        ext: extOf(f.name),
        convId: f.linkedConvId,
        convName: f.linkedConvId ? convName.get(f.linkedConvId) : undefined,
      }));
    rows.sort((a, b) => (a.producedAt < b.producedAt ? 1 : -1));
    return rows;
  }, [storedFiles, convName]);

  const reviewRows = useMemo(() => storedFiles.filter((f) => f.needsReview), [storedFiles]);

  const visibleSaved = useMemo(() => {
    const q = text.trim().toLowerCase();
    return savedRows.filter((r) => {
      if (kindFilter !== 'all' && r.ext !== kindFilter) return false;
      if (!q) return true;
      return `${r.title} ${r.meta.name} ${r.meta.docDescription ?? ''} ${r.convName ?? ''}`.toLowerCase().includes(q);
    });
  }, [savedRows, kindFilter, text]);

  // Files Claude made whose bytes are not on this Mac, grouped by chat so one
  // visit to a conversation collects everything from it at once.
  const wantedByChat = useMemo(() => {
    const haveMoment = new Set(storedFiles.map((f) => f.linkedMomentId).filter(Boolean) as string[]);
    const groups = new Map<string, { convId: string; convName: string; moments: FileMoment[] }>();
    for (const m of fileMoments) {
      if (haveMoment.has(m.id)) continue;
      const g = groups.get(m.convId) ?? { convId: m.convId, convName: m.convName, moments: [] };
      g.moments.push(m);
      groups.set(m.convId, g);
    }
    return [...groups.values()].sort((a, b) => (a.moments[0].date < b.moments[0].date ? 1 : -1));
  }, [fileMoments, storedFiles]);

  const wantedCount = wantedByChat.reduce((n, g) => n + g.moments.length, 0);
  const totalKnown = savedRows.length + wantedCount;

  return (
    <>
      {/* The single most important state on this screen: is anything being saved at all? */}
      {watcherStatus.state === 'needs-permission' && (
        <div className="watch-banner watch-banner-warn" data-testid="watch-banner">
          <div>
            <strong>Chat Atlas has stopped watching {watcherStatus.lapsed.map((f) => f.name).join(', ')}.</strong>
            <p>Nothing new is being saved. One click puts it right.</p>
          </div>
          <div className="watch-banner-actions">
            <button className="primary-btn" onClick={() => void resumeWatching()}>
              Allow watching again
            </button>
            <button className="link-btn" onClick={() => void addWatchFolder()}>
              Pick a different folder
            </button>
          </div>
        </div>
      )}
      {watcherStatus.state === 'off' && supportsWatching && (
        <div className="watch-banner" data-testid="watch-banner">
          <div>
            <strong>Chat Atlas isn’t watching a folder yet.</strong>
            <p>Point it at the folder your Claude downloads land in, and every file you download is saved here automatically.</p>
          </div>
          <div className="watch-banner-actions">
            <button className="primary-btn" onClick={() => void chooseFolder()}>
              Choose that folder
            </button>
          </div>
        </div>
      )}
      {watcherStatus.state === 'unsupported' && (
        <div className="watch-banner" data-testid="watch-banner">
          <div>
            <strong>Automatic saving needs the Chrome browser.</strong>
            <p>Everything else works here — use “Add files I already have” to bring your files in.</p>
          </div>
        </div>
      )}

      <div className="files-toolbar">
        <div className="chip-row chip-row-static">
          <button className={`chip ${kindFilter === 'all' ? 'chip-on' : ''}`} onClick={() => setKindFilter('all')}>
            All · {savedRows.length}
          </button>
          <button className={`chip ${kindFilter === 'Word' ? 'chip-on' : ''}`} onClick={() => setKindFilter('Word')}>
            Word
          </button>
          <button className={`chip ${kindFilter === 'PDF' ? 'chip-on' : ''}`} onClick={() => setKindFilter('PDF')}>
            PDF
          </button>
        </div>
        <input
          type="search"
          className="files-filter"
          placeholder="Find a file by name…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Find a file"
        />
      </div>

      <div className="files-actions">
        <button className="ghost-btn" onClick={() => pickRef.current?.click()}>
          Add files I already have
        </button>
        <input
          ref={pickRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.doc,.docx"
          data-testid="pick-files"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void addFilesByHand(files, { source: 'picked' });
            e.target.value = '';
          }}
        />
        {supportsWatching && (
          <>
            <button className="ghost-btn" onClick={() => void scanFolderOnce()}>
              Scan a folder once
            </button>
            <button className="ghost-btn" onClick={() => void addWatchFolder()}>
              Watch another folder
            </button>
            <button className="ghost-btn" onClick={() => void rescanFolders()}>
              Rescan folders now
            </button>
          </>
        )}
        {watcherStatus.state === 'watching' && (
          <span className="files-watching-note">
            Watching {watcherStatus.folders.map((f) => f.name).join(', ')} — new downloads save themselves.
          </span>
        )}
      </div>

      {backfillProgress && (
        <p className="files-hint">
          Reading file details… {backfillProgress.done} of {backfillProgress.total}
        </p>
      )}

      {visibleSaved.length === 0 && savedRows.length === 0 ? (
        <div className="view-empty">
          <p>
            <strong>No files saved yet.</strong> When Claude makes you a PDF or Word document, download it as you normally would — if
            Chat Atlas is watching that folder, the exact file lands here by itself, ready to download again forever.
          </p>
        </div>
      ) : (
        visibleSaved.map((r) => <SavedFileRow key={r.key} row={r} />)
      )}

      {wantedByChat.length > 0 && (
        <>
          <h2 className="lib-section-head" data-testid="wanted-head">
            Claude made these — not on this Mac yet ({wantedCount})
          </h2>
          <p className="files-hint">
            {savedRows.length} of {totalKnown} files saved. Open a chat below and download from there — Claude's own “Download all” gets
            every file from that chat at once, and they appear here by themselves.
          </p>
          {wantedByChat.map((g) => (
            <section key={g.convId} className="wanted-group">
              <header className="wanted-group-head">
                <span className="wanted-group-name">{g.convName}</span>
                <a
                  className="ghost-btn"
                  href={`https://claude.ai/chat/${g.convId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Opens this chat on claude.ai"
                >
                  Open this chat ↗ ({g.moments.length})
                </a>
              </header>
              {g.moments.map((m) => (
                <WantedFileRow key={m.id} moment={m} />
              ))}
            </section>
          ))}
        </>
      )}

      {reviewRows.length > 0 && (
        <>
          <h2 className="lib-section-head">
            <button className="link-btn" onClick={() => setShowReview((s) => !s)}>
              Files Chat Atlas isn’t sure about ({reviewRows.length}) {showReview ? '▾' : '▸'}
            </button>
          </h2>
          {showReview && (
            <>
              <p className="files-hint">
                These were saved by an older version and don’t look like Claude’s work. Nothing is deleted automatically — keep or remove
                them yourself.
              </p>
              {reviewRows.map((f) => (
                <SavedFileRow
                  key={`r-${f.id}`}
                  row={{
                    kind: 'saved',
                    key: `r-${f.id}`,
                    meta: f,
                    producedAt: f.producedAt ?? f.capturedAt,
                    title: f.docTitle?.trim() || prettyTitle(f.name),
                    ext: extOf(f.name),
                    convId: f.linkedConvId,
                    convName: f.linkedConvId ? convName.get(f.linkedConvId) : undefined,
                  }}
                />
              ))}
            </>
          )}
        </>
      )}

      <div className="savefolder-bar">
        <FolderIcon size={15} />
        {saveFolderStatus.state === 'on' ? (
          <>
            <span>
              Copies of these files also go into <strong>{saveFolderStatus.folderName}</strong>.
            </span>
            <button className="ghost-btn" onClick={() => void saveAllToFolder()}>
              Copy all there now
            </button>
            <button className="link-btn" onClick={() => void turnOffSaveFolder()}>
              Turn off
            </button>
          </>
        ) : saveFolderStatus.state === 'needs-permission' ? (
          <>
            <span>
              Your folder <strong>{saveFolderStatus.folderName}</strong> needs one click to allow again.
            </span>
            <button className="ghost-btn" onClick={() => void resumeSaveFolder()}>
              Allow
            </button>
          </>
        ) : supportsWatching ? (
          <>
            <span>Want a folder on your Mac that always holds copies of these files?</span>
            <button className="ghost-btn" data-testid="pick-save-folder" onClick={() => void chooseSaveFolder()}>
              Choose a folder
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}
