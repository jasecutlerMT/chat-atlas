// The Documents shelf: every "make me a file" moment in the history, each
// with its kept original (when we have it) and one-click rebuilds. Also home
// to the auto-save folder controls.

import { useMemo, useRef, useState } from 'react';
import type { FileMoment } from '../../types';
import { useStore } from '../../state/store';
import { formatDate } from '../../lib/text';
import { exportMoment } from './exporters';
import { ArrowRightIcon, DownloadIcon, FolderIcon, PaperclipIcon } from '../Icons';

function MomentRow({ moment }: { moment: FileMoment }) {
  const { originalsByMoment, downloadOriginal, attachOriginal, openConversation } = useStore();
  const original = originalsByMoment.get(moment.id);
  const attachRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className="lib-row doc-row" data-testid="doc-row">
      <button className="lib-row-main" onClick={() => openConversation(moment.convId, moment.msgId)}>
        <div className="lib-row-top">
          {moment.asked && <span className="badge badge-askedfile">Asked as file</span>}
          {original ? (
            <span className="badge badge-originalkept">Original kept ✓</span>
          ) : (
            <span className="badge badge-rebuild">Rebuild available</span>
          )}
          <span className="lib-row-title">
            {moment.fileNames[0] ?? `A document from “${moment.convName}”`}
          </span>
        </div>
        <div className="lib-row-meta">
          {moment.fileNames.slice(1).map((f) => (
            <span key={f} className="doc-extra-file">{f}</span>
          ))}
          <span>{formatDate(moment.date)}</span>
          <span className="lib-row-conv">from “{moment.convName}”</span>
          {original && <span>original {original.source === 'watched' ? 'caught from your Downloads' : 'attached by you'}</span>}
        </div>
      </button>
      <div className="lib-row-actions">
        {original && (
          <button
            className="ghost-btn doc-original-btn"
            title="Download the exact original file"
            onClick={() => void downloadOriginal(original.id)}
          >
            <DownloadIcon size={14} />
            Original
          </button>
        )}
        <div className="popover-wrap">
          <button className="icon-btn" title="Rebuild as Word, PDF or markdown" onClick={() => setMenuOpen((o) => !o)}>
            <DownloadIcon size={15} />
          </button>
          {menuOpen && (
            <div className="popover" onMouseLeave={() => setMenuOpen(false)}>
              <p className="popover-title">Rebuild as…</p>
              <button className="popover-item" onClick={() => { setMenuOpen(false); void exportMoment(moment, 'docx'); }}>
                Word document (.docx)
              </button>
              <button className="popover-item" onClick={() => { setMenuOpen(false); void exportMoment(moment, 'pdf'); }}>
                PDF (via print)
              </button>
              <button className="popover-item" onClick={() => { setMenuOpen(false); void exportMoment(moment, 'md'); }}>
                Markdown (.md)
              </button>
            </div>
          )}
        </div>
        {!original && (
          <>
            <button
              className="icon-btn"
              title="Still have the original file somewhere? Attach it and it's kept forever."
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
                if (f) void attachOriginal(moment, f);
                e.target.value = '';
              }}
            />
          </>
        )}
        <button className="icon-btn" title="Open the conversation" onClick={() => openConversation(moment.convId, moment.msgId)}>
          <ArrowRightIcon size={15} />
        </button>
      </div>
    </article>
  );
}

export function DocumentsPage() {
  const { fileMoments, scopedConvs, saveFolderStatus, chooseSaveFolder, resumeSaveFolder, turnOffSaveFolder, saveAllToFolder, supportsWatching } =
    useStore();
  const [onlyAsked, setOnlyAsked] = useState(false);

  const scopedIds = useMemo(() => new Set(scopedConvs.map((c) => c.uuid)), [scopedConvs]);
  const visible = useMemo(
    () => fileMoments.filter((m) => scopedIds.has(m.convId) && (!onlyAsked || m.asked)),
    [fileMoments, scopedIds, onlyAsked],
  );

  return (
    <>
      <div className="savefolder-bar">
        <FolderIcon size={15} />
        {saveFolderStatus.state === 'on' ? (
          <>
            <span>
              New documents auto-save to <strong>{saveFolderStatus.folderName}</strong> as real files.
            </span>
            <button className="ghost-btn" onClick={() => void saveAllToFolder()} title="Write every document here into that folder now">
              Save all now
            </button>
            <button className="link-btn" onClick={() => void turnOffSaveFolder()}>
              Turn off
            </button>
          </>
        ) : saveFolderStatus.state === 'needs-permission' ? (
          <>
            <span>
              Your save folder <strong>{saveFolderStatus.folderName}</strong> needs one click to allow again.
            </span>
            <button className="ghost-btn" onClick={() => void resumeSaveFolder()}>
              Allow
            </button>
          </>
        ) : supportsWatching ? (
          <>
            <span>Want every document saved as a real file automatically? Pick a folder for them once.</span>
            <button className="ghost-btn" data-testid="pick-save-folder" onClick={() => void chooseSaveFolder()}>
              Choose a folder
            </button>
          </>
        ) : (
          <span>Auto-saving to a folder needs the Chrome browser; downloads from each row still work here.</span>
        )}
      </div>

      <div className="chip-row chip-row-static">
        <button className={`chip ${!onlyAsked ? 'chip-on' : ''}`} onClick={() => setOnlyAsked(false)}>
          All documents · {fileMoments.filter((m) => scopedIds.has(m.convId)).length}
        </button>
        <button className={`chip ${onlyAsked ? 'chip-on' : ''}`} onClick={() => setOnlyAsked(true)}>
          I asked for a file · {fileMoments.filter((m) => scopedIds.has(m.convId) && m.asked).length}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="view-empty">
          <p>
            No file-moments found yet. Whenever a chat mentions a PDF or Word file Claude made — or you ask for one from now on — it
            shows up here, and the real file gets caught from your Downloads automatically.
          </p>
        </div>
      ) : (
        visible.map((m) => <MomentRow key={m.id} moment={m} />)
      )}
    </>
  );
}
