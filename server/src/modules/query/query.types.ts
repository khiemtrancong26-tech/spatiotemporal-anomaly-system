import type { CursorBoundary } from '../../shared/pagination.js';

export interface Point { type: 'Point'; coordinates: [number, number] }
export interface Sensor {
  id: string; datasetId: string; externalId: string; name: string;
  location: Point; type: 'pm25'; unit: 'ug/m3'; region?: string;
}
export interface Reading {
  id: string; datasetId: string; sensorId: string; ts: string;
  location: Point; value: number; unit: 'ug/m3';
}
export interface SensorsQuery { datasetId: string; bbox?: string; sort?: string; limit?: number; cursor?: string }
export interface ReadingsQuery extends SensorsQuery { sensorId?: string; from?: string; to?: string }
export type Bbox = readonly [number, number, number, number];
export interface QueryFilters { datasetId: string; bbox?: Bbox; sensorId?: string; from?: string; to?: string }
export interface PageInput extends QueryFilters { direction: 'asc' | 'desc'; limit: number; after?: CursorBoundary }
export interface QueryRepository {
  resolveSensorBoundary: (datasetId: string, after: CursorBoundary) => Promise<CursorBoundary>;
  sensorIdInDataset: (datasetId: string, sensorId: string) => Promise<string | null>;
  sensors: (input: PageInput) => Promise<Sensor[]>;
  readings: (input: PageInput) => Promise<Reading[]>;
}
