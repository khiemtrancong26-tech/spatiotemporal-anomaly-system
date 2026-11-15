import { mean, standardDeviation, sampleStandardDeviation, zScore, quantile, interquartileRange } from 'simple-statistics';
import { StatisticalDetectorInputSchema, StatisticalDetectorOutputSchema,
  type Reading, type StatisticalDetectorInput, type StatisticalDetectorOutput } from '../contracts/index.js';

export const STATISTICS_ENGINE_VERSION = 'simple-statistics@8.0.0';
type Config = Readonly<StatisticalDetectorInput['config']>;
export type Decision = { score: number; flagged: boolean; reason?: string } | { insufficient: string };
export type Facts =
  | { method: 'zscore' | 'moving_avg'; value: number; mean: number; standardDeviation: number; z: number | null; count: number }
  | { method: 'iqr'; value: number; q1: number; q3: number; iqr: number; count: number };
/** Mandatory caller policy; no implicit production grouping, reference or thresholds. */
export interface StatisticalPolicy {
  id: string;
  method: StatisticalDetectorInput['method'];
  grouping: 'sensor';
  reference: 'sensor-scope' | 'preceding-count-window';
  order: 'ts-id';
  minSamplesPerSensor: number;
  standardDeviation: 'population' | 'sample';
  onInsufficient: 'reject-scope';
  warmup: 'omit';
  validateConfig: (config: Config) => string | null;
  decide: (facts: Readonly<Facts>, config: Config) => Decision;
}
function unavailable(method: StatisticalDetectorInput['method'], status: 'invalid_input' | 'insufficient_data', message: string): StatisticalDetectorOutput {
  return { method, status, results: [], message };
}
const finite = (values: number[]) => values.every(Number.isFinite);

/** Pure synchronous library adapter. Scheduling/offloading belongs to future B5. */
export function evaluateStatistics(input: StatisticalDetectorInput, policy: StatisticalPolicy): StatisticalDetectorOutput {
  const method = ['zscore', 'iqr', 'moving_avg'].includes(input?.method) ? input.method : policy.method;
  const parsed = StatisticalDetectorInputSchema.safeParse(input);
  if (!parsed.success) return unavailable(method, 'invalid_input', 'Input does not match the shared detector contract.');
  const request = parsed.data;
  if (!policy.id || policy.method !== request.method || policy.grouping !== 'sensor' || policy.order !== 'ts-id' ||
      policy.onInsufficient !== 'reject-scope' || policy.warmup !== 'omit' || !['population', 'sample'].includes(policy.standardDeviation) ||
      !Number.isInteger(policy.minSamplesPerSensor) || policy.minSamplesPerSensor < 1 ||
      policy.reference !== (method === 'moving_avg' ? 'preceding-count-window' : 'sensor-scope')) {
    return unavailable(method, 'invalid_input', 'An explicit compatible integration policy is required.');
  }
  try {
    const configError = policy.validateConfig(request.config);
    if (configError) return unavailable(method, 'invalid_input', configError);
    const windowSize = request.config.windowSize;
    if (method === 'moving_avg' && windowSize === undefined) return unavailable(method, 'invalid_input', 'An explicit windowSize is required.');
    const groups = new Map<string, Reading[]>(), ids = new Set<string>(), keys = new Set<string>();
    let datasetId: string | undefined;
    for (const reading of request.readings) {
      const key = JSON.stringify([reading.sensorId, Date.parse(reading.ts)]);
      if ((datasetId !== undefined && reading.datasetId !== datasetId) || ids.has(reading.id) || keys.has(key)) {
        return unavailable(method, 'invalid_input', 'Readings must have one dataset and unique IDs/station instants.');
      }
      datasetId = reading.datasetId; ids.add(reading.id); keys.add(key);
      const group = groups.get(reading.sensorId) ?? []; group.push(reading); groups.set(reading.sensorId, group);
    }
    if (!groups.size) return unavailable(method, 'insufficient_data', 'No readings were supplied.');
    const results: StatisticalDetectorOutput['results'] = [];
    let warmup = 0;
    const deviation = policy.standardDeviation === 'sample' ? sampleStandardDeviation : standardDeviation;
    for (const sensorId of [...groups.keys()].sort()) {
      const group = groups.get(sensorId)!;
      group.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const required = Math.max(policy.minSamplesPerSensor, method === 'moving_avg' ? windowSize! + 1 : policy.standardDeviation === 'sample' && method !== 'iqr' ? 2 : 1);
      if (group.length < required) return unavailable(method, 'insufficient_data', 'A sensor group has insufficient data under the supplied policy.');
      const values = group.map(reading => reading.value);
      let scope: Omit<Extract<Facts, { method: 'iqr' }>, 'method' | 'value'> | { mean: number; standardDeviation: number; count: number } | undefined;
      if (method === 'iqr') {
        const q1 = quantile(values, .25), q3 = quantile(values, .75), iqr = interquartileRange(values);
        if (!finite([q1, q3, iqr])) return unavailable(method, 'invalid_input', 'Library produced non-finite statistics.');
        scope = { q1, q3, iqr, count: values.length };
      } else if (method === 'zscore') {
        const center = mean(values), spread = deviation(values);
        if (!finite([center, spread])) return unavailable(method, 'invalid_input', 'Library produced non-finite statistics.');
        scope = { mean: center, standardDeviation: spread, count: values.length };
      }
      for (let index = 0; index < group.length; index++) {
        const reading = group[index]!;
        if (method === 'moving_avg' && index < windowSize!) { warmup++; continue; }
        let facts: Facts;
        if (method === 'iqr') facts = { method, value: reading.value, ...scope as Omit<Extract<Facts, { method: 'iqr' }>, 'method' | 'value'> };
        else {
          const reference = method === 'moving_avg' ? values.slice(index - windowSize!, index) : undefined;
          const summary = reference ? { mean: mean(reference), standardDeviation: deviation(reference), count: reference.length }
            : scope as { mean: number; standardDeviation: number; count: number };
          if (!finite([summary.mean, summary.standardDeviation])) return unavailable(method, 'invalid_input', 'Library produced non-finite statistics.');
          const z = summary.standardDeviation === 0 ? null : zScore(reading.value, summary.mean, summary.standardDeviation);
          if (z !== null && !Number.isFinite(z)) return unavailable(method, 'invalid_input', 'Library produced a non-finite z-score.');
          facts = { method, value: reading.value, ...summary, z };
        }
        const decision = policy.decide(facts, request.config);
        if ('insufficient' in decision) return unavailable(method, 'insufficient_data', decision.insufficient);
        if (!Number.isFinite(decision.score) || typeof decision.flagged !== 'boolean') return unavailable(method, 'invalid_input', 'Policy returned an invalid result.');
        results.push({ readingId: reading.id, method, score: decision.score, flagged: decision.flagged,
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}) });
      }
    }
    const output = { method, status: 'completed' as const, results, ...(warmup ? { message: `${warmup} warmup readings omitted under the explicit policy.` } : {}) };
    return StatisticalDetectorOutputSchema.parse(output);
  } catch { return unavailable(method, 'invalid_input', 'Library or integration policy could not evaluate this input.'); }
}
