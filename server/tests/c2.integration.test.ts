import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { DatasetProfileSchema, ReadingAggregationSchema } from '@pm25/shared-core';
import { buildApp } from '../src/app.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { configureExplorationMetadata } from '../src/modules/exploration/exploration.metadata.js';
import { loadTestConfig } from './helpers.js';
import metadata from './fixtures/beijing-exploration-metadata.json' with { type: 'json' };
let mongo: MongoMemoryReplSet, client: MongoClient;
const apps: FastifyInstance[] = [], dirs: string[] = [];
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 }, instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] }); client = await new MongoClient(mongo.getUri()).connect(); });
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); for (const dir of dirs.splice(0)) { if (!dir.startsWith(join(tmpdir(), 'pm25-c2-'))) throw new Error('Unsafe cleanup'); await rm(dir, { recursive: true, force: true }); } });
afterAll(async () => { await client?.close(); await mongo?.stop(); });
async function fixture(env: NodeJS.ProcessEnv = {}) {
  const name = 'c2_' + randomUUID().replaceAll('-', ''), dir = await mkdtemp(join(tmpdir(), 'pm25-c2-')); dirs.push(dir);
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri(name), IMPORT_STORAGE_DIR: dir, LOG_LEVEL: 'silent', ...env });
  const app = buildApp({ config, logger: false, analysisWorkerEnabled: false }); apps.push(app); await app.ready();
  const db = client.db(name), user = new ObjectId(), dataset = new ObjectId(), sensor = new ObjectId();
  await db.collection('users').insertOne({ _id: user, role: 'analyst', isActive: true });
  await db.collection('datasets').insertOne({ _id: dataset, status: 'imported' });
  await db.collection('sensors').insertOne({ _id: sensor, datasetId: dataset, location: { type: 'Point', coordinates: [116, 40] } });
  const headers = { authorization: 'Bearer ' + await createTokens(config.jwtSecret).issue(user.toHexString()) };
  const get = (url: string, params: [string, string][] = []) => app.inject({ url: url + '?' + new URLSearchParams(params), headers });
  const profile = (params: [string, string][] = []) => get(`/api/v1/datasets/${dataset}/profile`, params);
  const aggregates = (params: [string, string][] = []) => get('/api/v1/reading-aggregates', [ ['datasetId', String(dataset)], ['from', '2015-03-26T12:00:00Z'], ['to', '2015-03-26T15:00:00Z'], ['bucket', 'hour'], ...params ]);
  const insert = (ts: string, value: number, s = sensor) => db.collection('readings').insertOne({ datasetId: dataset, sensorId: s, ts: new Date(ts), value, unit: 'ug/m3', location: { type: 'Point', coordinates: [116, 40] } });
  return { app, db, headers, config, dataset, sensor, user, get, profile, aggregates, insert };
}
it('uses the real B3 import and Mongo aggregates to reproduce the complete Beijing golden grid, events and timezone day boundaries', async () => {
  const f = await fixture(), bytes = await readFile(new URL('./fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url));
  const boundary = 'c2' + randomUUID();
  const upload = await f.app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...f.headers, 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="beijing.csv"\r\nContent-Type: text/csv\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  expect(upload.statusCode, upload.body).toBe(201); const id = upload.json().data.id;
  const mapping = await f.app.inject({ method: 'PUT', url: `/api/v1/datasets/${id}/mapping`, headers: f.headers, payload: { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value', unit: 'unit' }, unit: 'ug/m3' } }); expect(mapping.statusCode, mapping.body).toBe(200);
  const imported = await f.app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...f.headers, 'idempotency-key': randomUUID() } }); expect(imported.statusCode, imported.body).toBe(200);
  const before = await f.get(`/api/v1/datasets/${id}/profile`); expect(before.statusCode, before.body).toBe(200); expect(before.json().data.dataset.coverage.status).toBe('unknown');
  await configureExplorationMetadata(f.db, id, metadata);
  const start = performance.now(), response = await f.get(`/api/v1/datasets/${id}/profile`), elapsed = performance.now() - start;
  expect(response.statusCode, response.body).toBe(200); const p = DatasetProfileSchema.parse(response.json().data);
  expect(p.dataset).toMatchObject({ readingCount: 8782, sensorCount: 12, sensorsWithReadings: 12, min: 3, max: 369, observedFrom: metadata.sampling.expectedFrom, observedTo: metadata.sampling.expectedTo,
    coverage: { expectedSlots: 8928, observedSlots: 8782, missingSlots: 146, unexpectedReadings: 0 } });
  expect(p.sourceQuality).toMatchObject({ totalRows: 8782, importedRows: 8782, invalidRows: 0, missingValueRows: null });
  const query: [string, string][] = [['datasetId', id], ['from', metadata.sampling.expectedFrom], ['to', metadata.sampling.expectedTo], ['bucket', 'hour']];
  const t = performance.now(), hourly = await f.get('/api/v1/reading-aggregates', query), aggMs = performance.now() - t;
  expect(hourly.statusCode, hourly.body).toBe(200); const a = ReadingAggregationSchema.parse(hourly.json().data);
  expect(a.series).toHaveLength(12); expect(a.series.every(s => s.buckets.length === 744)).toBe(true);
  expect(a.series.flatMap(s => s.buckets).reduce((n, b) => n + b.count, 0)).toBe(8782);
  expect(a.series.flatMap(s => s.buckets).filter(b => b.count === 0)).toHaveLength(146);
  const event = a.series.map(s => s.buckets.find(b => b.start === '2015-03-16T11:00:00.000Z')!);
  expect(event.every(b => b.count === 1)).toBe(true); expect(event.reduce((n, b) => n + b.mean!, 0) / 12).toBe(315.5);
  const sensor = await f.db.collection('sensors').findOne({ datasetId: new ObjectId(id), externalId: 'Nongzhanguan' });
  const series = a.series.find(s => s.sensorId === String(sensor!._id))!;
  expect(series.buckets.find(b => b.start === '2015-03-26T13:00:00.000Z')?.mean).toBe(369);
  for (const h of ['14', '15']) expect(series.buckets.find(b => b.start === `2015-03-26T${h}:00:00.000Z`)).toMatchObject({ count: 0, mean: null, coverage: { missingSlots: 1, ratio: 0 } });
  const daily = await f.get('/api/v1/reading-aggregates', query.map(([k, v]) => [k, k === 'bucket' ? 'day' : v])); expect(daily.statusCode, daily.body).toBe(200);
  expect(daily.json().data.series[0].buckets).toHaveLength(31); expect(daily.json().data.series[0].buckets[0].start).toBe(metadata.sampling.expectedFrom);
  const explanation = await f.db.collection('readings').find({ datasetId: new ObjectId(id) }).explain('executionStats');
  console.info('C2 golden measurements', JSON.stringify({ profileMs: elapsed, hourlyMs: aggMs, hourlyBytes: Buffer.byteLength(hourly.body), examined: explanation.executionStats.totalDocsExamined, returned: explanation.executionStats.nReturned, nodeRss: process.memoryUsage().rss }));
}, 60000);
it('distinguishes unknown, empty, not-applicable, off-grid and closed boundaries without filling readings', async () => {
  const f = await fixture(); await f.insert('2015-03-26T13:00:00Z', 369); await f.insert('2015-03-26T13:30:00Z', 10);
  expect((await f.profile()).json().data.dataset.coverage).toMatchObject({ status: 'unknown', missingSlots: null });
  await configureExplorationMetadata(f.db, String(f.dataset), metadata);
  const a = await f.aggregates(); expect(a.statusCode, a.body).toBe(200);
  expect(a.json().data.series[0].buckets.map((b: { count: number }) => b.count)).toEqual([0, 2, 0, 0]);
  expect(a.json().data.series[0].buckets[1]).toMatchObject({ mean: 189.5, coverage: { observedSlots: 1, unexpectedReadings: 1 } });
  const exact = await f.profile([['from', '2015-03-26T13:00:00Z'], ['to', '2015-03-26T13:00:00Z']]); expect(exact.json().data.scoped.readingCount).toBe(1);
  const noSlot = await f.profile([['from', '2015-03-26T13:15:00Z'], ['to', '2015-03-26T13:45:00Z']]);
  expect(noSlot.json().data.scoped.coverage).toMatchObject({ status: 'not_applicable', expectedSlots: 0, ratio: null, unexpectedReadings: 1 });
  const empty = await f.profile([['from', '2015-03-26T14:00:00Z'], ['to', '2015-03-26T15:00:00Z']]);
  expect(empty.json().data.scoped).toMatchObject({ readingCount: 0, mean: null, sensorCount: 1, coverage: { missingSlots: 2, ratio: 0 } });
});
it('handles repeated opaque IDs, exact bbox intersection and metadata updates without exposing raw private fields', async () => {
  const f = await fixture(), second = new ObjectId(); await f.db.collection('sensors').insertOne({ _id: second, datasetId: f.dataset, location: { type: 'Point', coordinates: [117, 41] } });
  await f.insert('2015-03-26T13:00:00Z', 2); await f.insert('2015-03-26T13:00:00Z', 4, second);
  const both = await f.profile([['sensorIds', String(f.sensor)], ['sensorIds', String(second)]]); expect(both.statusCode, both.body).toBe(200); expect(both.json().data.scoped.readingCount).toBe(2);
  // Second sensor's snapshot is inside bbox, but metadata is outside: C2 explicitly intersects both.
  const boxed = await f.profile([['bbox', '116,40,116,40']]); expect(boxed.json().data.scoped).toMatchObject({ sensorCount: 1, readingCount: 1 });
  expect((await f.profile([['sensorIds', String(f.sensor)], ['sensorIds', String(f.sensor)]])).statusCode).toBe(422);
  expect((await f.profile([['sensorIds', String(new ObjectId())]])).statusCode).toBe(422);
  expect((await f.profile([['sensorIds', 'opaque,not-an-objectid']])).statusCode).toBe(422);
  const v1 = await configureExplorationMetadata(f.db, String(f.dataset), metadata), v2 = await configureExplorationMetadata(f.db, String(f.dataset), { ...metadata, timeZone: 'UTC' }); expect(v2.version).toBe(v1.version! + 1);
  const profile = await f.profile(); expect(profile.body).not.toMatch(/"_id"|createdBy|checksum|password/); expect(profile.json().data.metadata.timeZone).toBe('UTC');
  expect((await f.aggregates()).json().data.metadataVersion).toBe(v2.version);
});
it('enforces imported visibility, auth, strict input, UTC precision and range/bbox semantics', async () => {
  const f = await fixture();
  expect((await f.app.inject(`/api/v1/datasets/${f.dataset}/profile`)).statusCode).toBe(401);
  for (const query of [[['extra', '1']], [['from', 'not-time']]] as [string, string][][]) expect((await f.profile(query)).statusCode).toBe(400);
  for (const query of [[['from', '2015-03-26T13:00:00+08:00']], [['from', '2015-03-26T13:00:00.0001Z']], [['from', '2015-03-27T00:00:00Z'], ['to', '2015-03-26T00:00:00Z']], [['bbox', '120,0,110,1']]] as [string, string][][]) expect((await f.profile(query)).statusCode).toBe(422);
  const missing = await f.get(`/api/v1/datasets/${new ObjectId()}/profile`); expect(missing.statusCode).toBe(422);
  await f.db.collection('datasets').updateOne({ _id: f.dataset }, { $set: { status: 'importing' } });
  expect((await f.profile()).json().error.code).toBe('DATASET_NOT_READY'); expect((await f.aggregates()).statusCode).toBe(422);
  await expect(configureExplorationMetadata(f.db, String(f.dataset), metadata)).rejects.toThrow('imported');
});
it('rejects bounded-complete reading, series, cell and byte overflow rather than returning partial success', async () => {
  const f = await fixture({ EXPLORATION_MAX_READINGS: '1' }); await f.insert('2015-03-26T13:00:00Z', 1); await f.insert('2015-03-26T14:00:00Z', 2);
  expect((await f.profile()).json().error.code).toBe('EXPLORATION_READING_LIMIT'); expect((await f.aggregates()).statusCode).toBe(422);
  const byte = await fixture({ EXPLORATION_MAX_RESPONSE_BYTES: '100' }); expect((await byte.profile()).json().error.code).toBe('EXPLORATION_RESPONSE_TOO_LARGE');
  const cell = await fixture({ EXPLORATION_MAX_CELLS: '2' }); expect((await cell.aggregates()).json().error.code).toBe('EXPLORATION_CELL_LIMIT');
  const series = await fixture({ EXPLORATION_MAX_SERIES: '1' }); await series.db.collection('sensors').insertOne({ datasetId: series.dataset, location: { type: 'Point', coordinates: [0, 0] } }); expect((await series.aggregates()).json().error.code).toBe('EXPLORATION_SERIES_LIMIT');
  const tooLong = await f.get('/api/v1/reading-aggregates', [['datasetId', String(f.dataset)], ['bucket', 'hour'], ['from', '2015-01-01T00:00:00Z'], ['to', '2015-03-01T00:00:00Z']]); expect(tooLong.json().error.code).toBe('EXPLORATION_RANGE_LIMIT');
});
it('cancels a genuinely blocked Mongo command at the deadline and recovers capacity afterward', async () => {
  const f = await fixture({ EXPLORATION_TIMEOUT_MS: '100' }); await f.insert('2015-03-26T13:00:00Z', 1);
  const admin = client.db('admin');
  await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['aggregate'], blockConnection: true, blockTimeMS: 500 } });
  try { const response = await f.profile(); expect(response.statusCode, response.body).toBe(503); expect(response.json().error.code).toBe('EXPLORATION_TIMEOUT'); }
  finally { await admin.command({ configureFailPoint: 'failCommand', mode: 'off' }); }
  const next = await f.profile(); expect(next.statusCode, next.body).toBe(200); expect(next.json().data.complete).toBe(true);
});
