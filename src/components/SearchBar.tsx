// The floating search bar: instant typo-tolerant search with filters, result
// snippets, and keyword chips that scope both the map and the search.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';
import { normalizeFileKey } from '../lib/fileMoments';
import { exportMoment } from './library/exporters';
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
    fileMoments,
    storedFiles,
    originalsByMoment,
    downloadOriginal,
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
      .slice(0, 8)
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

  // Files whose name or conversation matches the query jump to the top —
  // "find that file again" is the most common reason to search.
  const fileHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const qKey = normalizeFileKey(q);
    const words = q.split(/\s+/).filter(Boolean);
    const matches = (hay: string) =>
      words.every((w) => hay.includes(w)) || (qKey.length >= 3 && normalizeFileKey(hay).includes(qKey));
    const out: { key: string; label: string; sub: string; download: () => void }[] = [];
    for (const m of fileMoments) {
      const hay = `${m.fileNames.join(' ')} ${m.convName}`.toLowerCase();
      if (!matches(hay)) continue;
      const original = originalsByMoment.get(m.id);
      out.push({
        key: m.id,
        label: (original?.name ?? m.fileNames[0] ?? m.convName).replace(/\.[a-z0-9]+$/i, ''),
        sub: original ? 'exact saved file' : 'made fresh as Word',
        download: () => {
          if (original) void downloadOriginal(original.id);
          else void exportMoment(m, 'docx');
        },
      });
      if (out.length >= 3) return out;
    }
    for (const f of storedFiles) {
      if (f.linkedMomentId) continue;
      if (!matches(f.name.toLowerCase())) continue;
      out.push({
        key: f.id,
        label: f.name,
        sub: 'exact saved file',
        download: () => void downloadOriginal(f.id),
      });
      if (out.length >= 3) break;
    }
    return out;
  }, [query, fileMoments, storedFiles, originalsByMoment, downloadOriginal]);

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
          {fileHits.length > 0 && (
            <div className="result-files">
              {fileHits.map((f) => (
                <div key={f.key} className="result-file" data-testid="search-file-hit">
                  <span className="result-file-label">
                    📄 {f.label} <span className="result-file-sub">{f.sub}</span>
                  </span>
                  <button className="primary-btn result-file-dl" onClick={f.download}>
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
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
