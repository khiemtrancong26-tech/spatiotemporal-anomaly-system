import { evaluateStatistics, STATISTICS_ENGINE_VERSION, type StatisticalPolicy } from '@pm25/shared-core/statistics';
import type { StatisticalDetectorInput } from '@pm25/shared-core/contracts';
import { projectCandidates } from './results.js';

export function runStatisticalAdapter(input: StatisticalDetectorInput, policy: StatisticalPolicy) {
  const output = evaluateStatistics(input, policy);
  return { engineVersion: STATISTICS_ENGINE_VERSION, policyId: policy.id, output,
    candidates: output.status === 'completed' ? projectCandidates(input.readings, output.results) : [] };
}
