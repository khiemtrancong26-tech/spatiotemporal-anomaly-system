import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createPythonRunner } from '../src/engines/python-runner.js';
import { createIsolationForestAdapter } from '../src/engines/isolation-forest.js';
import { isolationOptions, manifest } from './engine-integration.helpers.js';
import type { Reading } from '@pm25/shared-core/contracts';

let directory: string;
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), 'pm25-engines-')); });
afterAll(async () => {
  if (!directory.startsWith(resolve(tmpdir()) + sep) || !directory.includes('pm25-engines-')) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
});
const readings: Reading[] = ['normal', 'outlier', 'normal2'].map((id, index) => ({ id, datasetId: 'D', sensorId: 'S',
  ts: new Date(Date.UTC(2026, 10, 15) + index * 1000).toISOString(), value: 20, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] } }));
// Explicit upstream synthetic model features, NOT a PM2.5 feature extractor.
const rows = [{ readingId: 'normal', values: [1.9, 2] }, { readingId: 'outlier', values: [10, 10] }, { readingId: 'normal2', values: [-2, -2] }];
const projection = { id: 'EXPERIMENT-ONLY/negative-decision-function', score: (point: { decisionFunction: number }) => -point.decisionFunction };
describe('actual Python/scikit-learn artifact inference', () => {
  it('loads the pinned existing artifact, preserves native scores/labels and links flagged candidates deterministically', async () => {
    const detect = createIsolationForestAdapter(isolationOptions());
    const result = await detect(readings, rows, projection), replay = await detect(readings, rows, projection);
    expect(result).toEqual(replay); expect(result.points.map(point => point.prediction)).toEqual([1, -1, 1]);
    expect(result.points[0]?.decisionFunction).toBeCloseTo(.11303433389747941, 10);
    expect(result.points[1]?.scoreSamples).toBeCloseTo(-.73539738528446, 10);
    expect(result.candidates.map(reading => reading.readingId)).toEqual(['outlier']);
    expect(result.candidates[0]).toMatchObject({ datasetId: 'D', sensorId: 'S', value: 20, location: { type: 'Point', coordinates: [106, 10] }, score: expect.closeTo(.23539738528445997, 10) });
    expect(result.engineVersion).toBe('scikit-learn@1.2.2'); expect(result.modelId).toBe(manifest.id);
    expect(result.candidates[0]).not.toHaveProperty('severity');
  }, 60000);
  it('fails closed for missing artifact, wrong feature order, integrity or runtime mismatch; never retrains/fabricates results', async () => {
    const absent = createIsolationForestAdapter(isolationOptions({ artifactPath: resolve(directory, 'missing.pkl') }));
    await expect(absent(readings, rows, projection)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    const order = createIsolationForestAdapter(isolationOptions({ features: ['x1', 'x0'] }));
    await expect(order(readings, rows, projection)).rejects.toMatchObject({ code: 'FEATURE_SCHEMA_MISMATCH' });
    for (const [field, value, code] of [['sha256', '0'.repeat(64), 'MODEL_INTEGRITY_ERROR'], ['sklearnVersion', '1.9.1', 'MODEL_RUNTIME_MISMATCH']] as const) {
      const path = resolve(directory, `${field}.json`); await writeFile(path, JSON.stringify({ ...manifest, [field]: value }));
      await expect(createIsolationForestAdapter(isolationOptions({ manifestPath: path }))(readings, rows, projection)).rejects.toMatchObject({ code });
    }
    expect(await readFile(isolationOptions().artifactPath)).toHaveLength(manifest.bytes);
  }, 60000);
  it('rejects missing/foreign/duplicate/non-finite features before inference and invalid score projection after inference', async () => {
    const detect = createIsolationForestAdapter(isolationOptions());
    for (const invalid of [rows.slice(1), [rows[0]!, rows[0]!, rows[2]!], [rows[0]!, { readingId: 'outside', values: [1, 2] }, rows[2]!],
      [rows[0]!, { readingId: 'outlier', values: [NaN, 2] }, rows[2]!]]) await expect(detect(readings, invalid, projection)).rejects.toMatchObject({ code: 'ENGINE_INPUT_INVALID' });
    await expect(detect(readings, rows, { id: 'invalid-experiment', score: () => NaN })).rejects.toMatchObject({ code: 'ENGINE_OUTPUT_INVALID' });
  }, 60000);
});
describe('Python transport test double, separate from real inference above', () => {
  const transport = (options = {}) => createPythonRunner({ ...isolationOptions(), args: [],
    scriptPath: fileURLToPath(new URL('./fixtures/python-transport.py', import.meta.url)), timeoutMs: 1000, maxOutputBytes: 4096, ...options });
  it('bounds input/output, handles invalid JSON and sanitizes stderr/unknown errors', async () => {
    await expect(transport({ maxInputBytes: 5 })({ mode: 'ok' })).rejects.toMatchObject({ code: 'ENGINE_INPUT_LIMIT' });
    await expect(transport()({ mode: 'oversize' })).rejects.toMatchObject({ code: 'ENGINE_OUTPUT_LIMIT' });
    await expect(transport()({ mode: 'invalid' })).rejects.toMatchObject({ code: 'ENGINE_PROTOCOL_ERROR' });
    const error = await transport()({ mode: 'failure' }).catch(error => error);
    expect(error).toMatchObject({ code: 'ENGINE_UNAVAILABLE' }); expect(String(error)).not.toMatch(/secret|private|payload/);
    await expect(transport({ pythonExecutable: resolve(directory, 'missing.exe') })({ mode: 'ok' })).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
  });
  it('rejects overload, waits for process close before returning a slot, and supports cancellation/timeout', async () => {
    const run = transport({ timeoutMs: 1000 }), pending = run({ mode: 'sleep' }).catch(error => error);
    await expect(run({ mode: 'ok' })).rejects.toMatchObject({ code: 'ENGINE_BUSY' });
    expect(await pending).toMatchObject({ code: 'ENGINE_TIMEOUT' }); expect(await run({ mode: 'ok' })).toEqual({ ok: true });
    const controller = new AbortController(); const aborted = run({ mode: 'sleep' }, controller.signal).catch(error => error); controller.abort();
    expect(await aborted).toMatchObject({ code: 'ENGINE_ABORTED' }); expect(await run({ mode: 'ok' })).toEqual({ ok: true });
    await expect(run({ mode: 'ok' }, controller.signal)).rejects.toMatchObject({ code: 'ENGINE_ABORTED' });
  });
});
