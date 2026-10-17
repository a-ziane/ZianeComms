export interface DeviceStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}
let database: Promise<IDBDatabase> | undefined;
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('zianecomms-offline-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('items');
    request.onerror = () => { database = undefined; reject(Error('Device storage unavailable. Nothing was saved locally.')); };
    request.onblocked = () => { database = undefined; reject(Error('Close other ZianeComms tabs to enable device storage.')); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  });
  return database;
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', mode), request = operation(tx.objectStore('items'));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onabort = tx.onerror = () => reject(Error('Device storage failed. Keep this page open and retry.'));
  });
}
export const deviceStore: DeviceStore = {
  get: <T>(key: string) => transaction<T | undefined>('readonly', s => s.get(key)),
  put: async (key, value) => { await transaction('readwrite', s => s.put(value, key)); },
  remove: async key => { await transaction('readwrite', s => s.delete(key)); },
};
// Shared across tabs when supported; server mutation IDs still guard duplicate delivery.
export async function withDeviceLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(`ziane-${name}`, work) : work();
}
