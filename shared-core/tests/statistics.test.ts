import { describe, expect, it, vi } from 'vitest';
import { evaluateStatistics, STATISTICS_ENGINE_VERSION, type Facts } from '../src/statistics/index.js';
import { StatisticalDetectorOutputSchema, type Reading, type StatisticalDetectorInput } from '../src/contracts/index.js';
import { experimentalPolicy } from './experimental-policies.js';

function rows(values: number[], sensorId = 'S', datasetId = 'D'): Reading[] {
  return values.map((value, index) => ({ id: `${sensorId}/${index}`, datasetId, sensorId, ts: new Date(Date.UTC(2026, 10, 15) + index * 1000).toISOString(),
    value, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] } }));
}
describe('library-backed statistics with explicitly experimental policies', () => {
  it('returns a golden population z-score vector, zero included, without mutating/sorting the caller array', () => {
    const readings = rows([2, 4, 4, 4, 5, 5, 7, 9]).reverse(), before = structuredClone(readings);
    const result = evaluateStatistics({ method: 'zscore', readings, config: { threshold: 3 } }, experimentalPolicy('zscore'));
    expect(STATISTICS_ENGINE_VERSION).toBe('simple-statistics@8.0.0');
    expect(result.status).toBe('completed'); expect(result.results.map(row => row.score)).toEqual([1.5, .5, .5, .5, 0, 0, 1, 2]);
    expect(result.results.every(row => !row.flagged)).toBe(true); expect(readings).toEqual(before);
    expect(StatisticalDetectorOutputSchema.safeParse(result).success).toBe(true);
    const anomalous = evaluateStatistics({ method: 'zscore', readings: rows([...Array<number>(20).fill(0), 100]), config: { threshold: 3 } }, experimentalPolicy('zscore'));
    expect(anomalous.results.filter(row => row.flagged).map(row => row.readingId)).toEqual(['S/20']);
  });
  it('uses library type-7 quartiles/IQR with explicit 1.5 fences and preserves boundary equality', () => {
    const readings = rows([0, 1, 2, 3, 100]);
    const result = evaluateStatistics({ method: 'iqr', readings, config: { multiplier: 1.5 } }, experimentalPolicy('iqr'));
    expect(result.status).toBe('completed'); expect(result.results.map(row => [row.score, row.flagged])).toEqual([[0, false], [0, false], [0, false], [0, false], [94, true]]);
    const boundary = evaluateStatistics({ method: 'iqr', readings: rows([0, 0, 0, 2, 2, 2, 5]), config: { multiplier: 1.5 } }, experimentalPolicy('iqr'));
    expect(boundary.results.at(-1)?.flagged).toBe(false);
  });
  it('composes mean/std/zScore over preceding windows, excludes the target, and declares warmup omissions', () => {
    const result = evaluateStatistics({ method: 'moving_avg', readings: rows([1, 2, 3, 4, 10]), config: { windowSize: 3, threshold: 3 } }, experimentalPolicy('moving_avg'));
    expect(result.status).toBe('completed'); expect(result.results.map(row => row.readingId)).toEqual(['S/3', 'S/4']);
    expect(result.results[0]?.score).toBeCloseTo(2.449489742783178);
    expect(result.results[1]?.score).toBeCloseTo(8.573214099741124);
    expect(result.results.map(row => row.flagged)).toEqual([false, true]); expect(result.message).toContain('3 warmup');
  });
  it('keeps sensor references separate and rejects incomplete groups without partial successful scores', () => {
    const result = evaluateStatistics({ method: 'zscore', readings: [...rows([1, 2, 3]), ...rows([101, 102, 103], 'B')], config: { threshold: 3 } }, experimentalPolicy('zscore'));
    expect(result.results.map(row => row.score)).toEqual([expect.closeTo(1.224744871), 0, expect.closeTo(1.224744871), expect.closeTo(1.224744871), 0, expect.closeTo(1.224744871)]);
    const short = evaluateStatistics({ method: 'zscore', readings: [...rows([1, 2]), ...rows([50], 'B')], config: { threshold: 3 } }, experimentalPolicy('zscore'));
    expect(short).toMatchObject({ status: 'insufficient_data', results: [] });
  });
  it('does not fabricate finite anomaly scores for empty/short/zero-dispersion inputs', () => {
    for (const values of [[], [1]]) expect(evaluateStatistics({ method: 'zscore', readings: rows(values), config: { threshold: 3 } }, experimentalPolicy('zscore')).status).toBe('insufficient_data');
    const constant = evaluateStatistics({ method: 'zscore', readings: rows([0, 0, 0]), config: { threshold: 3 } }, experimentalPolicy('zscore'));
    expect(constant.results.map(row => [row.score, row.flagged])).toEqual([[0, false], [0, false], [0, false]]);
    expect(evaluateStatistics({ method: 'moving_avg', readings: rows([2, 2, 2, 10]), config: { windowSize: 3, threshold: 3 } }, experimentalPolicy('moving_avg'))).toMatchObject({ status: 'insufficient_data', results: [] });
  });
  it('rejects invalid scope/config/library arithmetic/policy outputs and never publishes partial results', () => {
    const input: StatisticalDetectorInput = { method: 'zscore', readings: rows([1, 2, 3]), config: { threshold: 3 } };
    for (const readings of [[...input.readings, input.readings[0]!], [...input.readings, ...rows([2, 3], 'B', 'other')], rows([NaN, 2]), rows([-1, 2]), rows([1e308, 1e308])]) {
      expect(evaluateStatistics({ ...input, readings }, experimentalPolicy('zscore'))).toMatchObject({ status: 'invalid_input', results: [] });
    }
    for (const config of [{}, { threshold: -1 }, { threshold: 3, windowSize: 2 }]) expect(evaluateStatistics({ ...input, config }, experimentalPolicy('zscore')).status).toBe('invalid_input');
    const policy = experimentalPolicy('zscore');
    expect(evaluateStatistics(input, { ...policy, decide: () => ({ score: NaN, flagged: true }) })).toMatchObject({ status: 'invalid_input', results: [] });
    expect(evaluateStatistics(input, { ...policy, decide: () => { throw new Error('policy failed'); } })).toMatchObject({ status: 'invalid_input', results: [] });
    expect(evaluateStatistics(input, { ...policy, minSamplesPerSensor: 0 }).status).toBe('invalid_input');
    expect(evaluateStatistics({ ...input, method: 'moving_avg', config: { threshold: 3 } }, experimentalPolicy('moving_avg')).status).toBe('invalid_input');
  });
  it('exposes library facts to a caller-supplied policy, including sample deviation and IQR=0', () => {
    const decide = vi.fn<(facts: Readonly<Facts>) => { score: number; flagged: boolean }>(() => ({ score: 0, flagged: false }));
    evaluateStatistics({ method: 'zscore', readings: rows([1, 3]), config: { threshold: 3 } }, { ...experimentalPolicy('zscore'), standardDeviation: 'sample', decide });
    expect(decide.mock.calls[0]?.[0]).toMatchObject({ mean: 2, standardDeviation: expect.closeTo(Math.sqrt(2)), count: 2 });
    const zero = evaluateStatistics({ method: 'iqr', readings: rows([0, 0, 0, 0, 100]), config: { multiplier: 1.5 } }, experimentalPolicy('iqr'));
    expect(zero.status).toBe('completed'); expect(zero.results.at(-1)).toMatchObject({ score: 100, flagged: true });
  });
});
