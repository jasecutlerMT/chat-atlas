// The Files view: every file Claude made, presented like the download cards
// in Claude's own chat — a name, a file type, and a Download button. When we
// hold the exact file you downloaded, that's what you get; otherwise the
// Download button makes a fresh Word file from the conversation's content.

import { useMemo, useRef, useState } from 'react';
import type { FileMoment, StoredFileMeta } from '../../types';
import { useStore } from '../../state/store';
import { formatDate } from '../../lib/text';
import { exportMoment } from './exporters';
import { ArrowRightIcon, FolderIcon, PaperclipIcon } from '../Icons';

type FileKind = 'PDF' | 'Word' | 'Excel' | 'PowerPoint' | 'File';

function kindOf(name: string | undefined): FileKind {
  if (!name) return 'Word';
  if (/\.pdf$/i.test(name)) return 'PDF';
  if (/\.docx?$/i.test(name)) return 'Word';
  if (/\.(xlsx?|csv)$/i.test(name)) return 'Excel';
  if (/\.pptx?$/i.test(name)) return 'PowerPoint';
  return 'File';
}

function prettyTitle(raw: string): string {
  const base = raw.replace(/\.[a-z0-9]+$/i, '');
  // "SydneyTechTargetList100" -> "Sydney Tech Target List 100"
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

interface FileRow {
  key: string;
  title: string;
  kind: FileKind;
  date: string;
  convId?: string;
  convName?: string;
  moment?: FileMoment;
  original?: StoredFileMeta;
}

function Row({ row }: { row: FileRow }) {
  const { downloadOriginal, attachOriginal, removeStoredFile, openConversation } = useStore();
  const attachRef = useRef<HTMLInputElement>(null);

  return (
    <article className="file-card" data-testid="file-card">
      <div className="file-card-icon" aria-hidden>
        <span className={`file-ext file-ext-${row.kind.toLowerCase()}`}>{row.kind === 'Word' ? 'DOC' : row.kind === 'PDF' ? 'PDF' : row.kind.slice(0, 3).toUpperCase()}</span>
      </div>
      <div className="file-card-main">
        <span className="file-card-title">{row.title}</span>
        <span className="file-card-sub">
          {row.kind} file · {formatDate(row.date)}
          {row.convName && (
            <>
              {' · from '}
              <button className="file-card-convlink" onClick={() => row.convId && openConversation(row.convId, row.moment?.msgId)}>
                “{row.convName}”
              </button>
            </>
          )}
        </span>
        <span className="file-card-status">
          {row.original
            ? '✓ This is the exact file you downloaded from Claude — saved here for good.'
            : 'The file itself wasn’t saved, so Download makes a fresh copy from the conversation.'}
        </span>
      </div>
      <div className="file-card-actions">
        {row.original ? (
          <>
            <button className="primary-btn file-dl-btn" onClick={() => void downloadOriginal(row.original!.id)}>
              Download
            </button>
            <button
              className="icon-btn"
              title="Remove this saved file from Chat Atlas"
              onClick={() => void removeStoredFile(row.original!.id)}
            >
              ✕
            </button>
          </>
        ) : row.moment ? (
          <>
            <button className="primary-btn file-dl-btn" onClick={() => void exportMoment(row.moment!, 'docx')} title="Makes a Word file from the conversation's content">
              Download
            </button>
            <button className="ghost-btn" onClick={() => void exportMoment(row.moment!, 'pdf')} title="Makes a PDF via Chrome's print dialog">
              PDF
            </button>
            <button
              className="icon-btn"
              title="Still have the real file somewhere? Add it here and it's kept for good."
              onClick={() => attachRef.current?.click()}
            >
              <PaperclipIcon size={15} />
            </button>
            <input
              ref={attachRef}
              type="file"
              hidden
              data-testid="attach-original"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && row.moment) void attachOriginal(row.moment, f);
                e.target.value = '';
              }}
            />
          </>
        ) : null}
        {row.convId && (
          <button className="icon-btn" title="Open the conversation this came from" onClick={() => openConversation(row.convId!, row.moment?.msgId)}>
            <ArrowRightIcon size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

export function FilesPage() {
  const {
    fileMoments,
    storedFiles,
    originalsByMoment,
    scopedConvs,
    convMeta,
    watcherStatus,
    chooseFolder,
    saveFolderStatus,
    chooseSaveFolder,
    resumeSaveFolder,
    turnOffSaveFolder,
    saveAllToFolder,
    supportsWatching,
    setLibrarySel,
  } = useStore();
  const [filter, setFilter] = useState<'all' | 'PDF' | 'Word' | 'other'>('all');

  const rows = useMemo<FileRow[]>(() => {
    const convName = new Map(convMeta.map((c) => [c.uuid, c.name]));
    const scoped = new Set(scopedConvs.map((c) => c.uuid));
    const usedFiles = new Set<string>();
    const out: FileRow[] = [];

    for (const m of fileMoments) {
      if (!scoped.has(m.convId)) continue;
      const original = originalsByMoment.get(m.id);
      if (original) usedFiles.add(original.id);
      const displayName = original?.name ?? m.fileNames[0];
      out.push({
        key: `m-${m.id}`,
        title: prettyTitle(displayName ?? m.convName),
        kind: kindOf(displayName),
        date: m.date,
        convId: m.convId,
        convName: m.convName,
        moment: m,
        original,
      });
    }
    // Files kept from the folder that didn't match a specific moment.
    for (const f of storedFiles) {
      if (usedFiles.has(f.id)) continue;
      out.push({
        key: `f-${f.id}`,
        title: prettyTitle(f.name),
        kind: kindOf(f.name),
        date: f.capturedAt,
        convId: f.linkedConvId,
        convName: f.linkedConvId ? convName.get(f.linkedConvId) : undefined,
        original: f,
      });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (filter === 'all') return out;
    if (filter === 'other') return out.filter((r) => r.kind !== 'PDF' && r.kind !== 'Word');
    return out.filter((r) => r.kind === filter);
  }, [fileMoments, storedFiles, originalsByMoment, scopedConvs, convMeta, filter]);

  const savedCount = rows.filter((r) => r.original).length;

  return (
    <>
      {watcherStatus.state === 'watching' ? (
        <p className="files-hint">
          Chat Atlas is watching <strong>{watcherStatus.folderName}</strong>. Any PDF or Word file you download from Claude into that
          folder is saved here automatically, for good.
        </p>
      ) : supportsWatching ? (
        <p className="files-hint">
          <button className="link-btn" onClick={() => void chooseFolder()}>
            Choose the folder your Claude downloads land in
          </button>{' '}
          and every file you download gets saved here automatically.
        </p>
      ) : null}

      <div className="chip-row chip-row-static">
        <button className={`chip ${filter === 'all' ? 'chip-on' : ''}`} onClick={() => setFilter('all')}>
          All · {rows.length}
        </button>
        <button className={`chip ${filter === 'PDF' ? 'chip-on' : ''}`} onClick={() => setFilter('PDF')}>
          PDF
        </button>
        <button className={`chip ${filter === 'Word' ? 'chip-on' : ''}`} onClick={() => setFilter('Word')}>
          Word
        </button>
        <button className={`chip ${filter === 'other' ? 'chip-on' : ''}`} onClick={() => setFilter('other')}>
          Other
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="view-empty">
          <p>
            <strong>No files here yet.</strong> When Claude makes you a PDF or Word document, download it as usual — if Chat Atlas is
            watching your download folder, the file lands here by itself, ready to find and re-download forever. Everything else Claude
            wrote lives in your{' '}
            <button className="link-btn" onClick={() => setLibrarySel({ kind: 'home' })}>
              library
            </button>
            .
          </p>
        </div>
      ) : (
        rows.map((r) => <Row key={r.key} row={r} />)
      )}

      <div className="savefolder-bar">
        <FolderIcon size={15} />
        {saveFolderStatus.state === 'on' ? (
          <>
            <span>
              Copies of everything here also go into <strong>{saveFolderStatus.folderName}</strong> on your Mac.
            </span>
            <button className="ghost-btn" onClick={() => void saveAllToFolder()} title="Write every file listed here into that folder now">
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
        ) : (
          <span>{savedCount} of these are exact saved files; the rest are made fresh when you download them.</span>
        )}
      </div>
    </>
  );
}
