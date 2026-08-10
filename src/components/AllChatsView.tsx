// A plain, fast list of every conversation in the current scope.

import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';

type SortKey = 'recent' | 'oldest' | 'messages' | 'name';

export function AllChatsView() {
  const { scopedConvs, openConversation } = useStore();
  const [sort, setSort] = useState<SortKey>('recent');
  const [filter, setFilter] = useState('');

  const list = useMemo(() => {
    let l = [...scopedConvs];
    if (filter.trim()) {
      const f = filter.toLowerCase();
      l = l.filter((c) => c.name.toLowerCase().includes(f) || c.keywords.some((k) => k.includes(f)));
    }
    switch (sort) {
      case 'recent':
        l.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
        break;
      case 'oldest':
        l.sort((a, b) => (a.updated_at > b.updated_at ? 1 : -1));
        break;
      case 'messages':
        l.sort((a, b) => b.messageCount - a.messageCount);
        break;
      case 'name':
        l.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return l;
  }, [scopedConvs, sort, filter]);

  return (
    <div className="view-scroll">
      <div className="view-inner">
        <header className="view-head">
          <h1>All chats</h1>
          <p className="view-sub">
            {scopedConvs.length} conversation{scopedConvs.length === 1 ? '' : 's'} in view.
          </p>
        </header>
        <div className="list-tools">
          <input
            type="search"
            className="list-filter"
            placeholder="Narrow this list by title or keyword…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter conversations"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort conversations">
            <option value="recent">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="messages">Most messages</option>
            <option value="name">A to Z</option>
          </select>
        </div>
        {list.length === 0 ? (
          <div className="view-empty">
            <p>No conversations match. Try a different word, or clear the box above.</p>
          </div>
        ) : (
          <div className="chat-list">
            {list.map((c) => (
              <button key={c.uuid} className="chat-row" onClick={() => openConversation(c.uuid)}>
                <div className="chat-row-main">
                  <span className="chat-row-name">{c.name}</span>
                  <span className="chat-row-first">{c.firstLine}</span>
                </div>
                <div className="chat-row-side">
                  {c.projectName && <span className="proj-badge">{c.projectName}</span>}
                  <span className="chat-row-meta">
                    {c.messageCount} msg{c.messageCount === 1 ? '' : 's'} · {formatDate(c.updated_at)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
