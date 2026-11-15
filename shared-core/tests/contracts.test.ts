import { describe, expect, it } from 'vitest';
import {
  AnomalyReviewChangesSchema,
  AnomalySchema,
  BboxSchema,
  CacheCoverageSchema,
  GeoPointSchema,
  OfflineReviewMutationSchema,
  ReadingSchema,
  UserPublicSchema,
  UserRoleSchema,
  UtcIsoSchema,
} from '../src/index.js';
import { mk } from './helpers.js';

// Kịch bản F.1-F.9 trong docs/shared-data-contract.md (phần kiểm tra được ở mức schema).
describe('contract: Reading (F.1, F.2)', () => {
  it('value = 0 hợp lệ; âm, NaN, Infinity bị từ chối', () => {
    expect(ReadingSchema.safeParse(mk('s', 0, 0)).success).toBe(true);
    for (const bad of [-1, NaN, Infinity]) {
      expect(ReadingSchema.safeParse(mk('s', 0, bad)).success).toBe(false);
    }
  });
  it('lon 181 / lat -91 bị từ chối; coordinates = [lon, lat]', () => {
    expect(GeoPointSchema.safeParse({ type: 'Point', coordinates: [181, 10] }).success).toBe(false);
    expect(GeoPointSchema.safeParse({ type: 'Point', coordinates: [106, -91] }).success).toBe(false);
    expect(GeoPointSchema.safeParse({ type: 'Point', coordinates: [106.7, 10.77] }).success).toBe(true);
    // đảo thứ tự lat/lon với lat > 90 phải bị bắt
    expect(GeoPointSchema.safeParse({ type: 'Point', coordinates: [10.77, 106.7] }).success).toBe(false);
  });
  it('timestamp phải là UTC ISO có Z; offset và ngày không tồn tại bị từ chối', () => {
    expect(UtcIsoSchema.safeParse('2026-11-11T01:00:00.000Z').success).toBe(true);
    expect(UtcIsoSchema.safeParse('2026-11-11T08:00:00+07:00').success).toBe(false);
    expect(UtcIsoSchema.safeParse('2026-02-31T00:00:00Z').success).toBe(false);
    expect(UtcIsoSchema.safeParse('2026-13-01T00:00:00Z').success).toBe(false);
  });
  it('strict: không cho field thừa (vd _id, passwordHash)', () => {
    expect(ReadingSchema.safeParse({ ...mk('s', 0, 5), _id: 'x' }).success).toBe(false);
  });
});

describe('contract: Anomaly / review (F.5, F.6, F.8)', () => {
  const anomaly = {
    id: 'a1', datasetId: 'd', sensorId: 's', readingId: 'r', analysisRunId: 'run-1',
    ts: '2026-11-11T02:00:00.000Z', location: { type: 'Point', coordinates: [106.7, 10.77] },
    family: 'statistical', method: 'zscore', score: 3.8, severity: 'high', status: 'open',
    note: '', version: 1, updatedAt: '2026-11-11T02:05:01.000Z',
  };
  it('cùng readingId nhưng khác analysisRunId đều hợp lệ', () => {
    expect(AnomalySchema.safeParse(anomaly).success).toBe(true);
    expect(AnomalySchema.safeParse({ ...anomaly, id: 'a2', analysisRunId: 'run-2' }).success).toBe(true);
  });
  it('status ngoài enum, version ≤ 0 bị từ chối', () => {
    expect(AnomalySchema.safeParse({ ...anomaly, status: 'new' }).success).toBe(false);
    expect(AnomalySchema.safeParse({ ...anomaly, version: 0 }).success).toBe(false);
    expect(AnomalySchema.safeParse({ ...anomaly, version: -1 }).success).toBe(false);
  });
  it('mutation: cần ít nhất status hoặc note; baseVersion ≥ 1', () => {
    expect(AnomalyReviewChangesSchema.safeParse({}).success).toBe(false);
    expect(AnomalyReviewChangesSchema.safeParse({ note: 'ok' }).success).toBe(true);
    const m = {
      clientMutationId: 'm1', anomalyId: 'a1', baseVersion: 1,
      changes: { status: 'confirmed' }, createdAt: '2026-11-11T02:10:00.000Z',
    };
    expect(OfflineReviewMutationSchema.safeParse(m).success).toBe(true);
    expect(OfflineReviewMutationSchema.safeParse({ ...m, baseVersion: 0 }).success).toBe(false);
  });
  it('role chỉ analyst|admin; UserPublic không chứa passwordHash', () => {
    expect(UserRoleSchema.safeParse('viewer').success).toBe(false);
    const u = { id: 'u', username: 'a', role: 'analyst', isActive: true };
    expect(UserPublicSchema.safeParse(u).success).toBe(true);
    expect(UserPublicSchema.safeParse({ ...u, passwordHash: 'x' }).success).toBe(false);
  });
});

describe('contract: CacheCoverage / bbox (F.7)', () => {
  it('bbox phải là [minLon, minLat, maxLon, maxLat]', () => {
    expect(BboxSchema.safeParse([106, 10, 107, 11]).success).toBe(true);
    expect(BboxSchema.safeParse([107, 10, 106, 11]).success).toBe(false);
  });
  it('coverage hợp lệ với complete=false', () => {
    const c = { datasetId: 'd', cachedAt: '2026-11-11T02:06:00.000Z', storedReadingCount: 5, complete: false };
    expect(CacheCoverageSchema.safeParse(c).success).toBe(true);
  });
});
