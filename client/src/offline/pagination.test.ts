import { describe, expect, it } from 'vitest';
import { canUseOfflineFallback, makeLocalPage, queryFingerprint } from './pagination';

describe('offline pagination helpers', () => {
  it('uses the same cache scope regardless of server cursor', () => {
    const first = queryFingerprint({ datasetId: 'd1', from: '2026-11-01T00:00:00.000Z', cursor: undefined, limit: 2 });
    const second = queryFingerprint({ datasetId: 'd1', from: '2026-11-01T00:00:00.000Z', cursor: 'server-cursor', limit: 2 });
    expect(first).toBe(second);
  });

  it('paginates cached rows with a local cursor scoped to the query', () => {
    const query = { datasetId: 'd1', limit: 2 };
    const queryKey = queryFingerprint(query);
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const first = makeLocalPage({ rows, query, queryKey });
    expect(first).toEqual({ data: rows.slice(0, 2), page: { limit: 2, nextCursor: `offline-v1:${queryKey}:2` } });

    const second = makeLocalPage({ rows, query: { ...query, cursor: first.page.nextCursor ?? undefined }, queryKey });
    expect(second).toEqual({ data: [rows[2]], page: { limit: 2, nextCursor: null } });
  });

  it('does not reuse a local cursor for another query fingerprint', () => {
    const originalKey = queryFingerprint({ datasetId: 'd1', limit: 1 });
    const otherKey = queryFingerprint({ datasetId: 'd2', limit: 1 });
    const page = makeLocalPage({
      rows: [{ id: 'a' }, { id: 'b' }],
      query: { limit: 1, cursor: `offline-v1:${originalKey}:1` },
      queryKey: otherKey,
    });
    expect(page.data).toEqual([{ id: 'a' }]);
  });

  it('falls back only for network and gateway-unavailable failures', () => {
    expect(canUseOfflineFallback({ kind: 'network' })).toBe(true);
    expect(canUseOfflineFallback({ kind: 'http', status: 503 })).toBe(true);
    expect(canUseOfflineFallback({ kind: 'http', status: 401 })).toBe(false);
    expect(canUseOfflineFallback({ kind: 'aborted' })).toBe(false);
  });
});
