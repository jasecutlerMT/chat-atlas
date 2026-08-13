// The header: logo, tabs, scope (project / workspace) selector, folder-watch
// status, skipped-items link and the theme toggle.

import { useRef } from 'react';
import { useStore } from '../state/store';
import { AtlasLogo, FolderIcon, MoonIcon, SunIcon } from './Icons';

export type Tab = 'library' | 'map' | 'timeline';

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'map', label: 'Map' },
  { id: 'timeline', label: 'Timeline' },
];

export function TopBar({
  tab,
  setTab,
  onManageWorkspaces,
  onShowSkipped,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  onManageWorkspaces: () => void;
  onShowSkipped: () => void;
}) {
  const {
    theme,
    toggleTheme,
    projects,
    workspaces,
    scope,
    setScope,
    skipped,
    watcherStatus,
    chooseFolder,
    resumeWatching,
    importFiles,
    convMeta,
    updateInfo,
    updating,
    checkForUpdates,
    runUpdate,
  } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const updateReady = updateInfo && updateInfo.remote !== null && updateInfo.remote > updateInfo.local;

  const scopeValue = scope.kind === 'all' ? 'all' : scope.kind === 'project' ? `proj:${scope.uuid}` : `ws:${scope.id}`;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="logo"
          title={`Chat Atlas v${updateInfo?.local ?? '…'} — click to check for updates`}
          onClick={() => void checkForUpdates(true)}
        >
          <AtlasLogo />
          <span className="logo-text">Chat Atlas</span>
          {updateInfo && <span className="version-tag">v{updateInfo.local}</span>}
        </button>
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'tab-on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="topbar-right">
        {updateReady && (
          <button className="update-chip" data-testid="update-btn" disabled={updating} onClick={() => void runUpdate()}>
            {updating ? 'Updating…' : `Update to v${updateInfo!.remote}`}
          </button>
        )}
        {convMeta.length > 0 && (
          <select
            className="scope-select"
            value={scopeValue}
            aria-label="Narrow the app to a project or workspace"
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') setScope({ kind: 'all' });
              else if (v === '__manage') {
                onManageWorkspaces();
              } else if (v.startsWith('proj:')) {
                const p = projects.find((x) => x.uuid === v.slice(5));
                if (p) setScope({ kind: 'project', uuid: p.uuid, name: p.name });
              } else if (v.startsWith('ws:')) {
                const w = workspaces.find((x) => x.id === v.slice(3));
                if (w) setScope({ kind: 'workspace', id: w.id, name: w.name });
              }
            }}
          >
            <option value="all">All conversations</option>
            {projects.length > 0 && (
              <optgroup label="Projects (from your export)">
                {projects.map((p) => (
                  <option key={p.uuid} value={`proj:${p.uuid}`}>
                    {p.name} ({p.count})
                  </option>
                ))}
              </optgroup>
            )}
            {workspaces.length > 0 && (
              <optgroup label="Workspaces (made by you)">
                {workspaces.map((w) => (
                  <option key={w.id} value={`ws:${w.id}`}>
                    {w.name} ({w.convIds.length})
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__manage">＋ New or edit workspace…</option>
          </select>
        )}

        {watcherStatus.state === 'watching' && (
          <span
            className="watch-chip watch-on"
            title={`Checking ${watcherStatus.folders.map((f) => `“${f.name}”`).join(', ')} every 30 seconds`}
          >
            <span className="watch-dot" />{' '}
            {watcherStatus.folders.length === 1
              ? `Watching ${watcherStatus.folders[0].name}`
              : `Watching ${watcherStatus.folders.length} folders`}
          </span>
        )}
        {watcherStatus.state === 'needs-permission' && (
          <button className="watch-chip watch-resume" onClick={() => void resumeWatching()} title="One click and auto-updating resumes">
            <FolderIcon size={13} /> Allow watching again
          </button>
        )}
        {watcherStatus.state === 'off' && convMeta.length > 0 && (
          <button className="watch-chip" onClick={() => void chooseFolder()} title="Pick your Downloads folder so new exports import themselves">
            <FolderIcon size={13} /> Watch a folder
          </button>
        )}
        {watcherStatus.state === 'unsupported' && convMeta.length > 0 && (
          <span className="watch-chip watch-muted" title="Automatic updating needs the Chrome browser. Drag-and-drop still works here.">
            Auto-update needs Chrome
          </span>
        )}

        {convMeta.length > 0 && (
          <>
            <button className="ghost-btn topbar-import" onClick={() => fileRef.current?.click()} title="Import an export zip by hand">
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              multiple
              hidden
              data-testid="topbar-file-input"
              onChange={(e) => {
                if (e.target.files?.length) void importFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )}

        {skipped.length > 0 && (
          <button className="skipped-link" onClick={onShowSkipped}>
            {skipped.length} item{skipped.length === 1 ? '' : 's'} skipped
          </button>
        )}

        <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
      </div>
    </header>
  );
}
