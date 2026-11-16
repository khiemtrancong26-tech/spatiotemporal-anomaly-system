import Dexie, { type Table } from 'dexie';
import type {
  Anomaly,
  AnalysisRun,
  Dataset,
  Reading,
  Sensor,
} from '../shared/api/generated/wire';
import type { Bbox } from '../shared/data-source/types';

export interface CacheResourceMap {
  datasets: Dataset;
  sensors: Sensor;
  readings: Reading;
  analysisRuns: AnalysisRun;
  anomalies: Anomaly;
}

export type CacheResource = keyof CacheResourceMap;

export type CachedRecord<T extends { id: string }> = T & {
  ownerScope: string;
  cachedAt: string;
  data: T;
};

export interface CachedAnomalyRecord extends CachedRecord<Anomaly> {
  reviewSyncState?: 'pending' | 'conflict' | 'rejected';
}

export interface CachedPageEdge {
  requestCursor: string | null;
  nextCursor: string | null;
}

/**
 * Coverage is local metadata, not a MongoDB collection or an API DTO.
 * `complete` means the complete cursor chain was visited for this exact query scope.
 */
export interface CacheCoverageRecord {
  ownerScope: string;
  datasetId: string;
  resource: CacheResource;
  queryKey: string;
  cachedAt: string;
  storedReadingCount: number;
  complete: boolean;
  from?: string;
  to?: string;
  bbox?: Bbox;
  sensorIds?: string[];
  pageEdges: CachedPageEdge[];
}

export interface OfflineReviewChanges {
  status?: Anomaly['status'];
  note?: string;
}

/** Exact HTTP payload fields plus local-only retry metadata. */
export interface OutboxRecord {
  ownerScope: string;
  clientMutationId: string;
  anomalyId: string;
  baseVersion: number;
  changes: OfflineReviewChanges;
  createdAt: string;
  attempts: number;
  state: 'pending' | 'conflict' | 'rejected';
  lastError?: string;
  lastAttemptAt?: string;
}

export interface StoredWorkspaceSnapshot {
  ownerScope: string;
  datasetId: string;
  savedAt: string;
  filters: {
    sensorId?: string;
    bbox?: Bbox;
    from?: string;
    to?: string;
  };
  tab: 'visualization' | 'analysis' | 'anomalies';
  selectedReadingId?: string;
  /** Reserved for later integration with the Mapbox/Three.js camera controls. */
  camera?: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    pitch?: number;
    position?: [number, number, number];
    target?: [number, number, number];
  };
  visualization?: {
    mode?: 'map' | 'cube';
    timestamp?: string;
    maxAgeHours?: number;
  };
}

export interface StoredMetaRecord {
  ownerScope: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export class PM25OfflineDatabase extends Dexie {
  datasets!: Table<CachedRecord<Dataset>, [string, string]>;
  sensors!: Table<CachedRecord<Sensor>, [string, string]>;
  readings!: Table<CachedRecord<Reading>, [string, string]>;
  analysisRuns!: Table<CachedRecord<AnalysisRun>, [string, string]>;
  anomalies!: Table<CachedAnomalyRecord, [string, string]>;
  coverage!: Table<CacheCoverageRecord, [string, string, CacheResource, string]>;
  outbox!: Table<OutboxRecord, [string, string]>;
  workspace!: Table<StoredWorkspaceSnapshot, [string, string]>;
  meta!: Table<StoredMetaRecord, [string, string]>;

  constructor() {
    super('PM25ExplorerOffline');

    this.version(1).stores({
      datasets: '&[ownerScope+id], ownerScope, [ownerScope+createdAt]',
      sensors: '&[ownerScope+id], ownerScope, [ownerScope+datasetId], [ownerScope+datasetId+externalId]',
      readings: '&[ownerScope+id], ownerScope, [ownerScope+datasetId], [ownerScope+datasetId+ts], [ownerScope+datasetId+sensorId+ts], [ownerScope+datasetId+sensorId]',
      analysisRuns: '&[ownerScope+id], ownerScope, [ownerScope+datasetId], [ownerScope+datasetId+createdAt]',
      anomalies: '&[ownerScope+id], ownerScope, [ownerScope+datasetId], [ownerScope+datasetId+analysisRunId], [ownerScope+datasetId+ts]',
      coverage: '&[ownerScope+datasetId+resource+queryKey], [ownerScope+datasetId+resource]',
      outbox: '&[ownerScope+clientMutationId], [ownerScope+anomalyId], [ownerScope+state+createdAt]',
      workspace: '&[ownerScope+datasetId]',
      meta: '&[ownerScope+key]',
    });
  }
}

export const offlineDb = new PM25OfflineDatabase();


let databaseInitialization: Promise<boolean> | undefined;

/**
 * Open IndexedDB during application bootstrap so the database exists before
 * the first authenticated API read. This does not require network access.
 * A storage failure is reported to the caller but must not prevent the app shell
 * from rendering; cache operations can still surface their own errors later.
 */
export function initializeOfflineDatabase(
  onError?: (error: unknown) => void,
): Promise<boolean> {
  if (offlineDb.isOpen()) return Promise.resolve(true);
  if (databaseInitialization) return databaseInitialization;

  databaseInitialization = offlineDb.open()
    .then(() => true)
    .catch((error: unknown) => {
      try { onError?.(error); } catch { /* Reporting must never block app startup. */ }
      return false;
    })
    .finally(() => {
      databaseInitialization = undefined;
    });

  return databaseInitialization;
}
