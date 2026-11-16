import Dexie from 'dexie';
import type {
  Anomaly,
  AnalysisRun,
  Dataset,
  Reading,
  Sensor,
} from '../shared/api/generated/wire';
import {
  offlineDb,
  type CacheCoverageRecord,
  type CacheResource,
  type CacheResourceMap,
  type CachedAnomalyRecord,
} from './database';
import { queryFingerprint } from './pagination';

export type CacheRow = CacheResourceMap[CacheResource];

export interface CachePageInput {
  ownerScope: string;
  resource: CacheResource;
  query: Record<string, unknown>;
  rows: CacheRow[];
  nextCursor: string | null;
  cachedAt?: Date;
}

export type CacheDetailInput = {
  [K in Exclude<CacheResource, 'datasets'>]: {
    resource: K;
    row: CacheResourceMap[K];
  };
}[Exclude<CacheResource, 'datasets'>];

function completeCursorChain(edges: CacheCoverageRecord['pageEdges']): boolean {
  const visited = new Set<string>();
  let requestCursor: string | null = null;
  for (let count = 0; count <= edges.length; count++) {
    const page = edges.find((entry) => entry.requestCursor === requestCursor);
    if (!page) return false;
    if (page.nextCursor === null) return true;
    if (visited.has(page.nextCursor)) return false;
    visited.add(page.nextCursor);
    requestCursor = page.nextCursor;
  }
  return false;
}

function datasetKey(resource: CacheResource, query: Record<string, unknown>): string {
  if (resource === 'datasets') return '__all_datasets__';
  return typeof query.datasetId === 'string' ? query.datasetId : '__unknown_dataset__';
}

async function countReadings(ownerScope: string, datasetId: string): Promise<number> {
  return offlineDb.readings
    .where('[ownerScope+datasetId]')
    .equals([ownerScope, datasetId])
    .count();
}

async function countRows(
  resource: CacheResource,
  ownerScope: string,
  datasetId: string,
): Promise<number> {
  switch (resource) {
    case 'datasets':
      return offlineDb.datasets.where('ownerScope').equals(ownerScope).count();
    case 'sensors':
      return offlineDb.sensors.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count();
    case 'readings':
      return countReadings(ownerScope, datasetId);
    case 'analysisRuns':
      return offlineDb.analysisRuns.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count();
    case 'anomalies':
      return offlineDb.anomalies.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count();
  }
}

async function mergeAnomalies(ownerScope: string, rows: Anomaly[], cachedAt: string): Promise<CachedAnomalyRecord[]> {
  const result: CachedAnomalyRecord[] = [];
  for (const row of rows) {
    const previous = await offlineDb.anomalies.get([ownerScope, row.id]);
    if (previous?.reviewSyncState === 'pending' || previous?.reviewSyncState === 'conflict' || previous?.reviewSyncState === 'rejected') {
      result.push({
        ...row,
        ownerScope,
        cachedAt,
        data: { ...row, status: previous.data.status, note: previous.data.note },
        reviewSyncState: previous.reviewSyncState,
      });
    } else {
      result.push({ ...row, ownerScope, cachedAt, data: row });
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringField(row: Record<string, unknown>, key: string): boolean {
  return typeof row[key] === 'string';
}

function hasGeoPoint(row: Record<string, unknown>): boolean {
  const location = row.location;
  if (!isRecord(location) || location.type !== 'Point' || !Array.isArray(location.coordinates)) return false;
  return location.coordinates.length === 2 && location.coordinates.every(
    (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
  );
}

/**
 * OnlineDataSource validates response envelopes against generated contracts.
 * These guards additionally ensure a row is stored in the table selected by its resource.
 */
function isDatasetRow(value: CacheRow): value is Dataset {
  if (!isRecord(value)) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'name', 'sourceFilename', 'createdBy', 'createdAt'].every((key) => isStringField(row, key)) &&
    ['uploaded', 'awaiting_mapping', 'importing', 'imported', 'failed'].includes(String(row.status));
}

function isSensorRow(value: CacheRow): value is Sensor {
  if (!isRecord(value)) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'datasetId', 'externalId', 'name'].every((key) => isStringField(row, key)) &&
    row.type === 'pm25' && row.unit === 'ug/m3' && hasGeoPoint(row);
}

function isReadingRow(value: CacheRow): value is Reading {
  if (!isRecord(value)) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'datasetId', 'sensorId', 'ts'].every((key) => isStringField(row, key)) &&
    typeof row.value === 'number' && Number.isFinite(row.value) && row.unit === 'ug/m3' && hasGeoPoint(row);
}

function isAnalysisRunRow(value: CacheRow): value is AnalysisRun {
  if (!isRecord(value)) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'datasetId', 'method', 'createdAt'].every((key) => isStringField(row, key)) &&
    (row.family === 'statistical' || row.family === 'ml') && isRecord(row.config) && isRecord(row.scope) &&
    ['queued', 'running', 'completed', 'failed'].includes(String(row.status));
}

function isAnomalyRow(value: CacheRow): value is Anomaly {
  if (!isRecord(value)) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'datasetId', 'sensorId', 'readingId', 'analysisRunId', 'ts', 'method', 'note', 'updatedAt'].every((key) => isStringField(row, key)) &&
    (row.family === 'statistical' || row.family === 'ml') && typeof row.score === 'number' && Number.isFinite(row.score) &&
    typeof row.version === 'number' && Number.isInteger(row.version) && row.version > 0 &&
    ['low', 'medium', 'high'].includes(String(row.severity)) &&
    ['open', 'confirmed', 'false_positive'].includes(String(row.status)) && hasGeoPoint(row);
}
function assertCacheRows<T extends CacheRow>(
  rows: CacheRow[],
  isExpectedRow: (value: CacheRow) => value is T,
  resource: CacheResource,
): asserts rows is T[] {
  if (!rows.every(isExpectedRow)) {
    throw new TypeError(`The ${resource} API response contains a row that does not match its cache contract.`);
  }
}

/** Store a successful API page before the DataSource resolves to the caller. */
export async function cacheSuccessfulPage(input: CachePageInput): Promise<void> {
  if (!input.ownerScope || input.rows.some((row) => !row.id)) return;
  const cachedAt = (input.cachedAt ?? new Date()).toISOString();
  const datasetId = datasetKey(input.resource, input.query);
  const queryKey = queryFingerprint(input.query);
  const requestCursor = typeof input.query.cursor === 'string' ? input.query.cursor : null;

  switch (input.resource) {
    case 'datasets': {
      const rows = input.rows;
      assertCacheRows(rows, isDatasetRow, 'datasets');
      await offlineDb.transaction('rw', offlineDb.datasets, offlineDb.coverage, async () => {
        await offlineDb.datasets.bulkPut(rows.map((row) => ({ ...row, ownerScope: input.ownerScope, cachedAt, data: row })));
        await updateCoverage(input, datasetId, queryKey, requestCursor, cachedAt);
      });
      return;
    }
    case 'sensors': {
      const rows = input.rows;
      assertCacheRows(rows, isSensorRow, 'sensors');
      await offlineDb.transaction('rw', offlineDb.sensors, offlineDb.coverage, async () => {
        await offlineDb.sensors.bulkPut(rows.map((row) => ({ ...row, ownerScope: input.ownerScope, cachedAt, data: row })));
        await updateCoverage(input, datasetId, queryKey, requestCursor, cachedAt);
      });
      return;
    }
    case 'readings': {
      const rows = input.rows;
      assertCacheRows(rows, isReadingRow, 'readings');
      await offlineDb.transaction('rw', offlineDb.readings, offlineDb.coverage, async () => {
        await offlineDb.readings.bulkPut(rows.map((row) => ({ ...row, ownerScope: input.ownerScope, cachedAt, data: row })));
        await updateCoverage(input, datasetId, queryKey, requestCursor, cachedAt);
      });
      return;
    }
    case 'analysisRuns': {
      const rows = input.rows;
      assertCacheRows(rows, isAnalysisRunRow, 'analysisRuns');
      await offlineDb.transaction('rw', offlineDb.analysisRuns, offlineDb.coverage, async () => {
        await offlineDb.analysisRuns.bulkPut(rows.map((row) => ({ ...row, ownerScope: input.ownerScope, cachedAt, data: row })));
        await updateCoverage(input, datasetId, queryKey, requestCursor, cachedAt);
      });
      return;
    }
    case 'anomalies': {
      const inputRows = input.rows;
      assertCacheRows(inputRows, isAnomalyRow, 'anomalies');
      await offlineDb.transaction('rw', offlineDb.anomalies, offlineDb.coverage, async () => {
        const rows = await mergeAnomalies(input.ownerScope, inputRows, cachedAt);
        await offlineDb.anomalies.bulkPut(rows);
        await updateCoverage(input, datasetId, queryKey, requestCursor, cachedAt);
      });
    }
  }
}

function toBbox(value: unknown): CacheCoverageRecord['bbox'] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [minLon, minLat, maxLon, maxLat] = value;
  if (![minLon, minLat, maxLon, maxLat].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) {
    return undefined;
  }
  return [minLon, minLat, maxLon, maxLat];
}

async function updateCoverage(
  input: CachePageInput,
  datasetId: string,
  queryKey: string,
  requestCursor: string | null,
  cachedAt: string,
): Promise<void> {
  const key: [string, string, CacheResource, string] = [input.ownerScope, datasetId, input.resource, queryKey];
  const previous = await offlineDb.coverage.get(key);
  const edges = previous?.pageEdges.filter((edge) => edge.requestCursor !== requestCursor) ?? [];
  edges.push({ requestCursor, nextCursor: input.nextCursor });
  const readingsCount = input.resource === 'readings' ? await countRows('readings', input.ownerScope, datasetId) : 0;
  const bbox = toBbox(input.query.bbox);
  const coverage: CacheCoverageRecord = {
    ownerScope: input.ownerScope,
    datasetId,
    resource: input.resource,
    queryKey,
    cachedAt,
    storedReadingCount: readingsCount,
    complete: completeCursorChain(edges),
    pageEdges: edges,
    ...(typeof input.query.from === 'string' ? { from: input.query.from } : {}),
    ...(typeof input.query.to === 'string' ? { to: input.query.to } : {}),
    ...(bbox ? { bbox } : {}),
    ...(typeof input.query.sensorId === 'string' ? { sensorIds: [input.query.sensorId] } : {}),
  };
  await offlineDb.coverage.put(coverage);
}

export async function cacheDetail(
  ownerScope: string,
  input: CacheDetailInput,
  cachedAt = new Date(),
): Promise<void> {
  const timestamp = cachedAt.toISOString();
  switch (input.resource) {
    case 'sensors':
      await offlineDb.sensors.put({
        ...input.row,
        ownerScope,
        cachedAt: timestamp,
        data: input.row,
      });
      return;
    case 'readings':
      await offlineDb.readings.put({
        ...input.row,
        ownerScope,
        cachedAt: timestamp,
        data: input.row,
      });
      return;
    case 'analysisRuns':
      await offlineDb.analysisRuns.put({
        ...input.row,
        ownerScope,
        cachedAt: timestamp,
        data: input.row,
      });
      return;
    case 'anomalies': {
      const anomaly = input.row;
      const previous = await offlineDb.anomalies.get([ownerScope, anomaly.id]);
      const data = previous?.reviewSyncState
        ? { ...anomaly, status: previous.data.status, note: previous.data.note }
        : anomaly;
      await offlineDb.anomalies.put({
        ...anomaly,
        ownerScope,
        cachedAt: timestamp,
        data,
        ...(previous?.reviewSyncState ? { reviewSyncState: previous.reviewSyncState } : {}),
      });
      return;
    }
  }
}


export async function getCachedAnomalyRecord(ownerScope: string, anomalyId: string): Promise<CachedAnomalyRecord | undefined> {
  return offlineDb.anomalies.get([ownerScope, anomalyId]);
}

export async function updateCachedAnomalyFromServer(ownerScope: string, anomaly: Anomaly): Promise<void> {
  await offlineDb.anomalies.put({
    ...anomaly,
    ownerScope,
    cachedAt: new Date().toISOString(),
    data: anomaly,
  });
}

export async function getCachedRows(
  ownerScope: string,
  resource: CacheResource,
  datasetId?: string,
): Promise<Array<Dataset | Sensor | Reading | AnalysisRun | Anomaly>> {
  switch (resource) {
    case 'datasets':
      return (await offlineDb.datasets.where('ownerScope').equals(ownerScope).toArray()).map(({ data }) => data);
    case 'sensors':
      return (await offlineDb.sensors.where('[ownerScope+datasetId]').equals([ownerScope, datasetId ?? '']).toArray()).map(({ data }) => data);
    case 'readings':
      return (await offlineDb.readings.where('[ownerScope+datasetId]').equals([ownerScope, datasetId ?? '']).toArray()).map(({ data }) => data);
    case 'analysisRuns':
      return (await offlineDb.analysisRuns.where('[ownerScope+datasetId]').equals([ownerScope, datasetId ?? '']).toArray()).map(({ data }) => data);
    case 'anomalies':
      return (await offlineDb.anomalies.where('[ownerScope+datasetId]').equals([ownerScope, datasetId ?? '']).toArray()).map(({ data }) => data);
  }
}

export async function getCachedDetail<T extends { id: string }>(
  resource: Exclude<CacheResource, 'datasets'> | 'datasets',
  ownerScope: string,
  id: string,
): Promise<T | undefined> {
  switch (resource) {
    case 'datasets': return (await offlineDb.datasets.get([ownerScope, id]))?.data as T | undefined;
    case 'sensors': return (await offlineDb.sensors.get([ownerScope, id]))?.data as T | undefined;
    case 'readings': return (await offlineDb.readings.get([ownerScope, id]))?.data as T | undefined;
    case 'analysisRuns': return (await offlineDb.analysisRuns.get([ownerScope, id]))?.data as T | undefined;
    case 'anomalies': return (await offlineDb.anomalies.get([ownerScope, id]))?.data as T | undefined;
  }
}

export async function getCoverage(
  ownerScope: string,
  resource: CacheResource,
  query: Record<string, unknown>,
): Promise<CacheCoverageRecord | undefined> {
  return offlineDb.coverage.get([
    ownerScope,
    datasetKey(resource, query),
    resource,
    queryFingerprint(query),
  ]);
}

export interface DatasetCacheSummary {
  datasetId: string;
  sensors: number;
  readings: number;
  analysisRuns: number;
  anomalies: number;
  completeScopes: number;
  incompleteScopes: number;
  latestCachedAt: string | undefined;
}

export async function getDatasetCacheSummary(ownerScope: string, datasetId: string): Promise<DatasetCacheSummary> {
  const [sensors, readings, analysisRuns, anomalies, coverages] = await Promise.all([
    offlineDb.sensors.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count(),
    offlineDb.readings.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count(),
    offlineDb.analysisRuns.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count(),
    offlineDb.anomalies.where('[ownerScope+datasetId]').equals([ownerScope, datasetId]).count(),
    offlineDb.coverage.where('[ownerScope+datasetId+resource]').between(
      [ownerScope, datasetId, Dexie.minKey],
      [ownerScope, datasetId, Dexie.maxKey],
    ).toArray(),
  ]);
  return {
    datasetId,
    sensors,
    readings,
    analysisRuns,
    anomalies,
    completeScopes: coverages.filter((entry) => entry.complete).length,
    incompleteScopes: coverages.filter((entry) => !entry.complete).length,
    latestCachedAt: coverages.length > 0
      ? coverages.reduce((latest, current) => current.cachedAt > latest.cachedAt ? current : latest).cachedAt
      : undefined,
  };
}
