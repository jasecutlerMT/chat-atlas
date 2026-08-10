// First-run welcome: explains the two ways to get data in, in plain English.

import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { FolderIcon, SearchIcon } from './Icons';

export function SetupPanel() {
  const { importFiles, chooseFolder, supportsWatching } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showHow, setShowHow] = useState(false);

  return (
    <div className="setup-backdrop">
      <div className="setup-card">
        <div className="setup-logo">
          <SearchIcon size={26} />
        </div>
        <h1>Welcome to Chat Atlas</h1>
        <p className="setup-lead">
          A private map of everything you and Claude have ever talked about. It all stays on this computer — nothing is uploaded, ever.
        </p>

        {supportsWatching ? (
          <>
            <button className="primary-btn" onClick={() => void chooseFolder()}>
              <FolderIcon size={17} />
              Point me at your Downloads folder
            </button>
            <p className="setup-why">
              Why: when you export your data from claude.ai, the zip lands in Downloads — Chat Atlas will spot it there and update itself
              automatically, no clicks needed.
            </p>
          </>
        ) : (
          <div className="setup-note">
            <p>
              <strong>Heads up:</strong> automatic updating needs the Chrome browser. In this browser you can still do everything else —
              just drag your export zip in whenever you download a new one.
            </p>
          </div>
        )}

        <div className="setup-divider">
          <span>or</span>
        </div>

        <button className="secondary-btn" onClick={() => fileRef.current?.click()}>
          Choose an export zip to import
        </button>
        <p className="setup-drop-hint">…or just drag the zip anywhere onto this window.</p>
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            if (e.target.files?.length) void importFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <button className="link-btn" onClick={() => setShowHow((s) => !s)}>
          How do I get my export from claude.ai?
        </button>
        {showHow && (
          <ol className="setup-steps">
            <li>Open claude.ai and click your initials, bottom-left.</li>
            <li>Go to <strong>Settings</strong>, then <strong>Privacy</strong>.</li>
            <li>Click <strong>Export data</strong>. Claude emails you a download link.</li>
            <li>Open the email and download the zip — that's it. If you picked your Downloads folder above, Chat Atlas takes it from there.</li>
          </ol>
        )}
      </div>
    </div>
  );
}
