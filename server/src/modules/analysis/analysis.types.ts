import type { AnalysisRun, Reading } from '@pm25/shared-core/contracts';
import type { Candidate } from '../../engines/results.js';

export interface DetectionRequest {
  datasetId: string; family: 'statistical' | 'ml'; method: string;
  config: Record<string, unknown>; scope?: AnalysisRun['scope'];
}
export interface HistoryQuery { datasetId: string; sort?: string; limit?: number; cursor?: string }
export interface RunGuard { id: string; owner: string; attempt: number; run: AnalysisRun; policyId: string; modelHash?: string }
export interface EngineResult { candidates: Candidate[]; engineVersion: string; modelVersion?: string }
export interface AnalysisEngine {
  ready: () => Promise<void>;
  metadata: (family: DetectionRequest['family']) => { engineVersion: string; modelVersion?: string; modelHash?: string };
  run: (run: RunGuard, readings: Reading[], signal: AbortSignal) => Promise<EngineResult>;
}
/** Fault injection through composition only; main.ts never sets these hooks. */
export interface AnalysisTestHooks {
  afterAccepted?: (run: AnalysisRun) => Promise<void>;
  afterClaim?: (guard: RunGuard) => Promise<void>;
  afterBatch?: (guard: RunGuard, count: number) => Promise<void>;
}
