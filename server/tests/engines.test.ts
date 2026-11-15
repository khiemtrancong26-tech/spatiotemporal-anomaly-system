import { describe, expect, it } from 'vitest';
import type { Reading } from '@pm25/shared-core/contracts';
import { runStatisticalAdapter } from '../src/engines/statistical.js';
import { projectCandidates } from '../src/engines/results.js';
import { experimentalPolicy } from '../../shared-core/tests/experimental-policies.js';

function readings(values: number[]): Reading[] {
  return values.map((value, index) => ({ id: String(index), datasetId: 'D', sensorId: 'S', ts: new Date(Date.UTC(2026, 10, 15) + index * 1000).toISOString(),
    location: { type: 'Point', coordinates: [106, 10] }, value, unit: 'ug/m3' }));
}
describe('internal Backend engine projection, no B5 workflow', () => {
  it('uses real shared library output, links only flagged readings and adds no severity/run/review state', () => {
    const input = readings([...Array<number>(20).fill(0), 100]);
    const evaluation = runStatisticalAdapter({ method: 'zscore', readings: input, config: { threshold: 3 } }, experimentalPolicy('zscore'));
    expect(evaluation.engineVersion).toBe('simple-statistics@8.0.0'); expect(evaluation.policyId).toContain('EXPERIMENT-ONLY');
    expect(evaluation.candidates).toHaveLength(1); expect(evaluation.candidates[0]).toMatchObject({ readingId: '20', datasetId: 'D', sensorId: 'S', value: 100, score: expect.any(Number) });
    expect(evaluation.candidates[0]).not.toHaveProperty('id');
    expect(evaluation.candidates[0]).not.toHaveProperty('severity'); expect(evaluation.candidates[0]).not.toHaveProperty('analysisRunId');
    expect(runStatisticalAdapter({ method: 'zscore', readings: [], config: { threshold: 3 } }, experimentalPolicy('zscore')).candidates).toEqual([]);
  });
  it('rejects foreign/duplicate IDs, non-finite scores and invalid normalized scopes rather than projecting partial output', () => {
    const input = readings([0, 10]);
    for (const points of [[{ readingId: 'outside', score: 1, flagged: true }], [{ readingId: '0', score: NaN, flagged: true }],
      [{ readingId: '0', score: 1, flagged: true }, { readingId: '0', score: 2, flagged: false }]]) {
      expect(() => projectCandidates(input, points)).toThrow(expect.objectContaining({ code: 'ENGINE_OUTPUT_INVALID' }));
    }
    expect(() => projectCandidates([...input, input[0]!], [])).toThrow(expect.objectContaining({ code: 'ENGINE_INPUT_INVALID' }));
    expect(() => projectCandidates([{ ...input[0]!, value: -1 }], [])).toThrow(expect.objectContaining({ code: 'ENGINE_INPUT_INVALID' }));
    expect(() => projectCandidates([input[0]!, { ...input[1]!, datasetId: 'other' }], [])).toThrow(expect.objectContaining({ code: 'ENGINE_INPUT_INVALID' }));
  });
});
