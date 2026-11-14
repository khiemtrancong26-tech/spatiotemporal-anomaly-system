import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadTestConfig } from './helpers.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import type { ImportTestHooks } from '../src/modules/datasets/import.types.js';

let mongo: MongoMemoryReplSet, client: MongoClient;
const apps: FastifyInstance[] = [], directories: string[] = [];
const source = await readFile(new URL('./fixtures/b4-boundaries.csv', import.meta.url), 'utf8');
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  client = await new MongoClient(mongo.getUri()).connect();
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(resolve(tmpdir()) + sep) || !directory.includes('pm25-b4-')) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
afterAll(async () => { await client?.close(); await mongo?.stop(); });
async function fixture(hooks: ImportTestHooks = {}) {
  const database = `b4_${randomUUID().replaceAll('-', '')}`, directory = await mkdtemp(resolve(tmpdir(), 'pm25-b4-'));
  directories.push(directory);
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri(database), IMPORT_STORAGE_DIR: directory, LOG_LEVEL: 'silent', IMPORT_BATCH_SIZE: '2' });
  const app = buildApp({ config, logger: false, importTestHooks: hooks }); apps.push(app); await app.ready();
  const db = client.db(database), userId = new ObjectId();
  await db.collection('users').insertOne({ _id: userId, username: 'B4 real JWT fixture', role: 'analyst', isActive: true });
  const token = await createTokens(config.jwtSecret).issue(userId.toHexString()), headers = { authorization: `Bearer ${token}` };
  const get = (kind: string, query: Record<string, string | number> = {}) => app.inject({ url: `/api/v1/${kind}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`, headers });
  const map = (id: string) => app.inject({ method: 'PUT', url: `/api/v1/datasets/${id}/mapping`, headers,
    payload: { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value', name: 'name', region: 'region', unit: 'unit' }, unit: 'ug/m3' } });
  const run = (id: string) => app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...headers, 'idempotency-key': randomUUID() } });
  async function upload(csv = source) {
    const boundary = `b4-${randomUUID()}`;
    const response = await app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...headers,
      'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="boundaries.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`) });
    expect(response.statusCode, response.body).toBe(201); return response.json().data.id as string;
  }
  async function ready(csv = source) {
    const id = await upload(csv); expect((await map(id)).statusCode).toBe(200);
    const imported = await run(id); expect(imported.statusCode, imported.body).toBe(200); return id;
  }
  async function all(kind: string, query: Record<string, string | number>) {
    const rows: Record<string, unknown>[] = [], seen = new Set<string>(); let cursor: string | null = null;
    do {
      const response = await get(kind, { ...query, ...(cursor ? { cursor } : {}) }); expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toMatch(/"_id"|importAttemptId|sourceRowNumber|password|checksum/);
      const body = response.json(); expect(body.data.length).toBeLessThanOrEqual(Number(query.limit ?? 100));
      rows.push(...body.data); cursor = body.page.nextCursor;
      if (cursor) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); }
    } while (cursor);
    return rows;
  }
  return { app, config, db, userId, headers, get, map, run, upload, ready, all };
}
describe('B4 Query HTTP on actual B3 imports and MongoDB replica set', () => {
  it('queries actual import with inclusive bbox/time, point/line/world rectangles and canonical UTC DTOs', async () => {
    const f = await fixture(), datasetId = await f.ready();
    const sensors = await f.all('sensors', { datasetId, bbox: '106,10,107,11', limit: 2 });
    expect(sensors.map(sensor => sensor.externalId)).toEqual(['C', 'N', 'NE', 'SW']);
    expect(sensors[0]).toMatchObject({ datasetId, type: 'pm25', unit: 'ug/m3', region: 'Fixture B4', location: { type: 'Point', coordinates: [106.5, 10.5] } });
    const query = { datasetId, bbox: '106,10,107,11', from: '2026-11-14T00:00:00Z', to: '2026-11-14T01:00:00Z', limit: 1 };
    const readings = await f.all('readings', query);
    expect(readings).toHaveLength(5); expect(readings.map(reading => reading.value).sort((a, b) => Number(a) - Number(b))).toEqual([0, 10, 20, 50, 100]);
    expect(readings.every(reading => /^\d{4}.*\.\d{3}Z$/.test(String(reading.ts)))).toBe(true);
    const exact = await f.all('readings', { datasetId, from: query.from, to: query.from });
    expect(exact).toHaveLength(2); expect(exact.every(reading => reading.ts === '2026-11-14T00:00:00.000Z')).toBe(true);
    expect(await f.all('sensors', { datasetId, bbox: '106.5,10.5,106.5,10.5' })).toHaveLength(1);
    expect(await f.all('sensors', { datasetId, bbox: '106,11,107,11' })).toHaveLength(2);
    expect(await f.all('readings', { datasetId, bbox: '-180,-90,180,90' })).toHaveLength(8);
    expect(await f.all('readings', { datasetId, from: '2026-11-14T01:00:00.001Z' })).toHaveLength(1);
    expect(await f.all('readings', { datasetId, to: '2026-11-13T23:59:59.999Z' })).toHaveLength(1);
    expect((await f.get('readings', { datasetId, bbox: '0,0,1,1' })).json()).toEqual({ data: [], page: { limit: 100, nextCursor: null } });
  });
  it('paginates asc/desc through equal timestamps without duplicates, and binds all filters/operation/dataset', async () => {
    const f = await fixture(), datasetId = await f.ready(), other = await f.ready();
    const asc = await f.all('readings', { datasetId, limit: 2 }), desc = await f.all('readings', { datasetId, limit: 3, sort: 'ts:desc' });
    expect(asc).toHaveLength(8); expect(new Set(asc.map(row => row.id)).size).toBe(8);
    expect(desc.map(row => row.id)).toEqual(asc.map(row => row.id).reverse());
    const sensorsAsc = await f.all('sensors', { datasetId, limit: 1 }), sensorsDesc = await f.all('sensors', { datasetId, limit: 2, sort: 'externalId:desc' });
    expect(sensorsDesc.map(row => row.id)).toEqual(sensorsAsc.map(row => row.id).reverse());
    const first = (await f.get('readings', { datasetId, limit: 1 })).json(), cursor = first.page.nextCursor;
    for (const changed of [{ datasetId: other }, { bbox: '106,10,107,11' }, { from: '2026-11-14T00:00:00Z' }, { to: '2026-11-14T01:00:00Z' }, { sensorId: String(sensorsAsc[0]!.id) }, { sort: 'ts:desc' }]) {
      const invalid = await f.get('readings', { datasetId, cursor, ...changed }); expect(invalid.statusCode).toBe(400); expect(invalid.json().error.code).toBe('INVALID_CURSOR');
    }
    expect((await f.get('sensors', { datasetId, cursor })).statusCode).toBe(400);
    for (const bad of ['x'.repeat(4097), `${cursor}x`, 'bad.cursor', '']) expect((await f.get('readings', { datasetId, cursor: bad })).statusCode).toBe(400);
    expect((await f.get('readings', { datasetId, cursor, limit: 200 })).json().data).toHaveLength(7);
    expect((await f.get('readings', { datasetId, limit: 200 })).json().page).toEqual({ limit: 200, nextCursor: null });
  });
  it('isolates datasets, verifies the internal sensor reference and reads the persisted location snapshot', async () => {
    const f = await fixture(), datasetId = await f.ready(), other = await f.ready();
    const sensor = (await f.get('sensors', { datasetId, bbox: '106.5,10.5,106.5,10.5' })).json().data[0];
    expect((await f.get('readings', { datasetId, sensorId: sensor.id })).json().data).toHaveLength(4);
    for (const sensorId of [sensor.externalId, new ObjectId().toHexString(), 'opaque-sensor']) {
      const rejected = await f.get('readings', { datasetId, sensorId }); expect(rejected.statusCode).toBe(422); expect(rejected.json().error.code).toBe('SENSOR_NOT_IN_DATASET');
    }
    expect((await f.get('readings', { datasetId: other, sensorId: sensor.id })).json().error.code).toBe('SENSOR_NOT_IN_DATASET');
    // Deliberate persistence fixture change: queries must use Reading.location, not
    // silently join today's Sensor location over the stored snapshot.
    await f.db.collection('sensors').updateOne({ _id: new ObjectId(sensor.id) }, { $set: { location: { type: 'Point', coordinates: [105, 9] } } });
    const readings = await f.get('readings', { datasetId, sensorId: sensor.id, bbox: '106.5,10.5,106.5,10.5' });
    expect(readings.statusCode).toBe(200); expect(readings.json().data).toHaveLength(4);
    expect(readings.json().data.every((reading: { location: { coordinates: number[] } }) => reading.location.coordinates.join(',') === '106.5,10.5')).toBe(true);
    expect((await f.get('sensors', { datasetId, bbox: '106.5,10.5,106.5,10.5' })).json().data).toHaveLength(0);
    expect((await f.get('readings', { datasetId: datasetId.toUpperCase(), sensorId: sensor.id.toUpperCase() })).json().data).toHaveLength(4);
  });
  it('rejects every non-imported parent even when partial readings/sensors exist, and unknown opaque IDs return 422', async () => {
    const f = await fixture(), datasetId = await f.ready();
    for (const status of ['uploaded', 'awaiting_mapping', 'importing', 'failed']) {
      await f.db.collection('datasets').updateOne({ _id: new ObjectId(datasetId) }, { $set: { status } });
      for (const kind of ['sensors', 'readings']) {
        const response = await f.get(kind, { datasetId }); expect(response.statusCode).toBe(422); expect(response.json()).toEqual({ error: { code: 'DATASET_NOT_READY', message: expect.any(String) } });
      }
    }
    expect(await f.db.collection('readings').countDocuments({})).toBe(8);
    for (const datasetId of ['unknown/opaque ID', new ObjectId().toHexString()]) {
      for (const kind of ['sensors', 'readings']) expect((await f.get(kind, { datasetId })).json().error.code).toBe('DATASET_NOT_FOUND');
    }
  });
  it('closes the B3 → B4 visibility gate during a real partial batch, failed cleanup and explicit retry', async () => {
    let enter!: () => void, resume!: () => void, failOnce = true;
    const entered = new Promise<void>(resolve => { enter = resolve; }), blocked = new Promise<void>(resolve => { resume = resolve; });
    const f = await fixture({ afterBatch: async () => { if (failOnce) { enter(); await blocked; failOnce = false; throw new Error('B4 visibility fault'); } } });
    const datasetId = await f.upload(); expect((await f.map(datasetId)).statusCode).toBe(200);
    const pending = f.run(datasetId); await entered;
    try {
      expect(await f.db.collection('readings').countDocuments({})).toBe(2);
      for (const kind of ['sensors', 'readings']) expect((await f.get(kind, { datasetId })).json().error.code).toBe('DATASET_NOT_READY');
      expect((await f.get('datasets')).json().data).toEqual([]);
    } finally { resume(); }
    expect((await pending).statusCode).toBe(503);
    expect(await f.db.collection('readings').countDocuments({})).toBe(0);
    expect((await f.get('readings', { datasetId })).statusCode).toBe(422);
    expect((await f.map(datasetId)).statusCode).toBe(200); expect((await f.run(datasetId)).statusCode).toBe(200);
    expect((await f.get('readings', { datasetId })).json().data).toHaveLength(8);
  });
  it('distinguishes 400 syntax/schema/cursor from 422 semantics and keeps auth/405/deferred routes intact', async () => {
    const f = await fixture(), datasetId = await f.ready();
    for (const kind of ['sensors', 'readings']) {
      expect((await f.get(kind)).statusCode).toBe(400);
      for (const query of [{ datasetId: '' }, { limit: 201 }, { limit: 0 }, { limit: 'x' }, { limit: '1e2' }, { sort: 'value:asc' }, { region: 'x' }, { search: 'x' }, { cursor: '' }]) expect((await f.get(kind, { datasetId, ...query })).statusCode).toBe(400);
      for (const bbox of ['1,2,3', '106,11,107,10', '181,0,182,1', '170,0,-170,10', 'NaN,0,1,1', '1,,2,3']) expect((await f.get(kind, { datasetId, bbox })).statusCode).toBe(422);
      expect((await f.app.inject({ url: `/api/v1/${kind}?datasetId=${datasetId}` })).statusCode).toBe(401);
      const method = await f.app.inject({ method: 'POST', url: `/api/v1/${kind}` }); expect(method.statusCode).toBe(405); expect(method.headers.allow).toBe('GET');
    }
    for (const time of ['bad', '2026-11-14T00:00:00']) expect((await f.get('readings', { datasetId, from: time })).statusCode).toBe(400);
    for (const time of ['2026-11-14T07:00:00+07:00', '2026-11-14T00:00:00.1234Z']) expect((await f.get('readings', { datasetId, from: time })).statusCode).toBe(422);
    expect((await f.get('readings', { datasetId, from: '2026-11-15T00:00:00Z', to: '2026-11-14T00:00:00Z' })).statusCode).toBe(422);
    expect((await f.app.inject({ url: `/api/v1/readings?datasetId=${datasetId}&datasetId=other`, headers: f.headers })).statusCode).toBe(400);
    for (const kind of ['reading-aggregates', 'reading-batches', 'exports', 'review-changes', 'anomalies']) expect((await f.get(kind)).statusCode).toBe(404);
    expect((await f.get('analysis-runs', { datasetId })).statusCode).toBe(200); // Implemented in B5.
  });
  it('does not claim snapshot pagination when readings change between pages', async () => {
    const f = await fixture(), datasetId = await f.ready();
    const first = (await f.get('readings', { datasetId, limit: 1 })).json(), sensorId = first.data[0].sensorId;
    const make = (ts: string) => ({ datasetId: new ObjectId(datasetId), sensorId: new ObjectId(sensorId), ts: new Date(ts), value: 1, unit: 'ug/m3', location: { type: 'Point', coordinates: [106.5, 10.5] } });
    const before = await f.db.collection('readings').insertOne(make('2026-11-13T00:00:00Z'));
    const after = await f.db.collection('readings').insertOne(make('2026-11-15T00:00:00Z'));
    const rest = await f.all('readings', { datasetId, limit: 2, cursor: first.page.nextCursor });
    expect(rest.some(reading => reading.id === before.insertedId.toHexString())).toBe(false);
    expect(rest.some(reading => reading.id === after.insertedId.toHexString())).toBe(true);
    expect(rest.some(reading => reading.id === first.data[0].id)).toBe(false);
  });
  it('returns a sanitized 500 on database failure rather than an empty success page', async () => {
    const f = await fixture(), datasetId = await f.ready(); await f.app.mongo.client.close();
    const response = await f.get('readings', { datasetId }); expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  });
  it('bounds each HTTP page to 200 rows while allowing traversal beyond the FE 2,000-point display budget', async () => {
    const f = await fixture(), datasetId = await f.ready();
    const sensor = await f.db.collection('sensors').findOne({ datasetId: new ObjectId(datasetId), externalId: 'C' });
    if (!sensor) throw new Error('Missing B3 sensor');
    // Additional synthetic persistence fixture, clearly separate from the 8 B3-imported readings.
    await f.db.collection('readings').insertMany(Array.from({ length: 2105 }, (_, index) => ({ datasetId: new ObjectId(datasetId),
      sensorId: sensor._id, ts: new Date(Date.UTC(2027, 0, 1) + index * 1000), location: sensor.location, value: 0, unit: 'ug/m3' })));
    const page = await f.get('readings', { datasetId, limit: 200 });
    expect(page.statusCode).toBe(200); expect(page.json().data).toHaveLength(200); expect(page.json().page.nextCursor).toBeTruthy();
    const all = await f.all('readings', { datasetId, limit: 200 });
    expect(all).toHaveLength(2113); expect(new Set(all.map(reading => reading.id)).size).toBe(2113);
  });
  it('keeps Sensor cursors compact for long external IDs and rejects an anchor renamed/deleted between pages', async () => {
    const f = await fixture();
    const longId = `A${'Trạm'.repeat(2000)}`;
    const datasetId = await f.ready(source.replace(/^SW,/m, `${longId},`));
    const first = (await f.get('sensors', { datasetId, limit: 1 })).json();
    expect(first.data[0].externalId).toBe(longId); expect(first.page.nextCursor.length).toBeLessThan(512);
    const next = await f.get('sensors', { datasetId, limit: 1, cursor: first.page.nextCursor });
    expect(next.statusCode, next.body).toBe(200); expect(next.json().data[0].externalId).toBe('C');
    await f.db.collection('sensors').updateOne({ _id: new ObjectId(first.data[0].id) }, { $set: { externalId: 'renamed' } });
    expect((await f.get('sensors', { datasetId, cursor: first.page.nextCursor })).statusCode).toBe(400);
    await f.db.collection('sensors').deleteOne({ _id: new ObjectId(first.data[0].id) });
    expect((await f.get('sensors', { datasetId, cursor: first.page.nextCursor })).statusCode).toBe(400);
  });
  it('keeps exact rectangle membership after geo prefiltering at poles, ±180°, corners and zero-area boxes', async () => {
    const f = await fixture();
    const points: [number, number][] = [[-180, -90], [180, 90], [-180, 90], [180, -90], [179.5, 89.5], [-179.5, -89.5],
      [106, 10], [107, 11], [106.5, 11.0001], [0, 0], [170, 0], [-170, 0]];
    const csv = `${source.split('\n')[0]}\n${points.map(([lon, lat], index) => `E${index},Edge ${index},${lat},${lon},2026-11-14T00:00:00Z,0,ug/m3,Fixture B4`).join('\n')}\n`;
    const datasetId = await f.ready(csv);
    for (const bbox of [[-180, -90, 180, 90], [106, 10, 107, 11], [0, 0, 0, 0], [179, 89, 180, 90], [-180, -90, -179, -89], [-180, 90, 180, 90], [180, 90, 180, 90], [-170, -1, 170, 1]]) {
      const expected = points.filter(([lon, lat]) => lon >= bbox[0]! && lon <= bbox[2]! && lat >= bbox[1]! && lat <= bbox[3]!).map(point => point.join(',')).sort();
      for (const kind of ['sensors', 'readings']) {
        const response = await f.get(kind, { datasetId, bbox: bbox.join(',') }); expect(response.statusCode, response.body).toBe(200);
        expect(response.json().data.map((row: { location: { coordinates: number[] } }) => row.location.coordinates.join(',')).sort()).toEqual(expected);
      }
    }
  });
});
