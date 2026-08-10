import { useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import { TopBar, type Tab } from './components/TopBar';
import { SearchBar } from './components/SearchBar';
import { MapView } from './components/MapView';
import { TimelineView } from './components/TimelineView';
import { OutputsView } from './components/OutputsView';
import { AllChatsView } from './components/AllChatsView';
import { ReadingPane } from './components/ReadingPane';
import { SetupPanel } from './components/SetupPanel';
import { WorkspaceModal } from './components/WorkspaceModal';
import { DropCatcher, ProgressCard, SkippedModal, StaleBanner, Toasts } from './components/Overlays';

function Shell() {
  const { convMeta, loading } = useStore();
  const [tab, setTab] = useState<Tab>('map');
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
        {tab === 'map' && <MapView />}
        {tab === 'timeline' && <TimelineView />}
        {tab === 'outputs' && <OutputsView />}
        {tab === 'chats' && <AllChatsView />}
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
