import type { Anomaly, OfflineReviewMutation } from '../shared/api/generated/wire';
import type { WorkspaceState } from '../features/workspace/state';

export type WorkspaceSnapshot = Pick<WorkspaceState, 'datasetId' | 'filters' | 'tab' | 'timeZone' | 'timeZoneChosen' | 'visualTime' |
  'cubeScope' | 'cubeWindowMs' | 'focusedSensorId' | 'visualMode' | 'cubeMode' | 'cubeCamera' | 'cubeRunId' | 'anomalyContext'> & { path: string };
export interface OutboxItem extends OfflineReviewMutation {
  userId: string;
  datasetId: string;
  base: Anomaly;
  state: 'pending' | 'conflict' | 'error';
  message?: string;
  server?: Anomaly;
}
export type CacheKind = 'datasets' | 'profile' | 'sensors' | 'readings' | 'aggregates' | 'runs' | 'run' | 'anomalies' | 'anomaly';
type Query = Record<string, unknown>;
export interface CacheEntry {
  key: string[];
  userId: string;
  datasetId: string;
  kind: CacheKind;
  query: Query;
  value: unknown;
  size: number;
}

const CACHE_BUDGET = 32 * 1024 * 1024;
const queryKey = (query: Query) => JSON.stringify(Object.keys(query).sort().filter(key => query[key] !== undefined).map(key => [key, query[key]]));
const entryKey = (userId: string, kind: CacheKind, datasetId: string, query: Query) => [userId, kind, datasetId, queryKey(query)];
const outboxKey = (item: Pick<OutboxItem, 'userId' | 'anomalyId'>) => [item.userId, item.anomalyId];

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createOfflineStorage(namespace: string) {
  let connection: Promise<IDBDatabase> | undefined;
  function open() {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`pm25-offline:${namespace}`, 1);
      let blocked = false;
      request.onblocked = () => { blocked = true; reject(new Error('IndexedDB is blocked')); };
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        const cache = db.createObjectStore('cache', { keyPath: 'key' });
        cache.createIndex('scope', ['userId', 'kind', 'datasetId']);
        cache.createIndex('kind', ['userId', 'kind']);
        cache.createIndex('user', 'userId');
        const outbox = db.createObjectStore('outbox', { keyPath: ['userId', 'anomalyId'] });
        outbox.createIndex('user', 'userId');
        db.createObjectStore('meta');
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = undefined; };
        db.onclose = () => { connection = undefined; };
        resolve(db);
      };
    }).catch(error => { connection = undefined; throw error; });
    return connection;
  }

  async function transact<T>(stores: string | string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = (await open()).transaction(stores, mode, mode === 'readwrite' && stores === 'outbox' ? { durability: 'strict' } : undefined);
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    void committed.catch(() => {});
    try {
      const value = await work(tx);
      await committed;
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction already ended. */ }
      throw error;
    }
  }

  return {
    async put(userId: string, kind: CacheKind, datasetId: string, query: Query, value: unknown) {
      const key = entryKey(userId, kind, datasetId, query);
      const size = JSON.stringify([key, query, value]).length * 2;
      await transact(['cache', 'meta'], 'readwrite', async tx => {
        const cache = tx.objectStore('cache'), meta = tx.objectStore('meta');
        const [previous, total] = await Promise.all([
          result<CacheEntry | undefined>(cache.get(key)), result<number | undefined>(meta.get(['budget', userId])),
        ]);
        if (kind === 'anomaly' && previous && (previous.value as Anomaly).version > (value as Anomaly).version) return;
        const next = (total ?? 0) - (previous?.size ?? 0) + size;
        if (next > CACHE_BUDGET) throw new Error('Offline cache budget exceeded');
        await result(cache.put({ key, userId, datasetId, kind, query, value, size } satisfies CacheEntry));
        await result(meta.put(next, ['budget', userId]));
      });
    },
    get: (userId: string, kind: CacheKind, datasetId: string, query: Query) => transact('cache', 'readonly', tx =>
      result<CacheEntry | undefined>(tx.objectStore('cache').get(entryKey(userId, kind, datasetId, query)))),
    list: (userId: string, kind: CacheKind, datasetId?: string) => transact('cache', 'readonly', tx =>
      result<CacheEntry[]>(datasetId === undefined ? tx.objectStore('cache').index('kind').getAll([userId, kind]) :
        tx.objectStore('cache').index('scope').getAll([userId, kind, datasetId]))),
    async clearCache(userId: string) {
      await transact(['cache', 'meta'], 'readwrite', async tx => {
        const cache = tx.objectStore('cache'), meta = tx.objectStore('meta');
        const keys = await result(cache.index('user').getAllKeys(userId));
        await Promise.all([...keys.map(key => result(cache.delete(key))),
          result(meta.delete(['workspace', userId])), result(meta.delete(['budget', userId]))]);
      });
    },
    workspace: (userId: string) => transact('meta', 'readonly', tx =>
      result<WorkspaceSnapshot | undefined>(tx.objectStore('meta').get(['workspace', userId]))),
    saveWorkspace: (userId: string, snapshot: WorkspaceSnapshot) => transact('meta', 'readwrite', tx =>
      result(tx.objectStore('meta').put(snapshot, ['workspace', userId]))),
    outbox: (userId: string) => transact('outbox', 'readonly', tx =>
      result<OutboxItem[]>(tx.objectStore('outbox').index('user').getAll(userId))),
    async enqueue(item: OutboxItem) {
      await transact('outbox', 'readwrite', tx => result(tx.objectStore('outbox').add(item)));
    },
    async settle(item: OutboxItem, replacement?: OutboxItem) {
      await transact('outbox', 'readwrite', async tx => {
        const store = tx.objectStore('outbox'), key = outboxKey(item);
        const current = await result<OutboxItem | undefined>(store.get(key));
        if (current?.clientMutationId !== item.clientMutationId || current.state !== item.state) return;
        if (replacement) await result(store.put(replacement));
        else await result(store.delete(key));
      });
    },
  };
}

export type OfflineStorage = ReturnType<typeof createOfflineStorage>;
