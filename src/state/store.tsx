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
  Collection,
  ConvMeta,
  Entity,
  EntityKind,
  EntityOverrides,
  FromWorker,
  GraphEdge,
  ImportSummary,
  LibraryItemRef,
  OutputCard,
  OutputType,
  SearchFilters,
  SearchHit,
  SkippedItem,
  Workspace,
} from '../types';
import {
  getDerived,
  getMeta,
  getSkipped,
  getWorkspaces,
  setMeta,
  setWorkspaces as dbSetWorkspaces,
  getPins,
  setPins as dbSetPins,
  getCollections,
  setCollections as dbSetCollections,
  getEntityOverrides,
  setEntityOverrides as dbSetEntityOverrides,
  EMPTY_OVERRIDES,
  DERIVED_SCHEMA_VERSION,
  fileArchiveId,
  putStoredFile,
  listStoredFiles,
  getStoredFileBlob,
  deleteStoredFile as dbDeleteStoredFile,
  updateStoredFileMeta,
} from '../db/db';
import {
  FolderWatcher,
  browserSupportsWatching,
  type DocContext,
  type DocResult,
  type WatcherStatus,
} from '../adapters/folderWatch';
import { SaveFolder, type SaveFolderStatus, type WritableDirHandle } from '../adapters/saveFolder';
import { downloadBlob } from '../lib/download';
import type { FileMoment, StoredFileMeta } from '../types';
import { identifyFile, IDENTITY_VERSION } from '../lib/fileIdentity';
import { matchFile, type MatchSources } from '../lib/fileMatch';

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

/**
 * Filenames that usually mean private paperwork. Chat Atlas exists to keep
 * Claude's documents, not to hoover up a person's bank statements, so these
 * are left alone unless the user adds them deliberately.
 */
const PRIVATE_LOOKING = /(statement|invoice|receipt|payslip|payslips|tax|bank|passport|licence|license|medicare|contract|insurance)/i;

/** Which knowledge source the Library is showing. Lives in the store so search results and row actions can navigate. */
export type LibrarySelection =
  | { kind: 'home' }
  | { kind: 'pinned' }
  | { kind: 'recent' }
  | { kind: 'documents' }
  | { kind: 'type'; type: OutputType }
  | { kind: 'entity'; id: string }
  | { kind: 'collection'; id: string }
  | { kind: 'conversations' };

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

  // Knowledge organisation
  visibleEntities: Entity[];
  renameEntity: (id: string, label: string) => void;
  hideEntity: (id: string) => void;
  mergeEntities: (fromId: string, intoId: string) => void;
  setEntityKind: (id: string, kind: EntityKind | undefined) => void;
  pins: LibraryItemRef[];
  togglePin: (ref: LibraryItemRef) => void;
  isPinned: (ref: LibraryItemRef) => boolean;
  collections: Collection[];
  createCollection: (name: string, items?: LibraryItemRef[]) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  addToCollection: (colId: string, ref: LibraryItemRef) => void;
  removeFromCollection: (colId: string, ref: LibraryItemRef) => void;
  moveInCollection: (colId: string, index: number, dir: -1 | 1) => void;
  librarySel: LibrarySelection;
  setLibrarySel: (s: LibrarySelection) => void;
  groupedOutputs: OutputCard[];
  versionsOf: (groupId: string) => OutputCard[];
  prevImportAt: string | null;

  // The Files archive
  fileMoments: FileMoment[];
  storedFiles: StoredFileMeta[];
  originalsByMoment: Map<string, StoredFileMeta>;
  attachOriginal: (moment: FileMoment, file: File) => Promise<void>;
  downloadOriginal: (id: string) => Promise<void>;
  removeStoredFile: (id: string) => Promise<void>;
  /** Add files the user picked or dropped; returns what happened to them. */
  addFilesByHand: (files: File[], ctx: DocContext) => Promise<{ kept: number; ignored: number }>;
  linkFileToConversation: (fileId: string, convId: string) => Promise<void>;
  keepReviewedFile: (fileId: string) => Promise<void>;
  rescanFolders: () => Promise<void>;
  addWatchFolder: () => Promise<void>;
  scanFolderOnce: () => Promise<void>;
  backfillProgress: { done: number; total: number } | null;
  saveFolderStatus: SaveFolderStatus;
  chooseSaveFolder: () => Promise<void>;
  resumeSaveFolder: () => Promise<void>;
  turnOffSaveFolder: () => Promise<void>;
  saveAllToFolder: () => Promise<void>;

  // App updates
  updateInfo: { local: number; remote: number | null } | null;
  updating: boolean;
  checkForUpdates: (announce: boolean) => Promise<void>;
  runUpdate: () => Promise<void>;

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
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityOverrides, setEntityOverridesState] = useState<EntityOverrides>({ ...EMPTY_OVERRIDES });
  const [pins, setPinsState] = useState<LibraryItemRef[]>([]);
  const [collections, setCollectionsState] = useState<Collection[]>([]);
  // Files are the thing Jason reaches for most, so the app opens onto them.
  const [librarySel, setLibrarySel] = useState<LibrarySelection>({ kind: 'documents' });
  const [prevImportAt, setPrevImportAt] = useState<string | null>(null);
  const [fileMoments, setFileMoments] = useState<FileMoment[]>([]);
  const [storedFiles, setStoredFiles] = useState<StoredFileMeta[]>([]);
  const [saveFolderStatus, setSaveFolderStatus] = useState<SaveFolderStatus>({ state: 'off' });
  const [updateInfo, setUpdateInfo] = useState<{ local: number; remote: number | null } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);
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
  const saveFolderRef = useRef<SaveFolder | null>(null);
  const momentsRef = useRef<FileMoment[]>([]);
  const convMetaRef = useRef<ConvMeta[]>([]);
  const outputsRef = useRef<OutputCard[]>([]);
  const storedFilesRef = useRef<StoredFileMeta[]>([]);
  /** Everything the file matcher needs, kept current so the capture callback never changes identity. */
  const matchSourcesRef = useRef<MatchSources>({ moments: [], outputs: [], convs: [], msgStamps: [] });
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
    const [bundle, sk, ws, lia, pia, pn, cols, ov] = await Promise.all([
      getDerived(),
      getSkipped(),
      getWorkspaces(),
      getMeta<string>('lastImportAt'),
      getMeta<string>('prevImportAt'),
      getPins(),
      getCollections(),
      getEntityOverrides(),
    ]);
    if (bundle) {
      setConvMeta(bundle.convMeta);
      setEdges(bundle.edges);
      setOutputs(bundle.outputs);
      setEntities(bundle.entities ?? []);
      setFileMoments(bundle.fileMoments ?? []);
      momentsRef.current = bundle.fileMoments ?? [];
      convMetaRef.current = bundle.convMeta;
      outputsRef.current = bundle.outputs;
      matchSourcesRef.current = {
        moments: bundle.fileMoments ?? [],
        outputs: bundle.outputs,
        convs: bundle.convMeta,
        msgStamps: bundle.msgStamps ?? [],
      };
      // Data imported by an older version of the app: derive the new
      // organisation (entities, versions, better titles) from what's already
      // stored — no re-import needed.
      if (bundle.schemaVersion !== DERIVED_SCHEMA_VERSION) {
        workerRef.current?.postMessage({ t: 'rebuild' });
      }
    }
    setSkipped(sk);
    setWorkspacesState(ws);
    setLastImportAt(lia ?? null);
    setPrevImportAt(pia ?? null);
    setPinsState(pn);
    setCollectionsState(cols);
    setEntityOverridesState(ov);
    const files = await listStoredFiles();
    storedFilesRef.current = files;
    setStoredFiles(files);

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
      } else if (m.t === 'rebuilt') {
        // The rebuild's own progress card must never outlive the work.
        setProgress(null);
        void reloadDerived();
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
  // Both callbacks are wired at construction through refs, so the watcher can
  // never run a scan before its handlers exist, and it is never torn down and
  // rebuilt when an unrelated callback's identity changes.
  const importOneRef = useRef(importOne);
  importOneRef.current = importOne;
  const captureRef = useRef<(f: File, ctx: DocContext) => Promise<DocResult>>(async () => 'ignored');

  useEffect(() => {
    const watcher = new FolderWatcher({
      onZip: async (file) => {
        const summary = await importOneRef.current(file);
        // Mark as processed even when unreadable, so a bad zip is not retried forever.
        return summary !== null;
      },
      onDocFile: (file, ctx) => captureRef.current(file, ctx),
      onStatus: (s) => setWatcherStatus(s),
    });
    watcherRef.current = watcher;
    void watcher.restore();
    if (import.meta.env.DEV) {
      // Automated-test hooks: drive the watcher with a stand-in folder.
      const hooks = ((window as unknown as Record<string, unknown>).__atlasTest ?? {}) as Record<string, unknown>;
      hooks.injectDirHandle = (h: unknown) => watcher.setHandleForTesting(h as never);
      hooks.scanNow = () => watcher.scan();
      (window as unknown as Record<string, unknown>).__atlasTest = hooks;
    }
    return () => watcher.stop();
  }, []);

  const chooseFolder = useCallback(async () => {
    const ok = await watcherRef.current?.addFolder();
    if (ok) pushToast('Watching that folder — files you download from Claude will appear here by themselves.', 'success');
  }, [pushToast]);

  const addWatchFolder = chooseFolder;

  const resumeWatching = useCallback(async () => {
    const granted = (await watcherRef.current?.resume()) ?? 0;
    if (granted > 0) pushToast('Watching again — looking for anything downloaded since.', 'success');
  }, [pushToast]);

  const rescanFolders = useCallback(async () => {
    const w = watcherRef.current;
    if (!w) return;
    await w.clearSeenDocs();
    const { looked, kept } = await w.scan();
    pushToast(
      kept > 0
        ? `Looked at ${looked} file${looked === 1 ? '' : 's'} and saved ${kept} new one${kept === 1 ? '' : 's'}.`
        : `Looked at ${looked} file${looked === 1 ? '' : 's'} — nothing new from Claude.`,
      kept > 0 ? 'success' : 'info',
    );
  }, [pushToast]);

  const scanFolderOnce = useCallback(async () => {
    const result = await watcherRef.current?.scanFolderOnce();
    if (!result) return;
    pushToast(
      `Looked at ${result.looked} file${result.looked === 1 ? '' : 's'}, kept ${result.kept} that Claude made.`,
      result.kept > 0 ? 'success' : 'info',
    );
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

  // ---- knowledge organisation ----

  const visibleEntities = useMemo(() => {
    const { hidden, renames, merges, kinds } = entityOverrides;
    const hiddenSet = new Set(hidden);
    // Fold merged entities into their canonical target.
    const byId = new Map<string, Entity>();
    for (const e of entities) {
      const target = merges[e.id] ?? e.id;
      const existing = byId.get(target);
      if (existing) {
        existing.convIds = [...new Set([...existing.convIds, ...e.convIds])];
        existing.outputIds = [...new Set([...existing.outputIds, ...e.outputIds])];
        existing.count += e.count;
        existing.inTitles += e.inTitles;
        existing.score += e.score;
      } else if (target === e.id) {
        byId.set(target, { ...e, convIds: [...e.convIds], outputIds: [...e.outputIds] });
      } else {
        // Merge target not detected this rebuild: keep the merged-into id alive.
        byId.set(target, { ...e, id: target, convIds: [...e.convIds], outputIds: [...e.outputIds] });
      }
    }
    const out: Entity[] = [];
    for (const e of byId.values()) {
      if (hiddenSet.has(e.id)) continue;
      if (renames[e.id]) e.label = renames[e.id];
      if (kinds[e.id]) e.kind = kinds[e.id];
      out.push(e);
    }
    return out.sort((a, b) => b.score - a.score);
  }, [entities, entityOverrides]);

  const saveOverrides = useCallback((next: EntityOverrides) => {
    setEntityOverridesState(next);
    void dbSetEntityOverrides(next);
  }, []);

  const renameEntity = useCallback(
    (id: string, label: string) => {
      saveOverrides({ ...entityOverrides, renames: { ...entityOverrides.renames, [id]: label } });
    },
    [entityOverrides, saveOverrides],
  );

  const hideEntity = useCallback(
    (id: string) => {
      if (!entityOverrides.hidden.includes(id)) {
        saveOverrides({ ...entityOverrides, hidden: [...entityOverrides.hidden, id] });
      }
      setLibrarySel((s) => (s.kind === 'entity' && s.id === id ? { kind: 'home' } : s));
    },
    [entityOverrides, saveOverrides],
  );

  const mergeEntities = useCallback(
    (fromId: string, intoId: string) => {
      if (fromId === intoId) return;
      saveOverrides({ ...entityOverrides, merges: { ...entityOverrides.merges, [fromId]: intoId } });
      setLibrarySel((s) => (s.kind === 'entity' && s.id === fromId ? { kind: 'entity', id: intoId } : s));
    },
    [entityOverrides, saveOverrides],
  );

  const setEntityKind = useCallback(
    (id: string, kind: EntityKind | undefined) => {
      const kinds = { ...entityOverrides.kinds };
      if (kind) kinds[id] = kind;
      else delete kinds[id];
      saveOverrides({ ...entityOverrides, kinds });
    },
    [entityOverrides, saveOverrides],
  );

  const togglePin = useCallback((ref: LibraryItemRef) => {
    setPinsState((prev) => {
      const exists = prev.some((p) => p.kind === ref.kind && p.id === ref.id);
      const next = exists ? prev.filter((p) => !(p.kind === ref.kind && p.id === ref.id)) : [ref, ...prev];
      void dbSetPins(next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (ref: LibraryItemRef) => pins.some((p) => p.kind === ref.kind && p.id === ref.id),
    [pins],
  );

  const persistCollections = useCallback((next: Collection[]) => {
    setCollectionsState(next);
    void dbSetCollections(next);
  }, []);

  const createCollection = useCallback(
    (name: string, items: LibraryItemRef[] = []) => {
      const id = `col-${Date.now()}`;
      persistCollections([...collections, { id, name, items, createdAt: new Date().toISOString() }]);
      pushToast(`Collection “${name}” created.`, 'success');
      return id;
    },
    [collections, persistCollections, pushToast],
  );

  const renameCollection = useCallback(
    (id: string, name: string) => {
      persistCollections(collections.map((c) => (c.id === id ? { ...c, name } : c)));
    },
    [collections, persistCollections],
  );

  const deleteCollection = useCallback(
    (id: string) => {
      persistCollections(collections.filter((c) => c.id !== id));
      setLibrarySel((s) => (s.kind === 'collection' && s.id === id ? { kind: 'home' } : s));
    },
    [collections, persistCollections],
  );

  const addToCollection = useCallback(
    (colId: string, ref: LibraryItemRef) => {
      const col = collections.find((c) => c.id === colId);
      if (!col) return;
      if (col.items.some((i) => i.kind === ref.kind && i.id === ref.id)) {
        pushToast(`Already in “${col.name}”.`, 'info');
        return;
      }
      persistCollections(collections.map((c) => (c.id === colId ? { ...c, items: [...c.items, ref] } : c)));
      pushToast(`Added to “${col.name}”.`, 'success');
    },
    [collections, persistCollections, pushToast],
  );

  const removeFromCollection = useCallback(
    (colId: string, ref: LibraryItemRef) => {
      persistCollections(
        collections.map((c) =>
          c.id === colId ? { ...c, items: c.items.filter((i) => !(i.kind === ref.kind && i.id === ref.id)) } : c,
        ),
      );
    },
    [collections, persistCollections],
  );

  const moveInCollection = useCallback(
    (colId: string, index: number, dir: -1 | 1) => {
      persistCollections(
        collections.map((c) => {
          if (c.id !== colId) return c;
          const items = [...c.items];
          const j = index + dir;
          if (j < 0 || j >= items.length) return c;
          [items[index], items[j]] = [items[j], items[index]];
          return { ...c, items };
        }),
      );
    },
    [collections, persistCollections],
  );

  // Collapse version groups to their newest member.
  const groupedOutputs = useMemo(() => {
    const newestByGroup = new Map<string, OutputCard>();
    for (const card of outputs) {
      const cur = newestByGroup.get(card.groupId);
      if (!cur || card.date > cur.date) newestByGroup.set(card.groupId, card);
    }
    return [...newestByGroup.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [outputs]);

  const versionsOf = useCallback(
    (groupId: string) => outputs.filter((o) => o.groupId === groupId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [outputs],
  );

  // ---- the Documents archive ----

  const originalsByMoment = useMemo(() => {
    const map = new Map<string, StoredFileMeta>();
    for (const f of storedFiles) {
      if (f.linkedMomentId && !map.has(f.linkedMomentId)) map.set(f.linkedMomentId, f);
    }
    return map;
  }, [storedFiles]);

  /** A folder sweep can find several files at once; they are announced together. */
  const captureBatch = useRef<{ names: string[]; timer: ReturnType<typeof setTimeout> | null }>({ names: [], timer: null });
  const announceCapture = useCallback(
    (name: string) => {
      const batch = captureBatch.current;
      batch.names.push(name);
      if (batch.timer) clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        const names = batch.names;
        batch.names = [];
        batch.timer = null;
        pushToast(
          names.length === 1
            ? `Saved “${names[0]}” — find it any time under Your files.`
            : `Saved ${names.length} files from Claude — find them under Your files.`,
          'success',
        );
      }, 1200);
    },
    [pushToast],
  );

  /**
   * Decide what to do with one document file, then keep it or ignore it.
   *
   * Kept only when the file is recognisably one of Claude's (it says so
   * inside — see lib/fileIdentity.ts) or it clearly belongs to one of the
   * conversations. Everything else is ignored silently: no toast, nothing
   * stored. `force` is set when the user added the file themselves, which
   * overrides every rule — their explicit choice always wins.
   */
  const captureDocFile = useCallback(
    async (file: File, ctx: DocContext): Promise<DocResult> => {
      const id = await identifyFile(file, file.name);
      const match = matchFile(file.name, id, matchSourcesRef.current);

      const looksPrivate = PRIVATE_LOOKING.test(file.name) && !id.isClaudeMade && match.confidence < 0.85;
      const keep = ctx.force || (!looksPrivate && (id.isClaudeMade || match.how !== 'none'));
      if (!keep) return 'ignored';

      const fileId = fileArchiveId(file.name, file.size, file.lastModified);
      const existing = storedFilesRef.current.find(
        (f) =>
          f.id === fileId ||
          (f.size === file.size && !!id.producedAt && f.producedAt === id.producedAt && f.docTitle === id.title),
      );
      if (existing && existing.id !== fileId) {
        // The same document found in a second folder: remember where, don't store twice.
        await updateStoredFileMeta(existing.id, { relPath: existing.relPath ?? ctx.relPath });
        return 'duplicate';
      }

      const msgDate = match.msgId
        ? matchSourcesRef.current.msgStamps.find((s) => s.msgId === match.msgId)?.date
        : undefined;
      const producedAt = id.producedAt ?? msgDate ?? new Date(file.lastModified).toISOString();
      const producedAtSource: StoredFileMeta['producedAtSource'] = id.producedAt
        ? id.producedAtSource
        : msgDate
          ? 'message'
          : 'file-mtime';

      const meta: StoredFileMeta = {
        id: fileId,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        capturedAt: new Date().toISOString(),
        source: ctx.source,
        folderName: ctx.folderName,
        relPath: ctx.relPath,
        linkedMomentId: match.momentId,
        linkedConvId: match.convId,
        linkedMsgId: match.msgId,
        producedAt,
        producedAtSource,
        docTitle: id.title,
        docDescription: id.description,
        isClaudeMade: id.isClaudeMade,
        claudeScore: id.claudeScore,
        identitySignals: id.signals,
        identityVersion: IDENTITY_VERSION,
        linkMethod: match.how,
        linkConfidence: match.confidence,
        linkWhy: match.why,
        needsReview: !id.isClaudeMade && match.how === 'none',
      };
      await putStoredFile(meta, file);
      const fresh = await listStoredFiles();
      storedFilesRef.current = fresh;
      setStoredFiles(fresh);
      // A folder sweep often finds several files at once; announce them as one
      // message rather than a stack of toasts covering the page.
      if (ctx.source === 'watched') announceCapture(file.name);
      // Mirror into the save folder, unless that folder is one we read from.
      const sf = saveFolderRef.current;
      if (sf && (await sf.ready()) && !(await sf.isWatchedBy(watcherRef.current))) {
        void sf.writeFile(file.name, file);
      }
      return 'kept';
    },
    [announceCapture],
  );

  const addFilesByHand = useCallback(
    async (files: File[], ctx: DocContext) => {
      let kept = 0;
      let ignored = 0;
      for (const f of files) {
        const result = await captureDocFile(f, { ...ctx, force: true });
        if (result === 'kept') kept++;
        else ignored++;
      }
      return { kept, ignored };
    },
    [captureDocFile],
  );

  const attachOriginal = useCallback(
    async (moment: FileMoment, file: File) => {
      await captureDocFile(file, { source: 'attached', force: true });
      // The user pointed at this row, so trust that over any guess.
      const fileId = fileArchiveId(file.name, file.size, file.lastModified);
      await updateStoredFileMeta(fileId, {
        linkedMomentId: moment.id,
        linkedConvId: moment.convId,
        linkedMsgId: moment.msgId,
        linkMethod: 'manual',
        linkConfidence: 1,
        linkWhy: 'You added this file to this chat yourself.',
        needsReview: false,
      });
      const fresh = await listStoredFiles();
      storedFilesRef.current = fresh;
      setStoredFiles(fresh);
      pushToast(`Saved “${file.name}” — it's yours forever now.`, 'success');
    },
    [captureDocFile, pushToast],
  );

  const linkFileToConversation = useCallback(
    async (fileId: string, convId: string) => {
      const conv = convMetaRef.current.find((c) => c.uuid === convId);
      await updateStoredFileMeta(fileId, {
        linkedConvId: convId,
        linkedMomentId: undefined,
        linkMethod: 'manual',
        linkConfidence: 1,
        linkWhy: `You linked this to “${conv?.name ?? 'this chat'}”.`,
        needsReview: false,
      });
      const fresh = await listStoredFiles();
      storedFilesRef.current = fresh;
      setStoredFiles(fresh);
    },
    [],
  );

  const keepReviewedFile = useCallback(async (fileId: string) => {
    await updateStoredFileMeta(fileId, { needsReview: false });
    const fresh = await listStoredFiles();
    storedFilesRef.current = fresh;
    setStoredFiles(fresh);
  }, []);

  const downloadOriginal = useCallback(
    async (id: string) => {
      const blob = await getStoredFileBlob(id);
      const meta = storedFiles.find((f) => f.id === id);
      if (blob && meta) downloadBlob(blob, meta.name);
    },
    [storedFiles],
  );

  const removeStoredFile = useCallback(
    async (id: string) => {
      await dbDeleteStoredFile(id);
      // Forget it in the watcher too, so a rescan can bring it back rather
      // than suppressing it forever.
      await watcherRef.current?.forgetDoc(id);
      const fresh = await listStoredFiles();
      storedFilesRef.current = fresh;
      setStoredFiles(fresh);
      pushToast('Removed from Chat Atlas. (The file itself, wherever it lives, is untouched.)', 'info');
    },
    [pushToast],
  );

  const chooseSaveFolder = useCallback(async () => {
    const ok = await saveFolderRef.current?.pick();
    if (ok) {
      if (!(await getMeta<string>('saveFolderSince'))) await setMeta('saveFolderSince', new Date().toISOString());
      pushToast('From now on, new documents also land in that folder as real files.', 'success');
    }
  }, [pushToast]);

  const resumeSaveFolder = useCallback(async () => {
    await saveFolderRef.current?.resume();
  }, []);

  const turnOffSaveFolder = useCallback(async () => {
    await saveFolderRef.current?.turnOff();
  }, []);

  /**
   * Copy the real files into the user's chosen folder. ONLY bytes we actually
   * hold are ever written — the app must never invent a document and put it on
   * disk under a filename that looks like one of Claude's.
   */
  const saveAllToFolder = useCallback(async () => {
    const sf = saveFolderRef.current;
    if (!sf || !(await sf.ready())) {
      pushToast('Pick a folder first (or click to allow it again), then try once more.', 'error');
      return;
    }
    let written = 0;
    for (const f of storedFiles) {
      const blob = await getStoredFileBlob(f.id);
      if (blob && (await sf.writeFile(f.name, blob))) written++;
    }
    pushToast(
      written > 0 ? `Copied ${written} file${written === 1 ? '' : 's'} to the folder.` : 'Nothing to copy there yet.',
      written ? 'success' : 'info',
    );
  }, [storedFiles, pushToast]);

  // Files captured by older versions carry none of the identity information
  // the Files view now relies on. Read them once, in small chunks so the page
  // stays responsive, and fill in the gaps. Nothing is ever deleted here:
  // anything that turns out to be neither Claude's nor linked to a chat is
  // flagged for the user to review.
  useEffect(() => {
    if (loading) return;
    void (async () => {
      const stale = storedFilesRef.current.filter((f) => f.identityVersion !== IDENTITY_VERSION);
      if (stale.length === 0) return;
      setBackfillProgress({ done: 0, total: stale.length });
      for (let i = 0; i < stale.length; i++) {
        const f = stale[i];
        try {
          const blob = await getStoredFileBlob(f.id);
          if (blob) {
            const id = await identifyFile(blob, f.name);
            const match = f.linkedConvId
              ? null
              : matchFile(f.name, id, matchSourcesRef.current);
            const msgDate = match?.msgId
              ? matchSourcesRef.current.msgStamps.find((s) => s.msgId === match.msgId)?.date
              : undefined;
            await updateStoredFileMeta(f.id, {
              producedAt: id.producedAt ?? msgDate ?? new Date(f.lastModified).toISOString(),
              producedAtSource: id.producedAt ? id.producedAtSource : msgDate ? 'message' : 'file-mtime',
              docTitle: id.title,
              docDescription: id.description,
              isClaudeMade: id.isClaudeMade,
              claudeScore: id.claudeScore,
              identitySignals: id.signals,
              identityVersion: IDENTITY_VERSION,
              ...(match && match.how !== 'none'
                ? {
                    linkedConvId: match.convId,
                    linkedMomentId: match.momentId,
                    linkedMsgId: match.msgId,
                    linkMethod: match.how,
                    linkConfidence: match.confidence,
                    linkWhy: match.why,
                  }
                : {}),
              needsReview: !id.isClaudeMade && !f.linkedConvId && (!match || match.how === 'none'),
            });
          }
        } catch {
          /* one unreadable file must not stall the rest */
        }
        if (i % 5 === 4) {
          setBackfillProgress({ done: i + 1, total: stale.length });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      const fresh = await listStoredFiles();
      storedFilesRef.current = fresh;
      setStoredFiles(fresh);
      setBackfillProgress(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, fileMoments.length]);

  // ---- app updates ----

  const checkForUpdates = useCallback(
    async (announce: boolean) => {
      try {
        const res = await fetch('/__atlas/update-check');
        const info = (await res.json()) as { local: number; remote: number | null };
        setUpdateInfo(info);
        if (announce) {
          if (info.remote === null) pushToast('Could not reach the update server — are you online?', 'info');
          else if (info.remote > info.local) pushToast(`Version ${info.remote} is ready — click Update in the top bar.`, 'success');
          else pushToast(`You're on the latest version (v${info.local}).`, 'info');
        }
      } catch {
        if (announce) pushToast('Could not check for updates right now.', 'error');
      }
    },
    [pushToast],
  );

  const runUpdate = useCallback(async () => {
    if (updating) return;
    setUpdating(true);
    pushToast('Updating — this takes a minute. The app will refresh itself.', 'info');
    try {
      const res = await fetch('/__atlas/update', { method: 'POST', headers: { 'x-atlas': '1' } });
      const body = (await res.json()) as { ok: boolean };
      if (body.ok) {
        pushToast('Updated! Refreshing…', 'success');
        setTimeout(() => window.location.reload(), 1400);
      } else {
        setUpdating(false);
        pushToast('The update did not finish — nothing was broken. Try again in a minute.', 'error');
      }
    } catch {
      setUpdating(false);
      pushToast('The update did not finish — nothing was broken. Try again in a minute.', 'error');
    }
  }, [updating, pushToast]);

  useEffect(() => {
    void checkForUpdates(false);
    if (import.meta.env.DEV) {
      const hooks = ((window as unknown as Record<string, unknown>).__atlasTest ?? {}) as Record<string, unknown>;
      hooks.setUpdate = (info: unknown) => setUpdateInfo(info as { local: number; remote: number | null });
      (window as unknown as Record<string, unknown>).__atlasTest = hooks;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the watcher's capture handler current, and restore the save folder once.
  captureRef.current = captureDocFile;

  useEffect(() => {
    const sf = new SaveFolder((s) => setSaveFolderStatus(s));
    saveFolderRef.current = sf;
    void sf.restore();
    if (import.meta.env.DEV) {
      const hooks = ((window as unknown as Record<string, unknown>).__atlasTest ?? {}) as Record<string, unknown>;
      hooks.injectSaveHandle = (h: unknown) => sf.setHandleForTesting(h as WritableDirHandle);
      (window as unknown as Record<string, unknown>).__atlasTest = hooks;
    }
  }, []);

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
    visibleEntities,
    renameEntity,
    hideEntity,
    mergeEntities,
    setEntityKind,
    pins,
    togglePin,
    isPinned,
    collections,
    createCollection,
    renameCollection,
    deleteCollection,
    addToCollection,
    removeFromCollection,
    moveInCollection,
    librarySel,
    setLibrarySel,
    groupedOutputs,
    versionsOf,
    prevImportAt,
    fileMoments,
    storedFiles,
    originalsByMoment,
    attachOriginal,
    downloadOriginal,
    removeStoredFile,
    addFilesByHand,
    linkFileToConversation,
    keepReviewedFile,
    rescanFolders,
    addWatchFolder,
    scanFolderOnce,
    backfillProgress,
    saveFolderStatus,
    chooseSaveFolder,
    resumeSaveFolder,
    turnOffSaveFolder,
    saveAllToFolder,
    updateInfo,
    updating,
    checkForUpdates,
    runUpdate,
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
