import { expect, it, vi } from 'vitest';
import { createMockTransport, type MockControls } from '../../mocks/transport';
import { createOnlineDataSource } from './online';
import examples from '../../../../docs/fixtures/frontend-online-examples.json';
import type * as W from '../api/generated/wire';

const controls: MockControls = { role: 'admin', delayMs: 0, scenario: 'success' };
const makeApi = (settings = controls) => createOnlineDataSource({ baseUrl: 'http://mock.local/api/v1', getAccessToken: () => 'mock-token', fetch: createMockTransport(settings) });
const key = { idempotencyKey: 'c3b1d629-5581-4c19-835f-66a96238b724' };
const body = (id: string) => (examples.cases.find((item) => item.id === id)!.request as { body: unknown }).body;

it('register sends only credentials without auth headers and rejects an admin response', async () => {
  const registered = { id: 'new-user', username: 'newanalyst', role: 'analyst', isActive: true };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ data: registered }), { status: 201 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...registered, role: 'admin' } }), { status: 201 }));
  const api = createOnlineDataSource({ baseUrl: 'http://test.local/api/v1', getAccessToken: () => 'existing-token', fetch });
  await expect(api.auth.register({ username: 'newanalyst', password: 'demo-password' })).resolves.toEqual(registered);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ username: 'newanalyst', password: 'demo-password' });
  expect(new Headers(fetch.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  await expect(api.auth.register({ username: 'newanalyst', password: 'demo-password', role: 'admin' } as never)).rejects.toBeInstanceOf(TypeError);
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(api.auth.register({ username: 'newanalyst', password: 'demo-password' })).rejects.toMatchObject({ kind: 'invalid-response' });
});

it('routes every adapter method through the mock HTTP transport with the right envelope', async () => {
  const api = makeApi();
  expect((await api.health()).status).toBe('ok');
  expect((await api.auth.login({ username: 'demo', password: 'demo' })).tokenType).toBe('Bearer');
  expect((await api.auth.me()).role).toBe('admin');
  expect((await api.datasets.list({})).data[0].status).toBe('imported');
  expect((await api.datasets.upload({ file: new File(['a'], 'sample.csv') }, key)).status).toBe('uploaded');
  expect((await api.datasets.validation('dataset-001')).sourceColumns).toContain('station_id');
  expect((await api.datasets.setMapping('dataset-001', body('mapping') as W.MappingRequest)).status).toBe('awaiting_mapping');
  expect((await api.datasets.import('dataset-001', key)).status).toBe('imported');
  expect((await api.sensors.list({ datasetId: 'dataset-001' })).data[0].externalId).toBe('S01');
  expect((await api.readings.list({ datasetId: 'dataset-001' })).data).toHaveLength(2);
  expect((await api.analysis.create(body('analysis-create') as W.DetectionRequest, key)).data.status).toBe('queued');
  expect((await api.analysis.get('run-001')).id).toBe('run-001');
  expect((await api.analysis.list({ datasetId: 'dataset-001' })).data[0].method).toBe('zscore');
  expect((await api.anomalies.list({ datasetId: 'dataset-001' })).data[0].id).toBe('anomaly-001');
  expect((await api.anomalies.get('anomaly-001')).readingId).toBe('reading-002');
  expect((await api.anomalies.review('anomaly-001', body('anomaly-review') as W.ReviewPatchRequest)).version).toBe(2);
  expect((await api.adminUsers.list({})).data).toHaveLength(1);
  expect((await api.adminUsers.create(body('admin-create') as W.AdminUserCreateRequest, key)).id).toBe('user-002');
  expect((await api.adminUsers.update('user-002', { isActive: false })).isActive).toBe(false);
});

it('pages mock data with query-bound cursors and returns honest empty results', async () => {
  const api = makeApi();
  const first = await api.readings.list({ datasetId: 'dataset-001', limit: 1 });
  expect(first.page.nextCursor).not.toBeNull();
  const next = await api.readings.list({ datasetId: 'dataset-001', limit: 1, cursor: first.page.nextCursor! });
  expect(next.data[0].id).not.toBe(first.data[0].id);
  expect(next.page.nextCursor).toBeNull();
  await expect(api.readings.list({ datasetId: 'other', limit: 1, cursor: first.page.nextCursor! })).rejects.toMatchObject({ kind: 'http', status: 400 });
  expect((await api.readings.list({ datasetId: 'other' })).data).toEqual([]);
  expect((await makeApi({ ...controls, scenario: 'empty' }).datasets.list({})).data).toEqual([]);
});

it('supports explicit fixture errors, role errors and abort during a delayed request', async () => {
  await expect(makeApi({ ...controls, role: 'analyst' }).adminUsers.list({})).rejects.toMatchObject({ status: 403 });
  await expect(makeApi({ ...controls, overrides: { 'anomaly-review': 'review-409' } }).anomalies.review('anomaly-001', { baseVersion: 1, changes: { note: 'mine' } })).rejects.toMatchObject({ status: 409 });
  const controller = new AbortController();
  const pending = makeApi({ ...controls, delayMs: 500 }).health({ signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
});

it('D008 mock replays one accepted run without rerunning and exposes terminal results only', async () => {
  const api = makeApi();
  const request = body('analysis-create') as W.DetectionRequest;
  const accepted = await api.analysis.create(request, key);
  expect(accepted.data.status).toBe('queued');
  expect(await api.analysis.create(request, key)).toEqual(accepted);
  await expect(api.analysis.create({ ...request, config: { changed: true } }, key)).rejects.toMatchObject({ status: 422 });
  await expect(api.anomalies.list({ datasetId: request.datasetId, analysisRunId: accepted.data.id })).rejects.toMatchObject({ status: 409 });
  expect((await api.analysis.get(accepted.data.id)).status).toBe('queued');
  expect((await api.analysis.get(accepted.data.id)).status).toBe('running');
  expect((await api.analysis.get(accepted.data.id)).status).toBe('completed');
  expect(await api.analysis.create(request, key)).toEqual(accepted);
  expect((await api.anomalies.list({ datasetId: request.datasetId, analysisRunId: accepted.data.id })).data[0].analysisRunId).toBe(accepted.data.id);
});
