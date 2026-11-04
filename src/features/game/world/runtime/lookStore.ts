// Where a generated world's art lives: on THIS device only (docs/specs/generated-worlds-spec.md section 0: the service cannot reproduce a picture, so it is stored, not regenerated; nothing is kept on a server, so there
// is nothing to delete there). IndexedDB holds the three image blobs under the look's id; when IndexedDB is not there (a private window, blocked site data) a store in memory keeps the world for this visit. At most
// MAX_STORED_LOOKS worlds are kept (about 0.7 MB each): the oldest goes first, never the one just stored.
import { isLookId } from "../../../../../shared/worldBrief";

export interface LookArtRecord { id: string; at: number; farDay?: Blob; farNight?: Blob; mid?: Blob }

export interface LookStore {
  put(record: LookArtRecord): Promise<void>;
  get(id: string): Promise<LookArtRecord | null>;
  remove(id: string): Promise<void>;
  /** The ids and times of everything stored, oldest first. */
  list(): Promise<Array<{ id: string; at: number }>>;
}

export const MAX_STORED_LOOKS = 12;

export function createMemoryStore(): LookStore {
  const m = new Map<string, LookArtRecord>();
  return {
    async put(r) { m.set(r.id, r); },
    async get(id) { return m.get(id) ?? null; },
    async remove(id) { m.delete(id); },
    async list() { return [...m.values()].map((r) => ({ id: r.id, at: r.at })).sort((a, b) => a.at - b.at); },
  };
}

const DB_NAME = "toyventor-looks";
const STORE = "looks";

/** An IndexedDB store. Every call opens the database lazily and rejects with the browser's own error, which `safeStore` turns into "nothing there" so a broken database never breaks the game. */
export function createIdbStore(factory: IDBFactory): LookStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => (opening ??= new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error ?? new Error("indexedDB open failed")); };
    req.onblocked = () => { opening = null; reject(new Error("indexedDB blocked")); };
  }));
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB aborted"));
    });
  };
  return {
    async put(r) { await run("readwrite", (s) => s.put(r)); },
    async get(id) { return ((await run("readonly", (s) => s.get(id))) as LookArtRecord | undefined) ?? null; },
    async remove(id) { await run("readwrite", (s) => s.delete(id)); },
    async list() { return ((await run("readonly", (s) => s.getAll())) as LookArtRecord[]).map((r) => ({ id: r.id, at: r.at })).sort((a, b) => a.at - b.at); },
  };
}

/** A store that never throws: a failing call is "nothing stored" (get/list) or a quiet no-op (put/remove), and says so by returning false from `works()`. */
export function safeStore(inner: LookStore): LookStore & { works(): boolean } {
  let ok = true;
  const guard = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { ok = false; return fallback; } };
  return {
    put: (r) => guard(() => inner.put(r), undefined),
    get: (id) => guard(() => inner.get(id), null),
    remove: (id) => guard(() => inner.remove(id), undefined),
    list: () => guard(() => inner.list(), []),
    works: () => ok,
  };
}

/** Store a look's art, then drop the oldest worlds beyond `max` (never `record` itself). */
export async function putWithLimit(store: LookStore, record: LookArtRecord, max = MAX_STORED_LOOKS): Promise<string[]> {
  if (!isLookId(record.id)) return [];
  await store.put(record);
  const all = await store.list();
  const dropped: string[] = [];
  for (const old of all) {
    if (all.length - dropped.length <= max) break;
    if (old.id === record.id) continue;
    await store.remove(old.id);
    dropped.push(old.id);
  }
  return dropped;
}

let shared: (LookStore & { works(): boolean }) | null = null;
/** The device's store: IndexedDB when there is one (wrapped so it can never throw), memory otherwise. One per page. */
export function defaultStore(): LookStore & { works(): boolean } {
  if (shared) return shared;
  let inner: LookStore;
  try { inner = typeof indexedDB !== "undefined" ? createIdbStore(indexedDB) : createMemoryStore(); } catch { inner = createMemoryStore(); }
  shared = safeStore(inner);
  return shared;
}
