import { useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import { TopBar, type Tab } from './components/TopBar';
import { SearchBar } from './components/SearchBar';
import { LibraryView } from './components/library/LibraryView';
import { MapView } from './components/MapView';
import { TimelineView } from './components/TimelineView';
import { ReadingPane } from './components/ReadingPane';
import { SetupPanel } from './components/SetupPanel';
import { WorkspaceModal } from './components/WorkspaceModal';
import { DropCatcher, ProgressCard, SkippedModal, StaleBanner, Toasts } from './components/Overlays';

function Shell() {
  const { convMeta, loading } = useStore();
  const [tab, setTab] = useState<Tab>('library');
  const [showWorkspaces, setShowWorkspaces] = useState<string | null | false>(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const empty = !loading && convMeta.length === 0;

  return (
    <div className="app">
      <TopBar
        tab={tab}
        setTab={setTab}
        onManageWorkspaces={() => setShowWorkspaces(null)}
        onShowSkipped={() => setShowSkipped(true)}
      />
      <StaleBanner />
      <main className="main">
        {tab === 'library' && <LibraryView />}
        {tab === 'map' && <MapView />}
        {tab === 'timeline' && <TimelineView />}
        {!empty && <SearchBar />}
      </main>

      {empty && <SetupPanel />}
      {showWorkspaces !== false && <WorkspaceModal editId={showWorkspaces} onClose={() => setShowWorkspaces(false)} />}
      {showSkipped && <SkippedModal onClose={() => setShowSkipped(false)} />}
      <ReadingPane />
      <Toasts />
      <ProgressCard />
      <DropCatcher />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
