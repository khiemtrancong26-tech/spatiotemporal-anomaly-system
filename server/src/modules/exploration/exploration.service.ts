import type { DatasetActor } from '../datasets/dataset-access.js';
import { DatasetProfileSchema, ReadingAggregationSchema, explorationOffset, type Coverage, type ExplorationMetadata,
  type ExplorationScope, type Sampling } from '@pm25/shared-core';
import { HttpError } from '../../shared/http/errors.js';
import { parseUtcTime } from '../../shared/utc-time.js';
import { MongoNetworkError, MongoOperationTimeoutError, MongoServerSelectionError } from 'mongodb';
import type { ExplorationConfig, ExplorationQuery, ExplorationRepository, Group, QueryContext } from './exploration.types.js';

const invalid = (code: string, message: string) => new HttpError(422, code, message);
export function parseExplorationScope(q: ExplorationQuery): ExplorationScope {
  const from = parseUtcTime(q.from) ?? null, to = parseUtcTime(q.to) ?? null;
  if (from && to && from > to) throw invalid('INVALID_RANGE', 'from must not be after to.');
  if (q.sensorIds && (!q.sensorIds.length || new Set(q.sensorIds).size !== q.sensorIds.length)) throw invalid('INVALID_SENSOR_IDS', 'Sensor IDs must be nonempty and unique.');
  let bbox: ExplorationScope['bbox'] = null;
  if (q.bbox !== undefined) {
    const parts = q.bbox.split(','); const v = parts.map(Number);
    if (parts.length !== 4 || parts.some(x => !x.trim()) || !v.every(Number.isFinite) || v[0]! < -180 || v[2]! > 180 || v[1]! < -90 || v[3]! > 90 || v[0]! > v[2]! || v[1]! > v[3]!) throw invalid('INVALID_BBOX', 'Invalid WGS84 rectangle.');
    bbox = v as NonNullable<ExplorationScope['bbox']>;
  }
  return { sensorIds: q.sensorIds ? [...q.sensorIds].sort() : null, bbox, from, to };
}
export function coverage(sampling: Sampling | null, count: number, observed: number, stations: number, from?: number, to?: number): Coverage {
  if (!sampling) return { status: 'unknown', expectedSlots: null, observedSlots: null, missingSlots: null, unexpectedReadings: null, ratio: null, reason: 'Sampling cadence/anchor/expected interval is not configured.' };
  const lo = Math.max(Date.parse(sampling.expectedFrom), from ?? -Infinity), hi = Math.min(Date.parse(sampling.expectedTo), to ?? Infinity);
  const anchor = Date.parse(sampling.anchor), step = sampling.cadenceSeconds * 1000;
  const slots = Math.max(0, Math.floor((hi - anchor) / step) - Math.ceil((lo - anchor) / step) + 1) * stations;
  if (!Number.isSafeInteger(slots)) throw invalid('EXPLORATION_BUDGET_EXCEEDED', 'Expected sampling grid is too large.');
  if (observed > slots || observed > count) throw new Error('Stored sampling observations exceed the unique station/time grid');
  return { status: slots ? 'known' : 'not_applicable', expectedSlots: slots, observedSlots: observed, missingSlots: slots - observed,
    unexpectedReadings: count - observed, ratio: slots ? observed / slots : null, reason: slots ? null : 'No expected slots in this scope.' };
}
function summary(groups: Group[], stations: number, metadata: ExplorationMetadata, scope: ExplorationScope) {
  const count = groups.reduce((n, g) => n + g.count, 0), sum = groups.reduce((n, g) => n + g.sum, 0);
  return { readingCount: count, sensorCount: stations, sensorsWithReadings: groups.filter(g => g.count).length,
    observedFrom: groups.length ? new Date(Math.min(...groups.map(g => g.from))).toISOString() : null,
    observedTo: groups.length ? new Date(Math.max(...groups.map(g => g.to))).toISOString() : null,
    min: groups.length ? Math.min(...groups.map(g => g.min)) : null, max: groups.length ? Math.max(...groups.map(g => g.max)) : null,
    mean: count ? sum / count : null, coverage: coverage(metadata.sampling, count, groups.reduce((n, g) => n + g.observed, 0), stations,
      scope.from ? Date.parse(scope.from) : undefined, scope.to ? Date.parse(scope.to) : undefined) };
}
const emptyScope: ExplorationScope = { sensorIds: null, bbox: null, from: null, to: null };
export function createExplorationService(repo: ExplorationRepository, config: ExplorationConfig) {
  let running = 0;
  async function execute<T>(signal: AbortSignal | undefined, work: (ctx: QueryContext) => Promise<T>): Promise<T> {
    if (running >= config.concurrency) throw new HttpError(503, 'EXPLORATION_BUSY', 'Exploration capacity is busy. Try again later.');
    running++;
    const controller = new AbortController(), deadline = Date.now() + config.timeoutMs;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, config.timeoutMs); timer.unref();
    const ctx = { signal: controller.signal, remaining: () => { if (controller.signal.aborted || Date.now() >= deadline) throw new HttpError(503, 'EXPLORATION_TIMEOUT', 'Exploration deadline exceeded or request cancelled.'); return Math.max(1, deadline - Date.now()); } };
    try {
      ctx.remaining(); const result = await work(ctx); ctx.remaining();
      if (Buffer.byteLength(JSON.stringify(result)) > config.maxResponseBytes) throw invalid('EXPLORATION_RESPONSE_TOO_LARGE', 'Response exceeds the byte budget. Narrow the scope.');
      ctx.remaining(); return result;
    } catch (error) {
      if (controller.signal.aborted || error instanceof MongoOperationTimeoutError || (error && typeof error === 'object' && 'code' in error && [50, 262, 292].includes(Number(error.code)))) throw new HttpError(503, 'EXPLORATION_TIMEOUT', 'Exploration query budget exhausted.');
      if (error instanceof MongoNetworkError || error instanceof MongoServerSelectionError) throw new HttpError(503, 'EXPLORATION_UNAVAILABLE', 'Exploration database is unavailable or timed out.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); running--; }
  }
  async function dataset(id: string, ctx: QueryContext, actor: DatasetActor) {
    if (!/^[0-9a-f]{24}$/i.test(id)) throw invalid('DATASET_NOT_FOUND', 'Dataset does not exist.');
    const row = await repo.dataset(id, ctx, actor);
    if (!row) throw invalid('DATASET_NOT_FOUND', 'Dataset does not exist.');
    if (row.status !== 'imported') throw invalid('DATASET_NOT_READY', 'Dataset must be imported.');
    return row;
  }
  function check(groups: Group[]) { if (groups.reduce((n, g) => n + g.count, 0) > config.maxReadings) throw invalid('EXPLORATION_READING_LIMIT', 'Reading budget exceeded. Narrow the scope.'); }
  async function sensors(id: string, scope: ExplorationScope, ctx: QueryContext) {
    if (scope.sensorIds?.some(id => !/^[0-9a-f]{24}$/i.test(id))) throw invalid('SENSOR_NOT_IN_DATASET', 'Sensor does not belong to this dataset.');
    if (scope.sensorIds) {
      const ids = await repo.sensors(id, ctx, { ...scope, bbox: null });
      if (ids.length !== scope.sensorIds.length) throw invalid('SENSOR_NOT_IN_DATASET', 'Sensor does not belong to this dataset.');
    }
    return repo.sensors(id, ctx, scope);
  }
  return {
    profile: (id: string, q: ExplorationQuery, signal: AbortSignal | undefined, actor: DatasetActor) => execute(signal, async ctx => {
      const scope = parseExplorationScope(q), row = await dataset(id, ctx, actor), all = await sensors(id, emptyScope, ctx);
      const selected = await sensors(id, scope, ctx);
      const full = await repo.groups(id, all, emptyScope, row.metadata.sampling, ctx); check(full);
      const filtered = JSON.stringify(scope) === JSON.stringify(emptyScope) ? full : await repo.groups(id, selected, scope, row.metadata.sampling, ctx); check(filtered);
      await dataset(id, ctx, actor);
      const s = row.importSummary;
      return { data: DatasetProfileSchema.parse({ datasetId: id, scope, metadata: row.metadata,
        dataset: summary(full, all.length, row.metadata, emptyScope), scoped: summary(filtered, selected.length, row.metadata, scope),
        sourceQuality: { status: s ? 'known' : 'unknown', totalRows: s?.totalRows ?? null, importedRows: s?.importedRows ?? null,
          invalidRows: s?.invalidRows ?? null, duplicateRows: s?.duplicateRows ?? null, conflictingRows: s?.conflictingRows ?? null,
          missingValueRows: null, reason: 'Import report does not classify missing source values; temporal gaps are a separate measure.' }, complete: true }) };
    }),
    aggregates: (id: string, q: ExplorationQuery, signal: AbortSignal | undefined, actor: DatasetActor) => execute(signal, async ctx => {
      const scope = parseExplorationScope(q), row = await dataset(id, ctx, actor);
      if (!scope.from || !scope.to || !q.bucket) throw invalid('INVALID_RANGE', 'Aggregation requires from, to and bucket.');
      const from = Date.parse(scope.from), to = Date.parse(scope.to), size = q.bucket === 'hour' ? 3600000 : 86400000;
      if (to - from > (q.bucket === 'hour' ? 31 : 366) * 86400000) throw invalid('EXPLORATION_RANGE_LIMIT', 'Aggregation time range is too large.');
      const ids = await sensors(id, scope, ctx);
      if (ids.length > config.maxSeries) throw invalid('EXPLORATION_SERIES_LIMIT', 'Select fewer stations.');
      const zone = q.timeZone ?? row.metadata.timeZone, offset = explorationOffset(zone) * 3600000;
      const first = Math.floor((from + offset) / size) * size - offset, last = Math.floor((to + offset) / size) * size - offset;
      const length = (last - first) / size + 1;
      if (length * ids.length > config.maxCells) throw invalid('EXPLORATION_CELL_LIMIT', 'Aggregation matrix exceeds the cell budget.');
      const groups = await repo.groups(id, ids, scope, row.metadata.sampling, ctx, { size, offset }); check(groups);
      const lookup = new Map(groups.map(g => [`${g.sensorId}/${g.bucket}`, g]));
      const series = ids.map(sensorId => ({ sensorId, buckets: Array.from({ length }, (_, i) => {
        const start = first + i * size, end = start + size, g = lookup.get(`${sensorId}/${start}`), count = g?.count ?? 0;
        return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), count,
          min: g?.min ?? null, max: g?.max ?? null, mean: g ? g.sum / g.count : null,
          coverage: coverage(row.metadata.sampling, count, g?.observed ?? 0, 1, Math.max(from, start), Math.min(to, end - 1)) };
      }) }));
      await dataset(id, ctx, actor);
      return { data: ReadingAggregationSchema.parse({ datasetId: id, scope, bucket: q.bucket, timeZone: zone, metadataVersion: row.metadata.version, series, complete: true }) };
    }),
  };
}
