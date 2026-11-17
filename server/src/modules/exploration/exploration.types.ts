import type { DatasetActor } from '../datasets/dataset-access.js';
import type { ExplorationMetadata, ExplorationScope, Sampling } from '@pm25/shared-core';
import type { ImportSummary } from '../datasets/datasets.types.js';
export interface ExplorationConfig {
  maxReadings: number; maxSeries: number; maxCells: number; maxResponseBytes: number; timeoutMs: number; concurrency: number;
}
export interface ExplorationQuery { sensorIds?: string[]; bbox?: string; from?: string; to?: string; datasetId?: string; bucket?: 'hour' | 'day'; timeZone?: 'UTC' | '+07:00' | '+08:00' }
export interface QueryContext { signal: AbortSignal; remaining: () => number }
export interface Group { sensorId: string; bucket: number; count: number; sum: number; min: number; max: number; from: number; to: number; observed: number }
export interface DatasetState { status: string; metadata: ExplorationMetadata; importSummary?: ImportSummary }
export interface ExplorationRepository {
  dataset(id: string, ctx: QueryContext, actor: DatasetActor): Promise<DatasetState | null>;
  sensors(id: string, ctx: QueryContext, scope?: ExplorationScope): Promise<string[]>;
  groups(id: string, ids: string[], scope: ExplorationScope, sampling: Sampling | null, ctx: QueryContext,
    bucket?: { size: number; offset: number }): Promise<Group[]>;
}
