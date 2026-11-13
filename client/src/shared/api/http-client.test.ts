import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../../../docs/fixtures/frontend-online-examples.json';
import { createHttpClient } from './http-client';
import { operations, type OperationId } from './validation';
import { createOnlineDataSource } from '../data-source/online';
import { createIdempotentOperation } from './idempotency';
import { DataSourceError } from './errors';

const baseUrl = 'http://localhost:3001/api/v1';
const options = (fetch: typeof globalThis.fetch) => ({ baseUrl, fetch, getAccessToken: () => 'test-token' });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('HTTP contract fixtures', () => {
  for (const fixture of fixtures.cases) {
    it(`${fixture.id}: validates the real request and response envelope`, async () => {
      const id = (Object.keys(operations) as OperationId[]).find((key) => operations[key].path === fixture.path && operations[key].method === fixture.method)!;
      const input = fixture.request as { pathParams?: Record<string, string>; query?: Record<string, unknown>; headers?: Record<string, string>; body?: unknown; contentType?: string };
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(fixture.response, fixture.status));
      const promise = createHttpClient(options(fetch))(id, {
        path: input.pathParams, query: input.query, idempotencyKey: input.headers?.['Idempotency-Key'],
        body: input.contentType === 'multipart/form-data' ? { ...(input.body as object), file: new File(['value\n25'], 'demo.csv', { type: 'text/csv' }) } : input.body,
      });
      if (fixture.status < 300) await expect(promise).resolves.toEqual(fixture.response);
      else await expect(promise).rejects.toMatchObject({ kind: 'http', status: fixture.status });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toContain('/api/v1/');
      expect(init?.method).toBe(fixture.method);
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(operations[id].authenticated ? 'Bearer test-token' : null);
      if (input.contentType === 'multipart/form-data') {
        expect(init?.body).toBeInstanceOf(FormData);
        expect(headers.has('Content-Type')).toBe(false);
        expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
      }
      if (fixture.id === 'import') expect(init?.body).toBeUndefined();
    });
  }
});

it('rejects partial anomaly responses instead of reporting a successful save', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: { id: 'a', version: 2, note: '', status: 'open' } }));
  await expect(createOnlineDataSource(options(fetch)).anomalies.review('a', { baseVersion: 1, changes: { note: 'review' } })).rejects.toMatchObject({ kind: 'invalid-response' });
});

it('distinguishes malformed JSON, network failure and cancellation; never retries or falls back', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response('<html>Error</html>', { status: 500 }))
    .mockRejectedValueOnce(new TypeError('network'));
  const api = createOnlineDataSource(options(fetch));
  await expect(api.health()).rejects.toMatchObject({ kind: 'invalid-response', status: 500 });
  await expect(api.health()).rejects.toMatchObject({ kind: 'network' });
  const controller = new AbortController(); controller.abort();
  await expect(api.health({ signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('applies list defaults and serializes bbox, IDs and cursor without losing /api/v1', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: [], page: { limit: 100, nextCursor: null } }));
  const api = createOnlineDataSource(options(fetch));
  await api.readings.list({ datasetId: 'dataset/with spaces', bbox: [106, 10, 107, 11], cursor: 'x+y/==' });
  const url = new URL(String(fetch.mock.calls[0][0]));
  expect(url.pathname).toBe('/api/v1/readings');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ datasetId: 'dataset/with spaces', limit: '100', sort: 'ts:asc', bbox: '106,10,107,11', cursor: 'x+y/==' });
  await expect(api.readings.list({ datasetId: 'x', limit: 201 })).rejects.toBeInstanceOf(TypeError);
  await expect(api.datasets.list({ sort: 'ts:desc' } as never)).rejects.toBeInstanceOf(TypeError);
  expect(() => api.readings.list({ datasetId: 'x', bbox: [107, 10, 106, 11] })).toThrow('Invalid bbox');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('encodes opaque path IDs and preserves version conflicts for callers', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ error: { code: 'VERSION_CONFLICT', message: 'Changed', details: { currentVersion: 2 } } }, 409));
  await expect(createOnlineDataSource(options(fetch)).anomalies.review('a/b + c', { baseVersion: 1, changes: { note: 'mine' } })).rejects.toMatchObject({ kind: 'http', status: 409, error: { details: { currentVersion: 2 } } });
  expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe('/api/v1/anomalies/a%2Fb%20%2B%20c');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('requires idempotency keys, nonempty patches and exact success status', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ status: 'ok', timestamp: '2026-11-13T00:00:00Z' }, 201));
  const api = createOnlineDataSource(options(fetch));
  await expect(api.datasets.import('d', { idempotencyKey: '' })).rejects.toBeInstanceOf(TypeError);
  await expect(api.adminUsers.update('u', {})).rejects.toBeInstanceOf(TypeError);
  await expect(api.anomalies.review('a', { baseVersion: 1, changes: {} })).rejects.toBeInstanceOf(TypeError);
  await expect(api.health()).rejects.toMatchObject({ kind: 'invalid-response', status: 201 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves the key and frozen payload across ambiguous mutation retries; new intent uses a new key', async () => {
  const input = { datasetId: 'd', config: { threshold: 3 } };
  const send = vi.fn().mockRejectedValueOnce(new DataSourceError('network', 'lost response')).mockResolvedValue({ id: 'run-1' });
  const operation = createIdempotentOperation(input, send);
  input.config.threshold = 99;
  const first = operation.run();
  expect(operation.run()).toBe(first);
  await expect(first).rejects.toMatchObject({ kind: 'network' });
  await expect(operation.run()).resolves.toEqual({ id: 'run-1' });
  expect(send.mock.calls[0][0]).toEqual({ datasetId: 'd', config: { threshold: 3 } });
  expect(send.mock.calls[0][1].idempotencyKey).toBe(send.mock.calls[1][1].idempotencyKey);
  expect(createIdempotentOperation(input, send).idempotencyKey).not.toBe(operation.idempotencyKey);
});

it('reports a disconnected response stream as a network error', async () => {
  const result = response({});
  vi.spyOn(result, 'json').mockRejectedValue(new TypeError('connection terminated'));
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(result);
  await expect(createOnlineDataSource(options(fetch)).health()).rejects.toMatchObject({ kind: 'network' });
});
