import type { AnalysisRun, Reading } from '@pm25/shared-core/contracts';
import type { Candidate } from '../../engines/results.js';
import type { ScoringSummary } from '@pm25/shared-core';
import type { FeatureContext } from './analysis.context.repository.js';

export interface DetectionRequest {
  datasetId: string; family: 'statistical' | 'ml'; method: string;
  config: Record<string, unknown>; scope?: AnalysisRun['scope'];
}
export interface HistoryQuery { datasetId: string; sort?: string; limit?: number; cursor?: string }
export interface AnalysisReadAccess {
  getState: (id: string) => Promise<{ id: string; datasetId: string; status: AnalysisRun['status'] } | null>;
}
export interface RunGuard { id: string; owner: string; attempt: number; run: AnalysisRun; policyId: string; modelHash?: string }
export interface EngineResult { candidates: Candidate[]; engineVersion: string; modelVersion?: string; scoringSummary?: ScoringSummary; scoredReadingIds?: string[] }
export interface RunMetadata { engineVersion: string; modelVersion?: string; modelHash?: string; policyId?: string }
export interface AnalysisEngine {
  ready: (version?: 'v1' | 'v2') => Promise<void>;
  metadata: (family: DetectionRequest['family'], version?: 'v1' | 'v2') => RunMetadata;
  run: (run: RunGuard, readings: Reading[], signal: AbortSignal, context?: FeatureContext) => Promise<EngineResult>;
}
/** Fault injection through composition only; main.ts never sets these hooks. */
export interface AnalysisTestHooks {
  afterAccepted?: (run: AnalysisRun) => Promise<void>;
  afterClaim?: (guard: RunGuard) => Promise<void>;
  afterBatch?: (guard: RunGuard, count: number) => Promise<void>;
}
