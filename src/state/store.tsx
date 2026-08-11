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
} from '../db/db';
import { fileKeyMatches } from '../lib/fileMoments';
import { FolderWatcher, browserSupportsWatching, type WatcherStatus } from '../adapters/folderWatch';
import { SaveFolder, type SaveFolderStatus, type WritableDirHandle } from '../adapters/saveFolder';
import { downloadBlob } from '../lib/download';
import type { FileMoment, StoredFileMeta } from '../types';

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
    setStoredFiles(await listStoredFiles());

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

  /**
   * Any document file that lands in the watched folder gets kept forever and
   * matched to its conversation — by exact name first, then by comparing the
   * file's name to conversation, document and file-card titles ("Sydney tech
   * target list 100" ≈ SydneyTechTargetList100.docx).
   */
  const captureDocFile = useCallback(
    async (file: File): Promise<boolean> => {
      const lower = file.name.toLowerCase();
      let moment = momentsRef.current.find((m) => m.fileNames.some((n) => n.toLowerCase() === lower));
      if (!moment) moment = momentsRef.current.find((m) => m.fileNames.some((n) => fileKeyMatches(file.name, n)));
      if (!moment) moment = momentsRef.current.find((m) => fileKeyMatches(file.name, m.convName));
      let linkedConvId = moment?.convId;
      if (!linkedConvId) {
        const output = outputsRef.current.find((o) => fileKeyMatches(file.name, o.title));
        linkedConvId = output?.convId ?? convMetaRef.current.find((c) => fileKeyMatches(file.name, c.name))?.uuid;
      }
      const meta: StoredFileMeta = {
        id: fileArchiveId(file.name, file.size, file.lastModified),
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        capturedAt: new Date().toISOString(),
        source: 'watched',
        linkedMomentId: moment?.id,
        linkedConvId,
      };
      await putStoredFile(meta, file);
      setStoredFiles(await listStoredFiles());
      pushToast(`Saved “${file.name}” — find it any time under Files.`, 'success');
      const sf = saveFolderRef.current;
      if (sf && (await sf.ready())) void sf.writeFile(file.name, file);
      return true;
    },
    [pushToast],
  );

  const attachOriginal = useCallback(
    async (moment: FileMoment, file: File) => {
      const meta: StoredFileMeta = {
        id: fileArchiveId(file.name, file.size, file.lastModified),
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        capturedAt: new Date().toISOString(),
        source: 'attached',
        linkedMomentId: moment.id,
        linkedConvId: moment.convId,
      };
      await putStoredFile(meta, file);
      setStoredFiles(await listStoredFiles());
      pushToast(`Original “${file.name}” attached and kept.`, 'success');
      const sf = saveFolderRef.current;
      if (sf && (await sf.ready())) void sf.writeFile(file.name, file);
    },
    [pushToast],
  );

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
      setStoredFiles(await listStoredFiles());
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

  /** Write the whole archive to the save folder: kept originals as-is, rebuilt Word files for the rest. */
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
    const { compileMoment } = await import('../lib/compile');
    const { renderDocxBlob } = await import('../lib/renderDocx');
    for (const m of fileMoments) {
      if (originalsByMoment.has(m.id)) continue;
      try {
        const doc = await compileMoment(m);
        const blob = await renderDocxBlob(doc);
        const base = (m.fileNames[0] ?? doc.title).replace(/\.[a-z0-9]+$/i, '');
        if (await sf.writeFile(`${base}.docx`, blob)) written++;
      } catch {
        /* fail soft per file */
      }
    }
    pushToast(written > 0 ? `Saved ${written} file${written === 1 ? '' : 's'} to the folder.` : 'Nothing to save yet.', written ? 'success' : 'info');
  }, [storedFiles, fileMoments, originalsByMoment, pushToast]);

  // Auto-save: new file-moments (arriving with new imports) get a rebuilt
  // .docx written to the save folder, unless their original was captured.
  useEffect(() => {
    if (saveFolderStatus.state !== 'on') return;
    void (async () => {
      const since = await getMeta<string>('saveFolderSince');
      if (!since) return;
      const done = (await getMeta<Record<string, true>>('autoSavedMoments')) ?? {};
      const pending = fileMoments.filter((m) => m.date > since && !done[m.id] && !originalsByMoment.has(m.id));
      if (pending.length === 0) return;
      const sf = saveFolderRef.current;
      if (!sf || !(await sf.ready())) return;
      const { compileMoment } = await import('../lib/compile');
      const { renderDocxBlob } = await import('../lib/renderDocx');
      let written = 0;
      for (const m of pending) {
        try {
          const doc = await compileMoment(m);
          const blob = await renderDocxBlob(doc);
          const base = (m.fileNames[0] ?? doc.title).replace(/\.[a-z0-9]+$/i, '');
          if (await sf.writeFile(`${base}.docx`, blob)) written++;
        } catch {
          /* fail soft per file */
        }
        done[m.id] = true;
      }
      await setMeta('autoSavedMoments', done);
      if (written > 0) pushToast(`Saved ${written} new document${written === 1 ? '' : 's'} to your folder.`, 'success');
    })();
  }, [fileMoments, saveFolderStatus, originalsByMoment, pushToast]);

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
  useEffect(() => {
    watcherRef.current?.setDocCapture(captureDocFile);
  }, [captureDocFile]);

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
