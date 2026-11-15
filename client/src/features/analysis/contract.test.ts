import { describe, expect, it } from 'vitest';
import { AnalysisRunSchema, StatisticalDetectorInputSchema } from '../../../../shared-core/src/contracts/schemas';
import fixtures from '../../../../docs/fixtures/frontend-online-examples.json';
import { conforms } from '../../shared/api/validation';
describe('D008 shared/wire lifecycle agreement', () => {
  const schema = { $ref: '#/components/schemas/AnalysisRun' };
  const runs = fixtures.cases.filter(c => c.id.startsWith('analysis-detail')).map(c => (c.response as {data: unknown}).data);
  it('accepts queued, running, completed, failed target fixtures', () => { for (const run of runs) { expect(AnalysisRunSchema.safeParse(run).success).toBe(true); expect(conforms(run, schema)).toBe(true); } });
  it('rejects missing scope, failed without error and pending with terminal timestamps', () => {
    const completed = runs.find(r => (r as {status: string}).status === 'completed') as Record<string, unknown>;
    for (const run of [{ ...completed, scope: undefined }, { ...completed, status: 'failed' }, { ...completed, status: 'queued' }]) { expect(AnalysisRunSchema.safeParse(run).success).toBe(false); expect(conforms(run, schema)).toBe(false); }
  });
});

it('accepts the approved fixed IQR multiplier without inventing ranges', () => {
  expect(StatisticalDetectorInputSchema.safeParse({ method: 'iqr', config: { multiplier: 1.5 }, readings: [] }).success).toBe(true);
  expect(StatisticalDetectorInputSchema.safeParse({ method: 'iqr', config: { multiplier: 4 }, readings: [] }).success).toBe(false);
});
