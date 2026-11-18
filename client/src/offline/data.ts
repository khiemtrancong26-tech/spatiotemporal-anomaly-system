import { DataSourceError } from '../shared/api/errors';
import type { Anomaly, AnomalyPage, AnomaliesQuery, Reading, Sensor, SensorPage } from '../shared/api/generated/wire';
import type { Bbox, OnlineDataSource, ReadingPage, ReadingsQuery, RequestOptions, SensorsQuery } from '../shared/data-source/types';
import type { CacheEntry, CacheKind, OfflineStorage } from './storage';

export const unavailable = (error: unknown) => error instanceof DataSourceError &&
  (error.kind === 'network' || ([502, 503, 504].includes(error.status ?? 0) &&
    !['EXPLORATION_BUSY', 'EXPLORATION_TIMEOUT'].includes(error.error?.code ?? '')));
export const analysisOfflineMessage = 'Cần kết nối Backend để chạy phân tích mới';
const missing = () => new DataSourceError('offline', 'Chưa có dữ liệu được lưu để sử dụng offline.');
const failedStorage = () => new DataSourceError('offline', 'Không đọc được dữ liệu offline từ IndexedDB.');
type Query = Record<string, unknown>;
type Account = { id: string; revision: number };
type Page<T> = { data: T[]; page: { limit: number; nextCursor: string | null } };
type PageQuery = { sort?: string; limit?: number; cursor?: string };
type Point = { location: { coordinates: readonly number[] } };

function inBox(item: Point, bbox?: Bbox) {
  const [lon, lat] = item.location.coordinates;
  return !bbox || (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]);
}
const from = (q: { from?: string }) => q.from ? Date.parse(q.from) : -Infinity;
const to = (q: { to?: string }) => q.to ? Date.parse(q.to) : Infinity;
const covers = (saved: ReadingsQuery, q: ReadingsQuery) =>
  (!saved.sensorId || saved.sensorId === q.sensorId) && (!saved.bbox ||
    Boolean(q.bbox && saved.bbox[0] <= q.bbox[0] && saved.bbox[1] <= q.bbox[1] && saved.bbox[2] >= q.bbox[2] && saved.bbox[3] >= q.bbox[3])) &&
  from(saved) <= from(q) && to(saved) >= to(q);

function compare(a: string, b: string) { return a === b ? 0 : a < b ? -1 : 1; }
function localPage<T extends { id: string }>(rows: T[], q: PageQuery, field: (row: T) => string): Page<T> {
  const limit = q.limit ?? 100;
  const match = /^local:(\d+)$/.exec(q.cursor ?? '');
  if (q.cursor && !match) throw missing();
  const offset = match ? Number(match[1]) : 0;
  rows.sort((a, b) => (compare(field(a), field(b)) || compare(a.id, b.id)) * (q.sort?.endsWith(':desc') ? -1 : 1));
  return { data: rows.slice(offset, offset + limit), page: { limit, nextCursor: offset + limit < rows.length ? `local:${offset + limit}` : null } };
}

export function cachedReadings(entries: CacheEntry[], query: ReadingsQuery) {
  const rows = new Map<string, Reading>();
  const chains = new Map<string, Map<string, string | null>>();
  let pages = 0;
  for (const entry of entries) {
    const saved = entry.query as ReadingsQuery;
    const page = entry.value as ReadingPage;
    const covering = covers(saved, query);
    let contributes = covering;
    for (const row of page.data) {
      if (row.datasetId === query.datasetId && (!query.sensorId || row.sensorId === query.sensorId) && inBox(row, query.bbox) &&
          Date.parse(row.ts) >= from(query) && Date.parse(row.ts) <= to(query)) {
        rows.set(row.id, row);
        contributes = true;
      }
    }
    if (contributes) pages++;
    if (covering) {
      const key = JSON.stringify([saved.sensorId ?? null, saved.bbox ?? null, saved.from ?? null, saved.to ?? null, saved.sort, saved.limit]);
      const chain = chains.get(key) ?? new Map<string, string | null>();
      chain.set(saved.cursor ?? '', page.page.nextCursor);
      chains.set(key, chain);
    }
  }
  const complete = [...chains.values()].some(chain => {
    let cursor: string | null | undefined = '';
    const seen = new Set<string>();
    while (typeof cursor === 'string' && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = chain.get(cursor);
    }
    return cursor === null;
  });
  const coverage: 'complete' | 'partial' | 'missing' = complete ? 'complete' : rows.size ? 'partial' : 'missing';
  return { rows: [...rows.values()], pages, coverage };
}

export async function cachedAnomalies(storage: OfflineStorage, user: string, dataset?: string) {
  const [pages, details] = await Promise.all([storage.list(user, 'anomalies', dataset), storage.list(user, 'anomaly', dataset)]);
  const unique = new Map<string, Anomaly>();
  for (const item of [...pages.flatMap(page => (page.value as AnomalyPage).data), ...details.map(entry => entry.value as Anomaly)]) {
    const previous = unique.get(item.id);
    if (!previous || previous.version <= item.version) unique.set(item.id, item);
  }
  return [...unique.values()];
}

export function createCachedDataSource(api: OnlineDataSource, storage: OfflineStorage, state: {
  account: () => Account | undefined; isOffline: () => boolean; connectionLost: () => void;
  storageFailed: () => void; readingsStored: () => void;
}): OnlineDataSource {
  async function read<T>(kind: CacheKind, dataset: string, query: Query, opts: RequestOptions | undefined,
    online: () => Promise<T>, local?: (user: string) => Promise<T | undefined>, datasetOf?: (value: T) => string): Promise<T> {
    const user = state.account();
    if (!user) return online();
    const verify = () => {
      if (opts?.signal?.aborted || user.revision !== state.account()?.revision || user.id !== state.account()?.id)
        throw new DataSourceError('aborted', 'Read belongs to an earlier session');
    };
    if (!state.isOffline() && !(typeof query.cursor === 'string' && query.cursor.startsWith('local:'))) {
      try {
        const value = await online();
        verify();
        if (dataset && value && typeof value === 'object') {
          const items: unknown[] = 'data' in value && Array.isArray(value.data) ? value.data : [value];
          if (items.some(item => !item || typeof item !== 'object' || !('datasetId' in item) || item.datasetId !== dataset))
            throw new DataSourceError('invalid-response', 'Response differs from requested dataset.');
        }
        try {
          await storage.put(user.id, kind, datasetOf?.(value) ?? dataset, query, value);
          if (kind === 'readings') state.readingsStored();
        } catch { state.storageFailed(); }
        verify();
        return value;
      } catch (error) {
        if (!unavailable(error)) throw error;
        verify();
        state.connectionLost();
      }
    }
    verify();
    let value: T | undefined;
    try {
      value = local ? await local(user.id) : (await storage.get(user.id, kind, dataset, query))?.value as T | undefined;
    } catch (error) {
      if (error instanceof DataSourceError) throw error;
      state.storageFailed();
      throw failedStorage();
    }
    verify();
    if (value === undefined) throw missing();
    return value;
  }

  function readings(query: ReadingsQuery, opts?: RequestOptions): Promise<ReadingPage> {
    const q = { ...query, sort: query.sort ?? 'ts:asc', limit: query.limit ?? 100 };
    return read('readings', q.datasetId, q, opts, () => api.readings.list(q, opts), async user => {
      // An in-flight online pager may have a server cursor when the connection drops.
      if (q.cursor && !q.cursor.startsWith('local:')) {
        const hit = await storage.get(user, 'readings', q.datasetId, q);
        if (!hit) return undefined;
        const page = hit.value as ReadingPage;
        const nextCursor = page.page.nextCursor;
        const hasNext = nextCursor && await storage.get(user, 'readings', q.datasetId, { ...q, cursor: nextCursor });
        return { ...page, page: { ...page.page, nextCursor: hasNext ? nextCursor : null }, localCoverage: 'partial' };
      }
      const cached = cachedReadings(await storage.list(user, 'readings', q.datasetId), q);
      if (cached.coverage === 'missing') return undefined;
      return { ...localPage(cached.rows, q, row => row.ts), localCoverage: cached.coverage };
    });
  }

  function sensors(query: SensorsQuery, opts?: RequestOptions): Promise<SensorPage> {
    const q = { sort: 'externalId:asc' as const, limit: 100, ...query };
    return read('sensors', q.datasetId, q, opts, () => api.sensors.list(q, opts), async user => {
      const entries = await storage.list(user, 'sensors', q.datasetId);
      const exact = await storage.get(user, 'sensors', q.datasetId, q);
      if (q.cursor && !q.cursor.startsWith('local:')) return exact?.value as SensorPage | undefined;
      if (!entries.length) return undefined;
      const rows = new Map<string, Sensor>();
      for (const entry of entries) for (const sensor of (entry.value as SensorPage).data) if (inBox(sensor, q.bbox)) rows.set(sensor.id, sensor);
      return rows.size || exact ? localPage([...rows.values()], q, row => row.externalId) : undefined;
    });
  }

  function anomalies(query: AnomaliesQuery, opts?: RequestOptions): Promise<AnomalyPage> {
    const q = { sort: 'ts:asc' as const, limit: 100, ...query };
    return read('anomalies', q.datasetId, q, opts, () => api.anomalies.list(q, opts), async user => {
      const exact = await storage.get(user, 'anomalies', q.datasetId, q);
      if (q.cursor && !q.cursor.startsWith('local:')) return exact?.value as AnomalyPage | undefined;
      const rows = (await cachedAnomalies(storage, user, q.datasetId)).filter(row =>
        ['analysisRunId', 'status', 'severity', 'family', 'method'].every(name => {
          const field = name as 'analysisRunId' | 'status' | 'severity' | 'family' | 'method';
          return q[field] === undefined || q[field] === row[field];
        }) && Date.parse(row.ts) >= from(q) && Date.parse(row.ts) <= to(q));
      return rows.length || exact ? localPage(rows, q, row => row.ts) : undefined;
    });
  }

  return {
    ...api,
    datasets: {
      ...api.datasets,
      list: (q, opts) => read('datasets', '', q, opts, () => api.datasets.list(q, opts)),
      profile: (id, q, opts) => read('profile', id, q, opts, () => api.datasets.profile(id, q, opts)),
    },
    sensors: { list: sensors },
    readings: { list: readings },
    aggregates: { get: (q, opts) => read('aggregates', q.datasetId, q, opts, () => api.aggregates.get(q, opts)) },
    analysis: {
      get: (id, opts) => read('run', '', { id }, opts, () => api.analysis.get(id, opts), async user => {
        const direct = (await storage.list(user, 'run')).find(entry => entry.query.id === id)?.value;
        return direct as Awaited<ReturnType<typeof api.analysis.get>> | undefined ??
          (await storage.list(user, 'runs')).flatMap(entry => (entry.value as Awaited<ReturnType<typeof api.analysis.list>>).data).find(run => run.id === id);
      }, value => value.datasetId),
      list: (q, opts) => read('runs', q.datasetId, q, opts, () => api.analysis.list(q, opts)),
      create: (body, opts) => state.isOffline() ? Promise.reject(new DataSourceError('offline', analysisOfflineMessage)) : api.analysis.create(body, opts),
    },
    anomalies: {
      list: anomalies,
      get: (id, opts) => read('anomaly', '', { id }, opts, () => api.anomalies.get(id, opts),
        async user => (await cachedAnomalies(storage, user)).find(item => item.id === id), item => item.datasetId),
      review: (id, body, opts) => read('anomaly', '', { id }, opts, () => api.anomalies.review(id, body, opts), async () => {
        throw new DataSourceError('network', 'Review response could not be confirmed');
      }, item => item.datasetId),
    },
  };
}
