// The floating search bar: instant typo-tolerant search with filters, result
// snippets, and keyword chips that scope both the map and the search.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';
import { CloseIcon, PaperclipIcon, SearchIcon } from './Icons';

export function SearchBar() {
  const {
    query,
    setQuery,
    filters,
    setFilters,
    hits,
    totalHits,
    openConversation,
    scopedConvs,
    keywordChip,
    setKeywordChip,
    convMeta,
  } = useStore();
  const [showFilters, setShowFilters] = useState(false);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = useMemo(
    () =>
      [filters.from, filters.to, filters.sender, filters.convId, filters.hasCode, filters.hasTable, filters.isLong, filters.hasAttachment].filter(
        Boolean,
      ).length,
    [filters],
  );

  // Keyword chips: the most distinctive words across the current scope.
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of scopedConvs) {
      c.keywords.forEach((k, i) => counts.set(k, (counts.get(k) ?? 0) + (5 - i)));
    }
    if (keywordChip && !counts.has(keywordChip)) counts.set(keywordChip, 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);
  }, [scopedConvs, keywordChip]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const showResults = focused && query.trim().length > 0;

  return (
    <div className="search-wrap" ref={boxRef}>
      <div className={`search-bar ${showResults ? 'search-bar-open' : ''}`}>
        <SearchIcon size={17} />
        <input
          type="search"
          placeholder="Search everything you and Claude have ever said…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          aria-label="Search your conversations"
        />
        {query && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
            <CloseIcon size={15} />
          </button>
        )}
        <button
          className={`filter-toggle ${showFilters || activeFilterCount ? 'filter-toggle-on' : ''}`}
          onClick={() => setShowFilters((s) => !s)}
        >
          Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
        </button>
      </div>

      {chips.length > 1 && (
        <div className="chip-row">
          {chips.map((k) => (
            <button
              key={k}
              className={`chip ${keywordChip === k ? 'chip-on' : ''}`}
              onClick={() => setKeywordChip(keywordChip === k ? null : k)}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {showFilters && (
        <div className="filter-panel">
          <label>
            From
            <input type="date" value={filters.from ?? ''} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} />
          </label>
          <label>
            To
            <input type="date" value={filters.to ?? ''} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} />
          </label>
          <label>
            Who said it
            <select
              value={filters.sender ?? ''}
              onChange={(e) => setFilters({ ...filters, sender: (e.target.value || undefined) as 'human' | 'assistant' | undefined })}
            >
              <option value="">Anyone</option>
              <option value="human">Me</option>
              <option value="assistant">Claude</option>
            </select>
          </label>
          <label>
            Conversation
            <select value={filters.convId ?? ''} onChange={(e) => setFilters({ ...filters, convId: e.target.value || undefined })}>
              <option value="">Any conversation</option>
              {convMeta.map((c) => (
                <option key={c.uuid} value={c.uuid}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-flags">
            {(
              [
                ['hasCode', 'Has code'],
                ['hasTable', 'Has a table'],
                ['isLong', 'Long-form'],
                ['hasAttachment', 'Has attachment'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flag">
                <input
                  type="checkbox"
                  checked={!!filters[key]}
                  onChange={(e) => setFilters({ ...filters, [key]: e.target.checked || undefined })}
                />
                {label}
              </label>
            ))}
          </div>
          {activeFilterCount > 0 && (
            <button className="ghost-btn" onClick={() => setFilters({})}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {showResults && (
        <div className="results-panel" role="listbox" aria-label="Search results">
          {hits.length === 0 ? (
            <div className="results-empty">
              <p>No matches yet. Typos are okay — but try a shorter or different word, or loosen the filters.</p>
            </div>
          ) : (
            <>
              <p className="results-count">
                {totalHits} matching message{totalHits === 1 ? '' : 's'}
              </p>
              {hits.map((h) => (
                <button
                  key={`${h.convId}/${h.msgId}`}
                  className="result"
                  onClick={() => {
                    openConversation(h.convId, h.msgId);
                    setFocused(false);
                  }}
                >
                  <div className="result-top">
                    <span className="result-conv">{h.convName}</span>
                    <span className="result-meta">
                      {h.sender === 'human' ? 'You' : 'Claude'} · {formatDate(h.date)}
                      {h.fromAttachment && (
                        <span className="result-attachment">
                          <PaperclipIcon size={11} /> in attachment
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="result-snippet">
                    {h.snippet.map((p, i) => (p.hl ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                  </p>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
