import { ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { createAnomalyReviewService, createAnomalyService } from '../src/modules/anomalies/anomalies.service.js';
import { toAnomalyDto, type AnomalyRepository } from '../src/modules/anomalies/anomalies.repository.js';
import { createCursorCodec } from '../src/shared/pagination.js';
import type { ReviewRequest } from '../src/modules/anomalies/anomalies.types.js';

const id = new ObjectId().toHexString(), datasetId = new ObjectId().toHexString(), runId = new ObjectId().toHexString();
const codec = createCursorCodec('b6-unit-test-only-secret-at-least-32bytes');
function fixture() {
  const repository: AnomalyRepository = { list: vi.fn(async () => []), get: vi.fn(async () => null), review: vi.fn(async () => ({ kind: 'not-found' as const })) };
  const datasets = { getState: vi.fn(async () => ({ id: datasetId, status: 'imported' as const })) };
  const runs = { getState: vi.fn(async () => ({ id: runId, datasetId, status: 'completed' as const })) };
  return { repository, datasets, runs, service: createAnomalyService(repository, datasets, runs, codec) };
}
describe('B6 service boundaries (explicit repository doubles)', () => {
  it('validates review before persistence and preserves note whitespace/empty strings', async () => {
    const f = fixture(), service = createAnomalyReviewService(f.repository);
    for (const invalid of [{ baseVersion: Number.MAX_SAFE_INTEGER + 1, changes: { note: 'x' } },
      { baseVersion: 0, changes: { note: 'x' } }, { baseVersion: 1, changes: {} },
      { baseVersion: 1, changes: { score: 1 } }, { baseVersion: 1, changes: { status: 'closed' } },
      { baseVersion: 1, changes: { note: null } }]) {
      await expect(service.review(id, invalid as ReviewRequest)).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(f.repository.review).not.toHaveBeenCalled();
    for (const note of ['', '  Ghi chú\nnguyên văn <script>$note</script>  ']) {
      await expect(service.review(id, { baseVersion: 1, changes: { note } })).rejects.toMatchObject({ statusCode: 404 });
      expect(f.repository.review).toHaveBeenLastCalledWith(id, { baseVersion: 1, changes: { note } });
    }
  });
  it('maps stale version and numeric exhaustion honestly without claiming idempotent PATCH replay', async () => {
    const f = fixture();
    vi.mocked(f.repository.review).mockResolvedValue({ kind: 'conflict', currentVersion: 7 });
    await expect(f.service.review(id, { baseVersion: 6, changes: { status: 'open' } })).rejects.toMatchObject({ statusCode: 409, details: { currentVersion: 7 } });
    vi.mocked(f.repository.review).mockResolvedValue({ kind: 'version-exhausted' });
    await expect(f.service.review(id, { baseVersion: Number.MAX_SAFE_INTEGER, changes: { note: '' } })).rejects.toMatchObject({ statusCode: 422 });
  });
  it('normalizes closed UTC bounds and rejects invalid cursors/ranges before reading candidates', async () => {
    const f = fixture();
    await f.service.list({ datasetId, analysisRunId: runId, from: '2026-11-16T00:00:00Z', to: '2026-11-16T00:00:00.000Z', method: 'zscore' });
    expect(f.repository.list).toHaveBeenCalledWith({ datasetId, analysisRunId: runId, from: '2026-11-16T00:00:00.000Z', to: '2026-11-16T00:00:00.000Z', method: 'zscore', direction: 'asc', limit: 101 });
    for (const change of [{ from: '2026-11-16T00:00:00+00:00' }, { from: '2026-11-16T00:00:00.0001Z' },
      { from: '2026-11-17T00:00:00Z', to: '2026-11-16T00:00:00Z' }, { cursor: 'tampered' },
      { cursor: codec.encode({ id: 'opaque', key: 'invalid-date' }, 'wrong-query') }]) await expect(f.service.list({ datasetId, ...change })).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });
  it('whitelists DTO fields and rejects nonfinite scores rather than exposing persistence or reading values', () => {
    const document = { _id: new ObjectId(), datasetId: new ObjectId(), sensorId: new ObjectId(), readingId: new ObjectId(), analysisRunId: new ObjectId(),
      ts: new Date('2026-11-16T00:00:00Z'), location: { type: 'Point' as const, coordinates: [106, 10] as [number, number] },
      family: 'statistical' as const, method: 'zscore', score: 4, severity: 'low' as const, status: 'open' as const,
      note: '', version: 1, updatedAt: new Date(), value: 999, private: 'must not leak' };
    const dto = toAnomalyDto(document);
    expect(dto.id).toBe(document._id.toHexString()); expect(dto).not.toHaveProperty('_id'); expect(dto).not.toHaveProperty('value'); expect(dto).not.toHaveProperty('private');
    for (const score of [NaN, Infinity, -Infinity]) expect(() => toAnomalyDto({ ...document, score })).toThrow();
  });
});
