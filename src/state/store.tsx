// Central app state. Owns the worker, the folder watcher, scope (project /
// workspace), search state, toasts and the reading pane. Components read from
// this context; heavy work never happens on this thread.

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ConvMeta,
  FromWorker,
  GraphEdge,
  ImportSummary,
  OutputCard,
  SearchFilters,
  SearchHit,
  SkippedItem,
  Workspace,
} from '../types';
import { getDerived, getMeta, getSkipped, getWorkspaces, setMeta, setWorkspaces as dbSetWorkspaces } from '../db/db';
import { FolderWatcher, browserSupportsWatching, type WatcherStatus } from '../adapters/folderWatch';

export type Scope = { kind: 'all' } | { kind: 'project'; uuid: string; name: string } | { kind: 'workspace'; id: string; name: string };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface ReadingTarget {
  convId: string;
  msgId?: string;
}

interface StoreValue {
  loading: boolean;
  convMeta: ConvMeta[];
  scopedConvs: ConvMeta[];
  edges: GraphEdge[];
  outputs: OutputCard[];
  skipped: SkippedItem[];
  workspaces: Workspace[];
  projects: { uuid: string; name: string; count: number }[];
  scope: Scope;
  setScope: (s: Scope) => void;
  saveWorkspace: (name: string, convIds: string[], id?: string) => Promise<string>;
  deleteWorkspace: (id: string) => Promise<void>;

  theme: 'dark' | 'light';
  toggleTheme: () => void;

  query: string;
  setQuery: (q: string) => void;
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  hits: SearchHit[];
  totalHits: number;
  matchedConvIds: Set<string>;
  keywordChip: string | null;
  setKeywordChip: (k: string | null) => void;

  reading: ReadingTarget | null;
  openConversation: (convId: string, msgId?: string) => void;
  closeReading: () => void;

  importFiles: (files: FileList | File[]) => Promise<void>;
  progress: { label: string; pct: number } | null;
  toasts: Toast[];
  lastSummary: ImportSummary | null;

  watcherStatus: WatcherStatus;
  chooseFolder: () => Promise<void>;
  resumeWatching: () => Promise<void>;
  supportsWatching: boolean;

  lastImportAt: string | null;
  newestDataAt: string | null;
}

const StoreCtx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreCtx);
  if (!v) throw new Error('useStore outside provider');
  return v;
}

let toastSeq = 1;
let searchSeq = 1;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [convMeta, setConvMeta] = useState<ConvMeta[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [outputs, setOutputs] = useState<OutputCard[]>([]);
  const [skipped, setSkipped] = useState<SkippedItem[]>([]);
  const [workspaces, setWorkspacesState] = useState<Workspace[]>([]);
  const [scope, setScopeState] = useState<Scope>({ kind: 'all' });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('atlas-theme') as 'dark' | 'light') || 'dark');
  const [query, setQueryState] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [matchedConvIds, setMatchedConvIds] = useState<Set<string>>(new Set());
  const [keywordChip, setKeywordChip] = useState<string | null>(null);
  const [reading, setReading] = useState<ReadingTarget | null>(null);
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus>({ state: browserSupportsWatching() ? 'off' : 'unsupported' });
  const [lastImportAt, setLastImportAt] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const watcherRef = useRef<FolderWatcher | null>(null);
  const importQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingImports = useRef<Map<string, (s: ImportSummary) => void>>(new Map());
  const latestSearchId = useRef(0);
  const scopeInitialised = useRef(false);

  // ---- theme ----
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('atlas-theme', theme);
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const pushToast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastSeq++;
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 5500);
  }, []);

  // ---- load persisted state ----
  const reloadDerived = useCallback(async () => {
    const [bundle, sk, ws, lia] = await Promise.all([getDerived(), getSkipped(), getWorkspaces(), getMeta<string>('lastImportAt')]);
    if (bundle) {
      setConvMeta(bundle.convMeta);
      setEdges(bundle.edges);
      setOutputs(bundle.outputs);
    }
    setSkipped(sk);
    setWorkspacesState(ws);
    setLastImportAt(lia ?? null);

    // First run with data: default the scope to a project or workspace named
    // "Career" if one exists, as requested.
    if (!scopeInitialised.current && bundle) {
      scopeInitialised.current = true;
      const savedScope = await getMeta<Scope>('scope');
      if (savedScope) {
        setScopeState(savedScope);
      } else {
        const career = bundle.convMeta.find((c) => c.projectName?.toLowerCase() === 'career');
        if (career && career.projectUuid) {
          setScopeState({ kind: 'project', uuid: career.projectUuid, name: career.projectName! });
        } else {
          const wsCareer = ws.find((w) => w.name.toLowerCase() === 'career');
          if (wsCareer) setScopeState({ kind: 'workspace', id: wsCareer.id, name: wsCareer.name });
        }
      }
    }
  }, []);

  // ---- worker ----
  useEffect(() => {
    const worker = new Worker(new URL('../workers/dataWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.t === 'ready') {
        setLoading(false);
      } else if (m.t === 'progress') {
        setProgress(m.pct >= 1 ? null : { label: m.label, pct: m.pct });
      } else if (m.t === 'imported') {
        setProgress(null);
        setLastSummary(m.summary);
        const resolve = pendingImports.current.get(m.summary.fileName);
        if (resolve) {
          pendingImports.current.delete(m.summary.fileName);
          resolve(m.summary);
        }
        void reloadDerived();
        const { added, updated } = m.summary;
        if (added || updated) {
          const bits = [];
          if (added) bits.push(`${added} new conversation${added === 1 ? '' : 's'}`);
          if (updated) bits.push(`${updated} updated`);
          pushToast(bits.join(', '), 'success');
        } else if (m.summary.skipped.length && !added && !updated) {
          pushToast('That file could not be read — see “skipped items” for details.', 'error');
        } else {
          pushToast('Already up to date — nothing new in that export.', 'info');
        }
      } else if (m.t === 'results') {
        if (m.id === latestSearchId.current) {
          setHits(m.hits);
          setTotalHits(m.totalHits);
          setMatchedConvIds(new Set(m.matchedConvIds));
        }
      } else if (m.t === 'error') {
        setProgress(null);
        pushToast(`Something went wrong: ${m.message}`, 'error');
      }
    };
    worker.postMessage({ t: 'init' });
    void reloadDerived();
    return () => worker.terminate();
  }, [pushToast, reloadDerived]);

  // ---- import ----
  const importOne = useCallback((file: File): Promise<ImportSummary> => {
    return new Promise((resolve) => {
      const run = async () => {
        const buf = await file.arrayBuffer();
        pendingImports.current.set(file.name, resolve as (s: ImportSummary) => void);
        workerRef.current?.postMessage({ t: 'import', buf, fileName: file.name }, [buf]);
      };
      importQueue.current = importQueue.current.then(run);
    });
  }, []);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const f of Array.from(files)) {
        if (!/\.zip$/i.test(f.name)) {
          pushToast(`“${f.name}” is not a zip file, so it was skipped.`, 'error');
          continue;
        }
        await importOne(f);
      }
    },
    [importOne, pushToast],
  );

  // ---- folder watcher ----
  useEffect(() => {
    const watcher = new FolderWatcher(
      async (file) => {
        const summary = await importOne(file);
        // Mark as processed even when unreadable, so a bad zip is not retried forever.
        return summary !== null;
      },
      (s) => setWatcherStatus(s),
    );
    watcherRef.current = watcher;
    void watcher.restore();
    if (import.meta.env.DEV) {
      // Automated-test hook: lets tests drive the watcher with a fake folder.
      (window as unknown as Record<string, unknown>).__atlasTest = {
        injectDirHandle: (h: unknown) => watcher.setHandleForTesting(h as never),
        scanNow: () => watcher.scan(),
      };
    }
    return () => watcher.stop();
  }, [importOne]);

  const chooseFolder = useCallback(async () => {
    const ok = await watcherRef.current?.pickFolder();
    if (ok) pushToast('Watching your folder — new exports will appear here automatically.', 'success');
  }, [pushToast]);

  const resumeWatching = useCallback(async () => {
    const ok = await watcherRef.current?.resume();
    if (ok) pushToast('Watching resumed.', 'success');
  }, [pushToast]);

  // ---- scope ----
  const setScope = useCallback((s: Scope) => {
    setScopeState(s);
    void setMeta('scope', s);
  }, []);

  const scopedConvs = useMemo(() => {
    let list = convMeta;
    if (scope.kind === 'project') list = list.filter((c) => c.projectUuid === scope.uuid);
    else if (scope.kind === 'workspace') {
      const ws = workspaces.find((w) => w.id === scope.id);
      const ids = new Set(ws?.convIds ?? []);
      list = list.filter((c) => ids.has(c.uuid));
    }
    if (keywordChip) {
      const kw = keywordChip.toLowerCase();
      list = list.filter((c) => c.terms.includes(kw) || c.name.toLowerCase().includes(kw));
    }
    return list;
  }, [convMeta, scope, workspaces, keywordChip]);

  const projects = useMemo(() => {
    const map = new Map<string, { uuid: string; name: string; count: number }>();
    for (const c of convMeta) {
      if (c.projectUuid && c.projectName) {
        const e = map.get(c.projectUuid) ?? { uuid: c.projectUuid, name: c.projectName, count: 0 };
        e.count++;
        map.set(c.projectUuid, e);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [convMeta]);

  const saveWorkspace = useCallback(
    async (name: string, convIds: string[], id?: string) => {
      const list = await getWorkspaces();
      const finalId = id ?? `ws-${Date.now()}`;
      let next: Workspace[];
      if (id) {
        next = list.map((w) => (w.id === id ? { ...w, name, convIds } : w));
      } else {
        next = [...list, { id: finalId, name, convIds }];
      }
      await dbSetWorkspaces(next);
      setWorkspacesState(next);
      pushToast(`Workspace “${name}” saved with ${convIds.length} conversations.`, 'success');
      return finalId;
    },
    [pushToast],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const list = (await getWorkspaces()).filter((w) => w.id !== id);
      await dbSetWorkspaces(list);
      setWorkspacesState(list);
      setScopeState((s) => (s.kind === 'workspace' && s.id === id ? { kind: 'all' } : s));
    },
    [],
  );

  // ---- search ----
  const scopeIdsKey = useMemo(
    () => (scope.kind === 'all' && !keywordChip ? null : scopedConvs.map((c) => c.uuid)),
    [scope, scopedConvs, keywordChip],
  );

  useEffect(() => {
    const id = ++searchSeq;
    latestSearchId.current = id;
    if (!query.trim()) {
      setHits([]);
      setTotalHits(0);
      setMatchedConvIds(new Set());
      return;
    }
    const timer = setTimeout(() => {
      const f: SearchFilters = { ...filters, scopeConvIds: scopeIdsKey ?? undefined, keyword: keywordChip ?? undefined };
      workerRef.current?.postMessage({ t: 'search', id, q: query, filters: f });
    }, 120);
    return () => clearTimeout(timer);
  }, [query, filters, scopeIdsKey, keywordChip]);

  const setQuery = useCallback((q: string) => setQueryState(q), []);

  const openConversation = useCallback((convId: string, msgId?: string) => {
    setReading({ convId, msgId });
  }, []);
  const closeReading = useCallback(() => setReading(null), []);

  const newestDataAt = useMemo(() => {
    let newest: string | null = null;
    for (const c of convMeta) if (!newest || c.updated_at > newest) newest = c.updated_at;
    return newest;
  }, [convMeta]);

  const value: StoreValue = {
    loading,
    convMeta,
    scopedConvs,
    edges,
    outputs,
    skipped,
    workspaces,
    projects,
    scope,
    setScope,
    saveWorkspace,
    deleteWorkspace,
    theme,
    toggleTheme,
    query,
    setQuery,
    filters,
    setFilters,
    hits,
    totalHits,
    matchedConvIds,
    keywordChip,
    setKeywordChip,
    reading,
    openConversation,
    closeReading,
    importFiles,
    progress,
    toasts,
    lastSummary,
    watcherStatus,
    chooseFolder,
    resumeWatching,
    supportsWatching: browserSupportsWatching(),
    lastImportAt,
    newestDataAt,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
