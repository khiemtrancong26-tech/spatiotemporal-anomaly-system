import { expect, it, vi } from 'vitest';
import { AnalysisRunSchema } from '@pm25/shared-core';
import { createOnlineDataSource } from '../../../src/shared/data-source/online';
import { createMockTransport } from '../../../src/mocks/transport';
import { conforms } from '../../../src/shared/api/validation';
const run = { id: 'r', datasetId: 'd', family: 'ml', method: 'isolation_forest', config: {}, scope: {},
  status: 'completed', createdAt: '2015-03-01T00:00:00Z', completedAt: '2015-03-01T00:00:01Z', modelVersion: 'pm25-iforest-uci501-v2',
  scoringSummary: { targetCount: 10, scoredCount: 7, unscorableCount: 3, reasons: { temporalOnly: 1, spatialOnly: 1, both: 1 } } };
it('validates completed ML summary and rejects invalid lifecycle/partitions', async () => {
  expect(AnalysisRunSchema.safeParse(run).success).toBe(true); expect(conforms(run, { $ref: '#/components/schemas/AnalysisRun' })).toBe(true);
  for (const bad of [{ ...run, status: 'running', completedAt: undefined }, { ...run, family: 'statistical' },
    { ...run, scoringSummary: undefined }, { ...run, scoringSummary: { ...run.scoringSummary, scoredCount: 8 } }]) expect(AnalysisRunSchema.safeParse(bad).success).toBe(false);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ data: run })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...run, scoringSummary: { ...run.scoringSummary, unscorableCount: 4 } } })));
  const api = createOnlineDataSource({ baseUrl: 'http://test.local/api/v1', getAccessToken: () => 'token', fetch });
  await expect(api.analysis.get('r')).resolves.toMatchObject({ scoringSummary: run.scoringSummary });
  await expect(api.analysis.get('r')).rejects.toMatchObject({ kind: 'invalid-response' });
});

it('reports mock ML as unimplemented instead of fabricating a completed run', async () => {
  const fetch = createMockTransport({ scenario: 'success', delayMs: 0, role: 'analyst' });
  const api = createOnlineDataSource({ baseUrl: 'http://test.local/api/v1', getAccessToken: () => 'mock-analyst01', fetch });
  await expect(api.analysis.create({ datasetId: 'd', family: 'ml', method: 'isolation_forest', config: {}, scope: {} },
    { idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ status: 503, error: { code: 'MOCK_ML_NOT_IMPLEMENTED' } });
});
