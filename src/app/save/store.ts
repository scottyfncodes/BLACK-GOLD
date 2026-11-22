/**
 * Save slots in IndexedDB. Each record holds the gzipped save file plus a small summary
 * so the save list can render without decompressing anything.
 */
export type SlotKind = "auto" | "manual";

export interface SaveRecord {
  id: string;
  kind: SlotKind;
  /** Game time of the save, for display. */
  gameTime: number;
  seed: string;
  /** Real time written, epoch ms. */
  savedAt: number;
  data: Uint8Array;
}

export type SaveSummary = Omit<SaveRecord, "data">;

const DB_NAME = "black-gold";
const STORE = "saves";

let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open save storage"));
  });
  dbPromise.catch(() => (dbPromise = undefined));
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error("Save storage failed"));
        tx.onabort = () => reject(tx.error ?? new Error("Save storage was aborted"));
      }),
  );
}

export const saveStore = {
  put: (record: SaveRecord) => run("readwrite", (s) => s.put(record)).then(() => undefined),
  get: (id: string) => run<SaveRecord | undefined>("readonly", (s) => s.get(id)),
  delete: (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined),
  async list(): Promise<SaveSummary[]> {
    const all = await run<SaveRecord[]>("readonly", (s) => s.getAll());
    return all
      .map(({ data: _data, ...summary }) => summary)
      .sort((a, b) => b.savedAt - a.savedAt);
  },
};

/** Three rolling autosave slots, chosen by month so the newest overwrites the oldest. */
export const AUTOSAVE_SLOTS = 3;
export function autosaveId(monthIndex: number): string {
  return `auto-${((monthIndex % AUTOSAVE_SLOTS) + AUTOSAVE_SLOTS) % AUTOSAVE_SLOTS}`;
}
