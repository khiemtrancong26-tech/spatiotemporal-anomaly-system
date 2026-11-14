import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { loadConfig as loadConfigRaw } from '../src/config.js';
import { loadTestConfig as loadConfig } from './helpers.js';
import { createCursorCodec, listSorts, parsePageQuery, queryFingerprint } from '../src/shared/pagination.js';
import { requireIdempotencyKey, replayOrThrow } from '../src/shared/idempotency.js';
import { assertSameDataset, toGeoPoint, toObjectId, toReadingDto, toUtcIso } from '../src/shared/persistence/mapping.js';
import { createHealthService } from '../src/modules/health/health.service.js';

describe('runtime configuration', () => {
  it('validates numeric settings and never includes a connection secret in errors', () => {
    expect(loadConfig({}).port).toBe(3001);
    expect(() => loadConfigRaw({})).toThrow('JWT_SECRET');
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ LOGIN_RATE_LIMIT_MAX: '0' })).toThrow('LOGIN_RATE_LIMIT_MAX');
    expect(loadConfig({ PORT: '3100', MONGODB_DATABASE: 'test_b1', LOG_LEVEL: 'silent' })).toMatchObject({ port: 3100, mongodbDatabase: 'test_b1' });
    for (const port of ['0', '65536', '1.5', '3001oops', '']) expect(() => loadConfig({ PORT: port })).toThrow('Invalid PORT');
    expect(() => loadConfig({ MONGODB_URI: 'secret-password' })).toThrow(/^Invalid MONGODB_URI$/);
    expect(() => loadConfig({ MONGODB_DATABASE: '' })).toThrow('Invalid MONGODB_DATABASE');
    expect(() => loadConfig({ MONGODB_TIMEOUT_MS: '0' })).toThrow('Invalid MONGODB_TIMEOUT_MS');
    expect(() => loadConfig({ HOST: ' ' })).toThrow('Invalid HOST');
    expect(() => loadConfig({ LOG_LEVEL: 'invalid' })).toThrow('Invalid LOG_LEVEL');
    expect(loadConfig({ CORS_ORIGINS: 'http://127.0.0.1:5173, https://demo.example' }).corsOrigins).toHaveLength(2);
    for (const origin of ['*', 'https://demo.example/path', 'https://user:password@demo.example']) {
      expect(() => loadConfig({ CORS_ORIGINS: origin })).toThrow('Invalid CORS_ORIGINS');
    }
  });
});

describe('bounded pagination and query-bound cursors', () => {
  it('preserves endpoint whitelists and rejects coercion/oversized queries', () => {
    expect(parsePageQuery({}, listSorts.readings, 'ts:asc')).toEqual({ limit: 100, sort: 'ts:asc', cursor: undefined });
    expect(parsePageQuery({ limit: '200', sort: 'ts:desc' }, listSorts.readings, 'ts:asc').limit).toBe(200);
    for (const limit of [0, -1, 201, 1.5, '', true, [], '1e2', ' 10']) {
      expect(() => parsePageQuery({ limit }, listSorts.readings, 'ts:asc')).toThrow();
    }
    expect(() => parsePageQuery({ sort: 'value:asc' }, listSorts.readings, 'ts:asc')).toThrow();
    expect(() => parsePageQuery({ cursor: '' }, listSorts.readings, 'ts:asc')).toThrow();
  });
  it('binds signed cursors to operation, dataset, filters and sort, but not object insertion order', () => {
    const codec = createCursorCodec('a-secret-for-cursor-tests-only-32bytes');
    const fingerprint = queryFingerprint('readings', { datasetId: 'a', from: '2026-11-14T00:00:00Z' }, 'ts:asc');
    expect(queryFingerprint('readings', { from: '2026-11-14T00:00:00Z', datasetId: 'a' }, 'ts:asc')).toBe(fingerprint);
    const boundary = { key: '2026-11-14T00:00:00.000Z', id: new ObjectId().toHexString() };
    const cursor = codec.encode(boundary, fingerprint);
    expect(codec.decode(cursor, fingerprint)).toEqual(boundary);
    for (const changed of [
      queryFingerprint('readings', { datasetId: 'b' }, 'ts:asc'),
      queryFingerprint('readings', { datasetId: 'a' }, 'ts:desc'),
      queryFingerprint('anomalies', { datasetId: 'a' }, 'ts:asc'),
    ]) expect(() => codec.decode(cursor, changed)).toThrow();
    for (const bad of ['', 'x'.repeat(5000), 'a.b', `${cursor}x`, cursor.replace(/^./, cursor[0] === 'a' ? 'b' : 'a')]) {
      expect(() => codec.decode(bad, fingerprint)).toThrow();
    }
    expect(() => createCursorCodec('short')).toThrow();
    expect(() => queryFingerprint('readings', { x: Infinity }, 'ts:asc')).toThrow();
    expect(queryFingerprint('readings', { sensorIds: ['s1', 's2'], note: null }, 'ts:asc')).toHaveLength(64);
  });
});

describe('repository mapping', () => {
  it('whitelists DTO fields, preserves zero and distinguishes external IDs from internal ObjectIds', () => {
    const datasetId = new ObjectId();
    const document = { _id: new ObjectId(), datasetId, sensorId: new ObjectId(), ts: new Date('2026-11-14T08:00:00+07:00'),
      location: { type: 'Point' as const, coordinates: [106.7, 10.8] as [number, number] }, value: 0, unit: 'ug/m3' as const,
      passwordHash: 'must-not-leak', internalAttempt: 'private' };
    expect(toReadingDto(document)).toEqual({ id: document._id.toHexString(), datasetId: datasetId.toHexString(),
      sensorId: document.sensorId.toHexString(), ts: '2026-11-14T01:00:00.000Z', location: document.location, value: 0, unit: 'ug/m3' });
    expect(toObjectId(document._id.toHexString()).equals(document._id)).toBe(true);
    expect(() => toObjectId('station-source-code')).toThrow();
    expect(() => toUtcIso(new Date('invalid'))).toThrow();
    assertSameDataset(datasetId, document);
    expect(() => assertSameDataset(new ObjectId(), document)).toThrow('Cross-dataset');
    for (const coordinates of [[181, 0], [0, -91], [NaN, 0], [0], [1, 2, 3]]) expect(() => toGeoPoint(coordinates)).toThrow();
    for (const value of [-1, NaN, Infinity]) expect(() => toReadingDto({ ...document, value })).toThrow();
  });
});

describe('idempotency boundary (no durable store yet)', () => {
  it('checks UUID headers and preserves replay status/body and conflict semantics', () => {
    const key = '12345678-1234-4000-8000-123456789abc';
    expect(requireIdempotencyKey(key)).toBe(key);
    for (const bad of [undefined, [], '', 'uuid', `${key},${key}`]) expect(() => requireIdempotencyKey(bad)).toThrow();
    const response = { statusCode: 201, body: { data: { id: 'same-object' } } };
    expect(replayOrThrow({ outcome: 'completed', response })).toBe(response);
    expect(() => replayOrThrow({ outcome: 'processing' })).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(() => replayOrThrow({ outcome: 'payload_mismatch' })).toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});

describe('readiness service with explicit test doubles', () => {
  it('reports dependency status without returning a driver error', async () => {
    const now = () => new Date('2026-11-14T00:00:00Z');
    expect(await createHealthService({ ping: async () => true }, now).readiness()).toEqual({
      statusCode: 200, body: { status: 'ok', timestamp: now().toISOString() },
    });
    expect((await createHealthService({ ping: async () => false }, now).readiness()).statusCode).toBe(503);
    expect((await createHealthService({ ping: async () => { throw new Error('credentials'); } }, now).readiness()).body.status).toBe('degraded');
  });
});
