import type * as W from '../shared/api/generated/wire';
import { DataSourceError } from '../shared/api/errors';
import type {
  OnlineDataSource,
  ReadingsQuery,
  RequestOptions,
  SensorsQuery,
} from '../shared/data-source/types';
import type { AnomaliesQuery } from '../shared/api/generated/wire';
import {
  cacheDetail,
  type DatasetCacheSummary,
  cacheSuccessfulPage,
  getCachedDetail,
  getCachedRows,
  getCoverage,
  getDatasetCacheSummary,
  updateCachedAnomalyFromServer,
} from './cache-repository';
import type { CacheResource, CacheResourceMap } from './database';
import { makeLocalPage, queryFingerprint, canUseOfflineFallback } from './pagination';
import { listPendingOutbox, queueOfflineReviewMutation } from './outbox-repository';
import type { OfflineReviewChanges, OutboxRecord } from './database';

export interface OfflineCacheAccess {
  getCoverage(resource: CacheResource, query: Record<string, unknown>): ReturnType<typeof getCoverage>;
  getDatasetSummary(datasetId: string): Promise<DatasetCacheSummary>;
}

export interface OfflineReviewAccess {
  queue(anomalyId: string, changes: OfflineReviewChanges): ReturnType<typeof queueOfflineReviewMutation>;
  listPending(): Promise<OutboxRecord[]>;
}

export interface OfflineDataSource extends OnlineDataSource {
  offlineCache: OfflineCacheAccess;
  offlineReviews: OfflineReviewAccess;
}


export interface OfflineDataSourceOptions {
  online: OnlineDataSource;
  /** Public user ID; cached rows are isolated by this value. Undefined means not cacheable. */
  getOwnerScope: () => string | undefined;
  onCacheError?: (error: unknown) => void;
}

type Page<T> = { data: T[]; page: { limit: number; nextCursor: string | null } };
type QueryBase = { cursor?: string; limit?: number; datasetId?: string };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchesBbox(location: { coordinates: number[] }, bbox?: readonly [number, number, number, number]): boolean {
  if (!bbox) return true;
  const [longitude, latitude] = location.coordinates;
  return longitude >= bbox[0] && longitude <= bbox[2] && latitude >= bbox[1] && latitude <= bbox[3];
}

function withinTimeRange(timestamp: string, from?: string, to?: string): boolean {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  if (from && value < Date.parse(from)) return false;
  if (to && value > Date.parse(to)) return false;
  return true;
}

function orderRows<T>(rows: T[], sort: string | undefined, getValue: (row: T) => string, defaultSort: string): T[] {
  const direction = (sort ?? defaultSort).endsWith(':desc') ? -1 : 1;
  return rows.sort((left, right) => direction * compareText(getValue(left), getValue(right)));
}

function filterSensors(rows: W.Sensor[], query: SensorsQuery): W.Sensor[] {
  const filtered = rows.filter((row) => row.datasetId === query.datasetId && matchesBbox(row.location, query.bbox));
  return orderRows(filtered, query.sort, (row) => `${row.externalId}\u0000${row.id}`, 'externalId:asc');
}

function filterReadings(rows: W.Reading[], query: ReadingsQuery): W.Reading[] {
  const filtered = rows.filter((row) => row.datasetId === query.datasetId &&
    (!query.sensorId || row.sensorId === query.sensorId) &&
    matchesBbox(row.location, query.bbox) &&
    withinTimeRange(row.ts, query.from, query.to));
  return orderRows(filtered, query.sort, (row) => `${row.ts}\u0000${row.id}`, 'ts:asc');
}

function filterAnomalies(rows: W.Anomaly[], query: AnomaliesQuery): W.Anomaly[] {
  const filtered = rows.filter((row) => row.datasetId === query.datasetId &&
    (!query.analysisRunId || row.analysisRunId === query.analysisRunId) &&
    (!query.status || row.status === query.status) &&
    (!query.severity || row.severity === query.severity) &&
    (!query.family || row.family === query.family) &&
    (!query.method || row.method === query.method) &&
    withinTimeRange(row.ts, query.from, query.to));
  return orderRows(filtered, query.sort, (row) => `${row.ts}\u0000${row.id}`, 'ts:asc');
}

function filterDatasets(rows: W.Dataset[], query: W.DatasetsQuery): W.Dataset[] {
  return orderRows(rows, query.sort, (row) => `${row.createdAt}\u0000${row.id}`, 'createdAt:desc');
}

function filterAnalysisRuns(rows: W.AnalysisRun[], query: W.AnalysisRunsQuery): W.AnalysisRun[] {
  const filtered = rows.filter((row) => row.datasetId === query.datasetId);
  return orderRows(filtered, query.sort, (row) => `${row.createdAt}\u0000${row.id}`, 'createdAt:desc');
}

function isDataSourceError(error: unknown): error is DataSourceError {
  return error instanceof DataSourceError;
}

async function cachePageSafely<R extends CacheResource>(
  options: OfflineDataSourceOptions,
  resource: R,
  query: Record<string, unknown>,
  page: Page<CacheResourceMap[R]>,
): Promise<void> {
  const ownerScope = options.getOwnerScope();
  if (!ownerScope) return;
  try {
    await cacheSuccessfulPage({
      ownerScope,
      resource,
      query,
      rows: page.data,
      nextCursor: page.page.nextCursor,
    });
  } catch (error) {
    options.onCacheError?.(error);
    // A local storage/quota failure must not turn a successful online API read into a failed read.
  }
}

async function readLocalPage<T extends { id: string }, Q extends QueryBase>(args: {
  ownerScope: string;
  resource: CacheResource;
  query: Q;
  rows: T[];
  filteredRows: T[];
  defaultLimit: number;
}): Promise<Page<T>> {
  const queryRecord = args.query as Record<string, unknown>;
  const coverage = await getCoverage(args.ownerScope, args.resource, queryRecord);
  if (args.filteredRows.length === 0 && !coverage?.complete) {
    throw new DataSourceError('network', 'No cached data is available for this query.');
  }
  const key = queryFingerprint(queryRecord);
  return makeLocalPage({
    rows: args.filteredRows,
    query: args.query,
    queryKey: key,
    defaultLimit: args.defaultLimit,
  });
}

function createPageLoader<
  Resource extends CacheResource,
  T extends CacheResourceMap[Resource],
  Q extends QueryBase,
  R extends Page<T>,
>(args: {
  options: OfflineDataSourceOptions;
  resource: Resource;
  online: (query: Q, requestOptions?: RequestOptions) => Promise<R>;
  cachedRows: (ownerScope: string, query: Q) => Promise<T[]>;
  filteredRows: (rows: T[], query: Q) => T[];
  defaultLimit: number;
}) {
  return async (query: Q, requestOptions?: RequestOptions): Promise<R> => {
    try {
      const page = await args.online(query, requestOptions);
      await cachePageSafely(args.options, args.resource, query as Record<string, unknown>, page);
      return page;
    } catch (error) {
      if (!canUseOfflineFallback(error) || !isDataSourceError(error)) throw error;
      const ownerScope = args.options.getOwnerScope();
      if (!ownerScope) throw error;
      try {
        const rows = await args.cachedRows(ownerScope, query);
        const filtered = args.filteredRows(rows, query);
        return await readLocalPage({
          ownerScope,
          resource: args.resource,
          query,
          rows,
          filteredRows: filtered,
          defaultLimit: args.defaultLimit,
        }) as R;
      } catch {
        throw error;
      }
    }
  };
}

export function createOfflineDataSource(options: OfflineDataSourceOptions): OfflineDataSource {
  const online = options.online;

  const datasetsList = createPageLoader<'datasets', W.Dataset, W.DatasetsQuery, W.DatasetPage>({
    options,
    resource: 'datasets',
    online: (query, requestOptions) => online.datasets.list(query, requestOptions),
    cachedRows: async (ownerScope) => await getCachedRows(ownerScope, 'datasets') as W.Dataset[],
    filteredRows: filterDatasets,
    defaultLimit: 100,
  });

  const sensorsList = createPageLoader<'sensors', W.Sensor, SensorsQuery, W.SensorPage>({
    options,
    resource: 'sensors',
    online: (query, requestOptions) => online.sensors.list(query, requestOptions),
    cachedRows: async (ownerScope, query) => await getCachedRows(ownerScope, 'sensors', query.datasetId) as W.Sensor[],
    filteredRows: filterSensors,
    defaultLimit: 100,
  });

  const readingsList = createPageLoader<'readings', W.Reading, ReadingsQuery, W.ReadingPage>({
    options,
    resource: 'readings',
    online: (query, requestOptions) => online.readings.list(query, requestOptions),
    cachedRows: async (ownerScope, query) => await getCachedRows(ownerScope, 'readings', query.datasetId) as W.Reading[],
    filteredRows: filterReadings,
    defaultLimit: 100,
  });

  const analysisList = createPageLoader<'analysisRuns', W.AnalysisRun, W.AnalysisRunsQuery, W.AnalysisRunPage>({
    options,
    resource: 'analysisRuns',
    online: (query, requestOptions) => online.analysis.list(query, requestOptions),
    cachedRows: async (ownerScope, query) => await getCachedRows(ownerScope, 'analysisRuns', query.datasetId) as W.AnalysisRun[],
    filteredRows: filterAnalysisRuns,
    defaultLimit: 100,
  });

  const anomaliesList = createPageLoader<'anomalies', W.Anomaly, AnomaliesQuery, W.AnomalyPage>({
    options,
    resource: 'anomalies',
    online: (query, requestOptions) => online.anomalies.list(query, requestOptions),
    cachedRows: async (ownerScope, query) => await getCachedRows(ownerScope, 'anomalies', query.datasetId) as W.Anomaly[],
    filteredRows: filterAnomalies,
    defaultLimit: 100,
  });

  return {
    ...online,
    datasets: { ...online.datasets, list: datasetsList },
    sensors: { ...online.sensors, list: sensorsList },
    readings: { ...online.readings, list: readingsList },
    analysis: {
      ...online.analysis,
      list: analysisList,
      async get(id, requestOptions) {
        try {
          const row = await online.analysis.get(id, requestOptions);
          const ownerScope = options.getOwnerScope();
          if (ownerScope) {
            try { await cacheDetail(ownerScope, { resource: 'analysisRuns', row }); }
            catch (error) { options.onCacheError?.(error); }
          }
          return row;
        } catch (error) {
          if (!canUseOfflineFallback(error) || !isDataSourceError(error)) throw error;
          const ownerScope = options.getOwnerScope();
          if (!ownerScope) throw error;
          const cached = await getCachedDetail<W.AnalysisRun>('analysisRuns', ownerScope, id).catch(() => undefined);
          if (!cached) throw error;
          return cached;
        }
      },
    },
    anomalies: {
      ...online.anomalies,
      list: anomaliesList,
      async get(id, requestOptions) {
        try {
          const row = await online.anomalies.get(id, requestOptions);
          const ownerScope = options.getOwnerScope();
          if (ownerScope) {
            try {
              await cacheDetail(ownerScope, { resource: 'anomalies', row });
              // If a local review is queued, return the optimistic local review while preserving its server version.
              const cached = await getCachedDetail<W.Anomaly>('anomalies', ownerScope, id);
              if (cached) return cached;
            } catch (error) { options.onCacheError?.(error); }
          }
          return row;
        } catch (error) {
          if (!canUseOfflineFallback(error) || !isDataSourceError(error)) throw error;
          const ownerScope = options.getOwnerScope();
          if (!ownerScope) throw error;
          const cached = await getCachedDetail<W.Anomaly>('anomalies', ownerScope, id).catch(() => undefined);
          if (!cached) throw error;
          return cached;
        }
      },
      async review(id, input, requestOptions) {
        const result = await online.anomalies.review(id, input, requestOptions);
        const ownerScope = options.getOwnerScope();
        if (ownerScope) {
          try { await updateCachedAnomalyFromServer(ownerScope, result); }
          catch (error) { options.onCacheError?.(error); }
        }
        return result;
      },
    },
    offlineCache: {
      getCoverage: (resource, query) => {
        const ownerScope = options.getOwnerScope();
        return ownerScope ? getCoverage(ownerScope, resource, query) : Promise.resolve(undefined);
      },
      getDatasetSummary: (datasetId) => {
        const ownerScope = options.getOwnerScope();
        return ownerScope
          ? getDatasetCacheSummary(ownerScope, datasetId)
          : Promise.resolve({ datasetId, sensors: 0, readings: 0, analysisRuns: 0, anomalies: 0, completeScopes: 0, incompleteScopes: 0, latestCachedAt: undefined });
      },
    },
    offlineReviews: {
      queue: (anomalyId, changes) => {
        const ownerScope = options.getOwnerScope();
        if (!ownerScope) throw new Error('Cần có tài khoản đã xác thực để lưu review offline.');
        return queueOfflineReviewMutation(ownerScope, anomalyId, changes);
      },
      listPending: () => {
        const ownerScope = options.getOwnerScope();
        return ownerScope ? listPendingOutbox(ownerScope) : Promise.resolve([]);
      },
    },
  };
}
