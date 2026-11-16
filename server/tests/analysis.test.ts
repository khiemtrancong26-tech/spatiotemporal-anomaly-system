import { describe, expect, it } from 'vitest';
import { loadTestConfig } from './helpers.js';
import { normalizeDetection } from '../src/modules/analysis/analysis.service.js';
import { createOnlineEngine } from '../src/engines/online.js';
import { onlineStatisticalPolicy } from '../src/engines/statistical.policy.js';
import { runStatisticalAdapter } from '../src/engines/statistical.js';
import type { Reading, StatisticalDetectorInput } from '@pm25/shared-core/contracts';

const config = loadTestConfig().analysis;
const input = { datasetId: 'opaque', family: 'statistical' as const, method: 'zscore', config: { threshold: 3 } };
const readings = (values: number[]): Reading[] => values.map((value, index) => ({ id: String(index), datasetId: 'd', sensorId: 's',
  ts: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), value, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] } }));
describe('approved B5 policy validation', () => {
  it('keeps {} scope, normalizes closed UTC bounds and requires explicit method configs', () => {
    expect(normalizeDetection(input, config).scope).toEqual({});
    expect(normalizeDetection({ ...input, scope: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00.000Z', sensorIds: ['opaque'] } }, config).scope)
      .toEqual({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z', sensorIds: ['opaque'] });
    for (const changed of [{ method: 'unknown' }, { config: {} }, { config: { threshold: 4 } }, { config: { threshold: 3, extra: true } },
      { method: 'moving_avg', config: { threshold: 3 } }, { method: 'moving_avg', config: { threshold: 3, windowSize: 1 } },
      { method: 'iqr', config: { multiplier: 2 } }, { scope: { sensorIds: [] } }, { scope: { sensorIds: Array(10001).fill('s') } },
      { scope: { from: '2026-01-01T00:00:00+00:00' } }, { scope: { from: '2026-01-01T00:00:00.0001Z' } },
      { scope: { from: '2026-02-30T00:00:00Z' } }, { scope: { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' } }]) {
      expect(() => normalizeDetection({ ...input, ...changed }, config)).toThrow();
    }
    expect(normalizeDetection({ ...input, family: 'ml', method: 'isolation_forest', config: {} }, config).config).toEqual({});
    for (const method of ['iforest', 'zscore']) expect(() => normalizeDetection({ ...input, family: 'ml', method, config: {} }, config)).toThrow();
    expect(() => normalizeDetection({ ...input, family: 'ml', method: 'isolation_forest', config: { seed: 42 } }, config)).toThrow();
  });
  it('runs real library policies with constant, insufficient, zero-window and IQR fence edge cases', () => {
    const run = (method: StatisticalDetectorInput['method'], values: number[]) => runStatisticalAdapter({ method, readings: readings(values),
      config: method === 'iqr' ? { multiplier: 1.5 } : method === 'moving_avg' ? { threshold: 3, windowSize: 3 } : { threshold: 3 } }, onlineStatisticalPolicy(method));
    for (const method of ['zscore', 'iqr', 'moving_avg'] as const) {
      expect(run(method, [2, 2, 2, 2]).output.status).toBe('completed'); expect(run(method, [2, 2, 2, 2]).candidates).toEqual([]);
      expect(run(method, []).output.status).toBe('insufficient_data'); expect(run(method, [2]).output.status).toBe('insufficient_data');
    }
    expect(run('moving_avg', [2, 2, 2, 100]).output.status).toBe('insufficient_data');
    expect(run('iqr', [2, 2, 2, 2, 100]).candidates[0]).toMatchObject({ readingId: '4', score: 98 });
    expect(run('zscore', [...Array(20).fill(2), 100]).candidates).toHaveLength(1);
  });
  it('validates worker limits without leaking configuration secrets', () => {
    expect(config).toMatchObject({ concurrency: 1, leaseMs: 30000, heartbeatMs: 10000, pollMs: 1000, maxAttempts: 3, timeoutMs: 120000,
      maxReadings: 50000, maxPending: 100, maxSensorIds: 10000, replayMs: 86400000 });
    for (const env of [{ ANALYSIS_CONCURRENCY: '0' }, { ANALYSIS_MAX_READINGS: '50001' }, { ANALYSIS_MAX_SENSOR_IDS: '10001' },
      { ANALYSIS_LEASE_MS: '20000' }, { ANALYSIS_POLL_MS: '1e2' }]) expect(() => loadTestConfig(env)).toThrow();
    expect(createOnlineEngine(config).metadata('statistical')).toEqual({ engineVersion: 'simple-statistics@8.0.0' });
  });
});
