import type { Reading } from '../../shared/api/generated/wire';
import type { OnlineDataSource } from '../../shared/data-source/types';
import { DataSourceError } from '../../shared/api/errors';
import { POINT_LIMIT } from './geometry';
export type SnapshotQuery = Pick<Parameters<OnlineDataSource['readings']['list']>[0], 'datasetId' | 'sensorId' | 'bbox'> & { timestamp: string };
export async function loadSnapshot(load: OnlineDataSource['readings']['list'], query: SnapshotQuery, signal: AbortSignal) {
  const rows: Reading[] = [], ids = new Set<string>(), stations = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const before = rows.length;
    const page = await load({ datasetId: query.datasetId, sensorId: query.sensorId, bbox: query.bbox,
      from: query.timestamp, to: query.timestamp, sort: 'ts:asc', limit: Math.min(100, POINT_LIMIT - rows.length), cursor }, { signal });
    signal.throwIfAborted();
    for (const row of page.data) {
      if (row.datasetId !== query.datasetId || Date.parse(row.ts) !== Date.parse(query.timestamp) || (query.sensorId && row.sensorId !== query.sensorId)) throw new DataSourceError('invalid-response', 'Snapshot response differs from requested dataset/time/station.');
      if (ids.has(row.id)) continue;
      if (stations.has(row.sensorId)) throw new DataSourceError('invalid-response', 'Multiple measurements for the same station/time.');
      ids.add(row.id); stations.add(row.sensorId); rows.push(row);
      if (rows.length > POINT_LIMIT) throw new DataSourceError('invalid-response', 'Snapshot exceeds requested point budget.');
    }
    const next = page.page.nextCursor;
    if (next && cursors.has(next)) throw new DataSourceError('invalid-response', 'Repeated snapshot cursor.');
    if (next) cursors.add(next);
    if (!next || rows.length >= POINT_LIMIT) return { rows, hasMore: Boolean(next) };
    if (rows.length === before) throw new DataSourceError('invalid-response', 'Snapshot cursor made no progress.');
    cursor = next;
  } while (cursor !== undefined);
  return {rows,hasMore:false};
}
interface SnapshotState { status: 'idle' | 'loading' | 'ready' | 'error'; timestamp?: string; rows: Reading[]; hasMore: boolean; error?: unknown }
export function createSnapshot(load: OnlineDataSource['readings']['list']) {
  let state: SnapshotState = { status:'idle', rows:[], hasMore:false }, generation = 0;
  let controller: AbortController | undefined, last: SnapshotQuery | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SnapshotState) => { state = next; listeners.forEach(fn => fn()); };
  async function read(query: SnapshotQuery) {
    const current = ++generation; controller?.abort(); const active = new AbortController(); controller = active; last = query;
    publish({ status:'loading',timestamp:query.timestamp,rows:[],hasMore:false });
    try {
      const result = await loadSnapshot(load,query,AbortSignal.any([active.signal,AbortSignal.timeout(20000)]));
      if (current === generation && !active.signal.aborted) publish({status:'ready',timestamp:query.timestamp,...result});
    } catch(error) { if (current === generation && !active.signal.aborted) publish({status:'error',timestamp:query.timestamp,rows:[],hasMore:false,error}); }
  }
  return { subscribe(fn: () => void) {listeners.add(fn);return () => {listeners.delete(fn);};}, getSnapshot:()=>state,
    read, retry:()=>last ? read(last) : Promise.resolve(), dispose() {generation++;controller?.abort();} };
}
