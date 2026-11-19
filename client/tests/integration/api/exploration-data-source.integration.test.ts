import { expect, it, vi } from 'vitest';
import { DatasetProfileSchema, ReadingAggregationSchema } from '@pm25/shared-core';
import examples from '../../../../docs/fixtures/c2-online-examples.json';
import { createOnlineDataSource } from '../../../src/shared/data-source/online';
import { createMockTransport } from '../../../src/mocks/transport';
it('uses approved strict envelopes and repeated query arrays without splitting opaque identifiers', async () => {
  expect(DatasetProfileSchema.safeParse(examples.profile.data).success).toBe(true);
  expect(ReadingAggregationSchema.safeParse(examples.aggregates.data).success).toBe(true);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(JSON.stringify(examples.profile))).mockResolvedValueOnce(new Response(JSON.stringify(examples.aggregates)));
  const api = createOnlineDataSource({ baseUrl: 'http://test.local/api/v1', getAccessToken: () => 'test', fetch });
  const ids = ['opaque/a,b+ c', 'station-two'];
  await api.datasets.profile('opaque/dataset', { sensorIds: ids, bbox: [110, 35, 120, 45] });
  const first = new URL(String(fetch.mock.calls[0][0])); expect(first.pathname).toBe('/api/v1/datasets/opaque%2Fdataset/profile'); expect(first.searchParams.getAll('sensorIds')).toEqual(ids);
  const a = examples.aggregates.data;
  await api.aggregates.get({ datasetId: a.datasetId, sensorIds: ids, bucket: 'hour', from: a.scope.from, to: a.scope.to, timeZone: '+08:00' });
  expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('timeZone')).toBe('+08:00');
  await expect(api.datasets.profile('id', { sensorIds: [] })).rejects.toBeInstanceOf(TypeError);
});
it('rejects extra/private fields and malformed empty aggregates; mock reports unimplemented explicitly', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...examples.profile.data, _id: 'private' } }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...examples.aggregates.data, complete: false } })));
  const api = createOnlineDataSource({ baseUrl: 'http://test.local/api/v1', getAccessToken: () => 'test', fetch });
  await expect(api.datasets.profile('id', {})).rejects.toMatchObject({ kind: 'invalid-response' });
  await expect(api.aggregates.get({ datasetId: 'id', from: '2015-03-26T13:00:00Z', to: '2015-03-26T14:00:00Z', bucket: 'hour' })).rejects.toMatchObject({ kind: 'invalid-response' });
  const mock = createOnlineDataSource({ baseUrl: 'http://mock.local/api/v1', getAccessToken: () => 'mock-analyst01', fetch: createMockTransport({ scenario: 'success', delayMs: 0, role: 'analyst' }) });
  await expect(mock.datasets.profile('id', {})).rejects.toMatchObject({ status: 503, error: { code: 'C2_MOCK_NOT_IMPLEMENTED' } });
});
