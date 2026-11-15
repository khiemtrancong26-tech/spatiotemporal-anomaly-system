/** Explicitly experimental profiles/features; no API, jobs, persistence or training. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Reading } from '@pm25/shared-core/contracts';
import { runStatisticalAdapter } from '../src/engines/statistical.js';
import { createIsolationForestAdapter } from '../src/engines/isolation-forest.js';
import { experimentalPolicy } from '../../shared-core/tests/experimental-policies.js';
import { isolationOptions, manifest } from '../tests/engine-integration.helpers.js';

const readings: Reading[] = [...Array.from({ length: 21 }, (_, index) => index % 3 + 1), 100].map((value, index) => ({
  id: `integration-reading-${index}`, datasetId: 'SYNTHETIC-INTEGRATION-ONLY', sensorId: 'station-A',
  ts: new Date(Date.UTC(2026, 10, 15) + index * 1000).toISOString(), value, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] },
}));
const statistics = [];
for (const method of ['zscore', 'iqr', 'moving_avg'] as const) {
  const started = performance.now();
  const config = method === 'iqr' ? { multiplier: 1.5 as const } : method === 'moving_avg' ? { threshold: 3, windowSize: 3 } : { threshold: 3 };
  const evaluation = runStatisticalAdapter({ method, readings, config }, experimentalPolicy(method));
  statistics.push({ method, config, engineVersion: evaluation.engineVersion, policyId: evaluation.policyId, status: evaluation.output.status,
    results: evaluation.output.results.length, message: evaluation.output.message ?? null, candidates: evaluation.candidates, elapsedMs: performance.now() - started });
}
const before = performance.now();
const rows = readings.map((reading, index) => ({ readingId: reading.id, values: index === readings.length - 1 ? [10, 10] : [1.9, 2] }));
const ml = await createIsolationForestAdapter(isolationOptions())(readings, rows, { id: 'EXPERIMENT-ONLY/negative-decision', score: point => -point.decisionFunction });
const report = { checkedAt: new Date().toISOString(), node: process.version, purpose: 'library integration only, not B5 or detector-quality evaluation',
  profileStatus: 'explicit experiment; no production defaults/severity or API method chosen', statistical: statistics,
  ml: { manifest, engineVersion: ml.engineVersion, featureOrigin: 'Explicit synthetic upstream model vectors, NOT extracted from PM2.5 readings',
    policyId: ml.policyId, normalExample: ml.points[0], outlierExample: ml.points.at(-1), candidates: ml.candidates, elapsedMs: performance.now() - before },
  persistedAnalysisRuns: false, persistedAnomalies: false, addedApiOperations: 0 };
const output = new URL('../../docs/backend/detector-integration-results.json', import.meta.url);
await mkdir(new URL('./', output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: fileURLToPath(output), statisticalMethods: statistics.map(item => [item.method, item.status]), model: ml.modelId }));
