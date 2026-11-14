import type { Reading } from '@pm25/shared-core/contracts';
import { createPythonRunner, EngineError, type PythonRunnerOptions } from './python-runner.js';
import { projectCandidates, validateReadings } from './results.js';

export interface FeatureRow { readingId: string; values: number[] }
export interface IsolationPoint { readingId: string; prediction: 1 | -1; decisionFunction: number; scoreSamples: number }
export interface ScoreProjection { id: string; score: (point: Readonly<IsolationPoint>) => number }
export interface IsolationOptions extends Omit<PythonRunnerOptions, 'args'> {
  artifactPath: string; manifestPath: string; modelId: string; sklearnVersion: string; features: readonly string[];
  artifactSha256?: string;
}
export function createIsolationForestAdapter(options: IsolationOptions) {
  const run = createPythonRunner({ ...options, args: ['--manifest', options.manifestPath, '--artifact', options.artifactPath,
    ...(options.artifactSha256 ? ['--expected-sha256', options.artifactSha256, '--expected-model-id', options.modelId] : [])] });
  return async (readings: readonly Reading[], rows: readonly FeatureRow[], projection: ScoreProjection, signal?: AbortSignal) => {
    const input = validateReadings(readings), ids = new Set<string>();
    if (!rows.length || !projection.id || rows.length !== input.size) throw new EngineError('ENGINE_INPUT_INVALID', 'Explicit complete features and score projection are required.');
    for (const row of rows) {
      if (!input.has(row.readingId) || ids.has(row.readingId) || !Array.isArray(row.values) || row.values.length !== options.features.length || !row.values.every(Number.isFinite)) throw new EngineError('ENGINE_INPUT_INVALID', 'Feature rows must match scope IDs and the declared feature order.');
      ids.add(row.readingId);
    }
    const response = await run({ protocol: 1, features: [...options.features], rows }, signal);
    if (!response || typeof response !== 'object' || !('protocol' in response) || response.protocol !== 1 ||
      !('modelId' in response) || response.modelId !== options.modelId || !('sklearnVersion' in response) || response.sklearnVersion !== options.sklearnVersion ||
      !('points' in response) || !Array.isArray(response.points) || response.points.length !== rows.length) throw new EngineError('ENGINE_OUTPUT_INVALID', 'Inference response does not match the declared model/scope.');
    const seen = new Set<string>(), points: IsolationPoint[] = [];
    for (const point of response.points) {
      if (!point || typeof point !== 'object' || typeof point.readingId !== 'string' || !ids.has(point.readingId) || seen.has(point.readingId) ||
        ![1, -1].includes(point.prediction) || !Number.isFinite(point.decisionFunction) || !Number.isFinite(point.scoreSamples)) throw new EngineError('ENGINE_OUTPUT_INVALID', 'Inference response has invalid points.');
      seen.add(point.readingId); points.push({ readingId: point.readingId, prediction: point.prediction, decisionFunction: point.decisionFunction, scoreSamples: point.scoreSamples });
    }
    const candidates = projectCandidates(readings, points.map(point => ({ readingId: point.readingId, flagged: point.prediction === -1, score: projection.score(point) })));
    return { engineVersion: `scikit-learn@${options.sklearnVersion}`, modelId: options.modelId, policyId: projection.id, points, candidates };
  };
}
