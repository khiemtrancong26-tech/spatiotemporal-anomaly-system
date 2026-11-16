import type { Anomaly, AnalysisRun } from '@pm25/shared-core/contracts';
export type { Anomaly } from '@pm25/shared-core/contracts';

export interface ReviewRequest {
  baseVersion: number; changes: { status?: Anomaly['status']; note?: string };
}
export interface AnomaliesQuery {
  datasetId: string; analysisRunId?: string; status?: Anomaly['status']; severity?: Anomaly['severity'];
  family?: Anomaly['family']; method?: string; from?: string; to?: string;
  sort?: string; limit?: number; cursor?: string;
}
export interface AnomalyFilters {
  datasetId: string; analysisRunId?: string; status?: Anomaly['status']; severity?: Anomaly['severity'];
  family?: AnalysisRun['family']; method?: string; from?: string; to?: string;
}
export interface AnomalyPageInput extends AnomalyFilters {
  direction: 'asc' | 'desc'; limit: number; after?: { key: string; id: string };
}
export type ReviewOutcome = { kind: 'updated'; data: Anomaly } | { kind: 'not-found' } |
  { kind: 'conflict'; currentVersion: number } | { kind: 'version-exhausted' };
