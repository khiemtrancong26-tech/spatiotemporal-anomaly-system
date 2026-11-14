import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../src/app.js';
import { loadTestConfig } from './helpers.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import type { ImportTestHooks } from '../src/modules/datasets/import.types.js';
import { createReceiptRepository } from '../src/shared/persistence/idempotency.js';
import { createImportRepository } from '../src/modules/datasets/import.repository.js';

let mongo: MongoMemoryReplSet, client: MongoClient;
const apps: FastifyInstance[] = [], directories: string[] = [];
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  client = await new MongoClient(mongo.getUri()).connect();
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(resolve(tmpdir()) + sep) || !directory.includes('pm25-b3-')) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
afterAll(async () => { await client?.close(); await mongo?.stop(); });
const mapping = { fieldMap: { sensorId: 'id', latitude: 'lat', longitude: 'lon', timestamp: 'ts', value: 'v' }, unit: 'ug/m3' };
const row = (extra: object = {}) => ({ id: 'A', lat: 10, lon: 106, ts: '2026-01-01T00:00:00Z', v: 0, ...extra });
async function fixture(env: NodeJS.ProcessEnv = {}, hooks: ImportTestHooks = {}, configure: (app: FastifyInstance) => void = () => {}) {
  const name = `b3_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(resolve(tmpdir(), 'pm25-b3-')); directories.push(directory);
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri(name), IMPORT_STORAGE_DIR: directory, IMPORT_BATCH_SIZE: '2', LOG_LEVEL: 'silent', ...env });
  const app = buildApp({ config, logger: false, importTestHooks: hooks }); apps.push(app); configure(app); await app.ready();
  const userId = new ObjectId(), db = client.db(name);
  await db.collection('users').insertOne({ _id: userId, username: 'B3', role: 'analyst', isActive: true });
  const token = await createTokens(config.jwtSecret).issue(userId.toHexString());
  const headers = { authorization: `Bearer ${token}` };
  const get = (path: string) => app.inject({ url: `/api/v1/${path}`, headers });
  const map = (id: string, body: object = mapping) => app.inject({ method: 'PUT', url: `/api/v1/datasets/${id}/mapping`, headers, payload: body });
  const run = (id: string, key = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...headers, 'idempotency-key': key } });
  const upload = (source: unknown = [row()], key = randomUUID(), filename = 'input.json', media = 'application/json') => {
    const boundary = `test-${randomUUID()}`;
    const content = typeof source === 'string' ? source : JSON.stringify(source);
    return app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...headers, 'idempotency-key': key, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${media}\r\n\r\n${content}\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nB3 data\r\n--${boundary}--\r\n`) });
  };
  async function ready(source: unknown = [row()]) {
    const created = await upload(source); expect(created.statusCode, created.body).toBe(201);
    const id: string = created.json().data.id;
    const confirmed = await map(id); expect(confirmed.statusCode, confirmed.body).toBe(200);
    return id;
  }
  return { app, config, db, userId, directory, headers, get, map, run, upload, ready };
}
describe('B3 actual HTTP, files and MongoDB replica-set transactions', () => {
  it('imports first valid values across batches and UTC offsets with disjoint BR-08 counts and location snapshots', async () => {
    const f = await fixture();
    const input = [row({ v: -1 }), row(), row({ ts: '2026-01-01T07:00:00+07:00' }), row({ v: 9 }), row({ ts: '2026-01-02T00:00:00.123Z', v: 999999 })];
    const upload = await f.upload(input); expect(upload.statusCode, upload.body).toBe(201);
    const id = upload.json().data.id;
    expect((await f.get(`datasets/${id}/validation`)).json()).toMatchObject({ totalRows: 5, validRows: 5, invalidRows: 0 });
    expect((await f.get('datasets')).json().data).toEqual([]);
    expect((await f.map(id)).statusCode).toBe(200);
    const version = (await f.db.collection('datasets').findOne({ _id: new ObjectId(id) }))?.mappingVersion;
    expect((await f.map(id)).statusCode).toBe(200);
    expect((await f.db.collection('datasets').findOne({ _id: new ObjectId(id) }))?.mappingVersion).toBe(version);
    expect((await f.get(`datasets/${id}/validation`)).json()).toMatchObject({ validRows: 4, invalidRows: 1 });
    const imported = await f.run(id); expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().data.importSummary).toEqual({ totalRows: 5, importedRows: 2, duplicateRows: 1, conflictingRows: 1, invalidRows: 1,
      issues: [{ rowNumber: 1, reason: 'INVALID_ROW', field: 'value' }, { rowNumber: 3, reason: 'DUPLICATE_SAME_VALUE', keptRowNumber: 2 }, { rowNumber: 4, reason: 'DUPLICATE_VALUE_CONFLICT', keptRowNumber: 2 }] });
    const readings = await f.db.collection('readings').find({ datasetId: new ObjectId(id) }).sort({ ts: 1 }).toArray();
    expect(readings.map(reading => reading.value)).toEqual([0, 999999]);
    expect(readings[0]).toMatchObject({ location: { type: 'Point', coordinates: [106, 10] }, unit: 'ug/m3', ts: new Date('2026-01-01T00:00:00Z') });
    expect(readings[0]?.sensorId).toBeInstanceOf(ObjectId);
    expect(await f.db.collection('readings').countDocuments({ value: { $type: 'double' } })).toBe(2);
    expect((await f.get('datasets')).json().data.map((data: { id: string }) => data.id)).toEqual([id]);
    expect((await f.map(id)).statusCode).toBe(409);
    const secondId = await f.ready([row()]); expect((await f.run(secondId)).statusCode).toBe(200);
    expect(await f.db.collection('sensors').countDocuments({ externalId: 'A' })).toBe(2);
    expect(await f.db.collection('readings').countDocuments({})).toBe(3);
  });
  it('imports CSV and reports physical rows, validates types, auth, contract errors and deferred routes', async () => {
    const f = await fixture();
    const csv = 'id,lat,lon,ts,v\r\nA,10,106,2026-01-01T00:00:00Z,0\r\nbad\r\n';
    const created = await f.upload(csv, randomUUID(), 'input.csv', 'text/csv'); expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id; expect((await f.map(id)).statusCode).toBe(200);
    expect((await f.run(id)).json().data.importSummary).toMatchObject({ importedRows: 1, invalidRows: 1, issues: [{ rowNumber: 3, reason: 'INVALID_ROW' }] });
    expect((await f.run('not-an-id')).statusCode).toBe(404);
    expect((await f.get('datasets/not-an-id/validation')).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'POST', url: '/api/v1/datasets' })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: f.headers })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...f.headers, 'idempotency-key': 'bad' } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: {} })).statusCode).toBe(400);
    expect((await f.map(id, { ...mapping, extra: true })).statusCode).toBe(422);
    for (const path of ['reading-batches', 'exports', 'sensors', 'readings']) expect((await f.get(path)).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'DELETE', url: `/api/v1/datasets/${id}/mapping` })).statusCode).toBe(405);
    expect((await f.upload('{}')).statusCode).toBe(422);
    expect((await f.upload('[{},]')).statusCode).toBe(422);
    expect((await f.upload('a,a\n1,2', randomUUID(), 'input.csv', 'text/csv')).statusCode).toBe(422);
    expect((await f.upload('hello', randomUUID(), 'x.xml', 'application/xml')).statusCode).toBe(415);
    expect((await f.app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: {} })).statusCode).toBe(415);
  });
  it('rejects semantic ambiguity and all-invalid datasets without public or persisted readings', async () => {
    const f = await fixture();
    for (const [input, code] of [
      [[row(), row({ lat: 11 })], 'SENSOR_LOCATION_CONFLICT'],
      [[row({ ts: '2026-01-01T00:00:00' }), row({ ts: '2026-01-01T00:00:00.1234Z' }), row({ unit: 'mg/m3' })], 'NO_VALID_ROWS'],
    ] as const) {
      const created = await f.upload(input), id = created.json().data.id;
      const mapped = await f.map(id); expect(mapped.statusCode).toBe(422); expect(mapped.json().error.code).toBe(code);
      expect((await f.get(`datasets/${id}/validation`)).json().status).toBe('failed');
      expect((await f.run(id)).statusCode).toBe(422);
    }
    const created = await f.upload([row()]);
    expect((await f.map(created.json().data.id, { ...mapping, fieldMap: { ...mapping.fieldMap, value: 'absent' } })).statusCode).toBe(422);
    expect((await f.get('datasets')).json().data).toEqual([]); expect(await f.db.collection('readings').countDocuments({})).toBe(0);
  });
  it('replays immutable upload/import responses, rejects changed payload/operation, preserves expired keys and survives app restart', async () => {
    const f = await fixture(); const uploadKey = randomUUID();
    const created = await f.upload([row()], uploadKey), id = created.json().data.id;
    expect((await f.upload([row()], uploadKey)).json()).toEqual(created.json());
    expect((await f.upload([row({ v: 1 })], uploadKey)).statusCode).toBe(422);
    expect((await f.map(id)).statusCode).toBe(200);
    expect((await f.run(id, uploadKey)).statusCode).toBe(422);
    const importKey = randomUUID(), imported = await f.run(id, importKey); expect(imported.statusCode, imported.body).toBe(200);
    expect((await f.upload([row()], uploadKey)).json()).toEqual(created.json()); // original awaiting_mapping snapshot
    expect((await f.run(id, importKey)).json()).toEqual(imported.json());
    expect((await f.run(id)).json()).toEqual(imported.json());
    await f.app.close();
    const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
    const replay = await restarted.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...f.headers, 'idempotency-key': importKey } });
    expect(replay.json()).toEqual(imported.json()); expect(await f.db.collection('readings').countDocuments({})).toBe(1);
    await f.db.collection('idempotencyReceipts').updateOne({ key: importKey }, { $set: { expiresAt: new Date(0) } });
    const expired = await restarted.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...f.headers, 'idempotency-key': importKey } });
    expect(expired.statusCode).toBe(409); expect(expired.json().error.code).toBe('IDEMPOTENCY_EXPIRED');
    expect((await f.db.collection('idempotencyReceipts').listIndexes().toArray()).some(index => 'expireAfterSeconds' in index)).toBe(false);
  });
  it('cleans an actual committed partial batch before failed/new-key retry and replays the failed attempt', async () => {
    let failOnce = true;
    const f = await fixture({}, { afterBatch: async () => { if (failOnce) { failOnce = false; throw new Error('injected batch failure'); } } });
    const id = await f.ready([row(), row({ ts: '2026-01-02T00:00:00Z' }), row({ ts: '2026-01-03T00:00:00Z' })]), key = randomUUID();
    const failed = await f.run(id, key); expect(failed.statusCode).toBe(503);
    expect((await f.get(`datasets/${id}/validation`)).json().status).toBe('failed');
    expect(await f.db.collection('readings').countDocuments({})).toBe(0); expect(await f.db.collection('sensors').countDocuments({})).toBe(0);
    expect((await f.get('datasets')).json().data).toEqual([]);
    expect((await f.run(id, key)).json()).toEqual(failed.json()); expect((await f.run(id)).statusCode).toBe(422);
    expect((await f.map(id)).statusCode).toBe(200);
    expect((await f.run(id)).statusCode).toBe(200); expect(await f.db.collection('readings').countDocuments({})).toBe(3);
  });
  it('enforces report, record, file and station limits; duplicate overflow never publishes truncated success', async () => {
    const f = await fixture({ IMPORT_MAX_ISSUES: '1', IMPORT_MAX_FILE_BYTES: '2048', IMPORT_MAX_RECORD_BYTES: '512', IMPORT_MAX_SENSORS: '1' });
    expect((await f.upload('x'.repeat(2049), randomUUID(), 'x.csv', 'text/csv')).statusCode).toBe(413);
    expect((await f.upload([{ x: 'x'.repeat(513) }])).statusCode).toBe(422);
    const stations = (await f.upload([row(), row({ id: 'B' })])).json().data.id;
    expect((await f.map(stations)).json().error.code).toBe('SENSOR_LIMIT_EXCEEDED');
    const invalid = (await f.upload([row({ v: -1 }), row({ v: -1 }), row()])).json().data.id;
    expect((await f.map(invalid)).json().error.code).toBe('REPORT_LIMIT_EXCEEDED');
    const id = await f.ready([row(), row(), row()]);
    const response = await f.run(id); expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('REPORT_LIMIT_EXCEEDED');
    expect(await f.db.collection('readings').countDocuments({})).toBe(0); expect((await f.get('datasets')).json().data).toEqual([]);
  });
  it('returns in-flight conflicts and admission 503 without consuming a new key', async () => {
    let entered!: () => void, resume!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const f = await fixture({}, { afterBatch: async () => { entered(); await blocked; } });
    const first = await f.ready(), second = await f.ready(), firstKey = randomUUID(), secondKey = randomUUID();
    const pending = f.run(first, firstKey); await started;
    try {
      expect((await f.run(first, firstKey)).statusCode).toBe(409);
      expect((await f.run(first)).statusCode).toBe(409);
      expect((await f.map(first)).statusCode).toBe(409);
      expect((await f.run(second, secondKey)).statusCode).toBe(503);
      expect(await f.db.collection('idempotencyReceipts').countDocuments({ key: secondKey })).toBe(0);
      expect((await f.get('datasets')).json().data).toEqual([]);
    } finally { resume(); }
    expect((await pending).statusCode).toBe(200); expect((await f.run(second, secondKey)).statusCode).toBe(200);
  });
  it('fences stale owners and recovers expired partial work with a new app before intentional retry', async () => {
    const f = await fixture(), id = await f.ready();
    const receipts = createReceiptRepository(f.app.mongo.client, f.app.mongo.db, f.config.imports);
    const repository = createImportRepository(f.app.mongo.db, receipts, f.config.imports);
    const claim = await receipts.claim({ userId: f.userId.toHexString(), key: randomUUID(), operation: 'test interrupted', requestHash: 'test', resourceId: id, kind: 'import' });
    if (!('guard' in claim)) throw new Error('Expected ownership');
    const previous = await repository.get(id); await repository.start(claim.guard, previous!);
    const normalized = { rowNumber: 1, externalId: 'A', name: 'A', longitude: 106, latitude: 10, ts: '2026-01-01T00:00:00.000Z', value: 0 };
    const sensor = { id: repository.newId(), ...normalized };
    await repository.batch(claim.guard, [normalized], [sensor]);
    await f.app.close();
    await f.db.collection('idempotencyReceipts').updateOne({ _id: new ObjectId(claim.guard.id) }, { $set: { leaseUntil: new Date(0) } });
    const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
    const validation = await restarted.inject({ url: `/api/v1/datasets/${id}/validation`, headers: f.headers });
    expect(validation.statusCode, validation.body).toBe(200); expect(validation.json().status).toBe('failed');
    expect(await f.db.collection('readings').countDocuments({})).toBe(0);
    const staleReceipts = createReceiptRepository(restarted.mongo.client, restarted.mongo.db, f.config.imports);
    const staleRepository = createImportRepository(restarted.mongo.db, staleReceipts, f.config.imports);
    await expect(staleRepository.batch(claim.guard, [normalized], [sensor])).rejects.toMatchObject({ code: 'REQUEST_IN_PROGRESS' });
    expect(await f.db.collection('sensors').countDocuments({})).toBe(0);
  });
  it('returns the committed snapshot when a post-publish fault loses the normal response path', async () => {
    const f = await fixture({}, { afterPublish: async () => { throw new Error('response path failed after commit'); } });
    const id = await f.ready(), key = randomUUID();
    const response = await f.run(id, key); expect(response.statusCode).toBe(200);
    expect((await f.run(id, key)).json()).toEqual(response.json()); expect(await f.db.collection('readings').countDocuments({})).toBe(1);
  });
  it('rejects changed or missing retained sources and never makes their data public', async () => {
    const f = await fixture(), id = await f.ready();
    await writeFile(resolve(f.directory, `${id}.source`), JSON.stringify([row({ v: 5 })]));
    expect((await f.run(id)).statusCode).toBe(503);
    expect((await f.get(`datasets/${id}/validation`)).json().status).toBe('failed');
    await rm(resolve(f.directory, `${id}.source`));
    expect((await f.map(id)).statusCode).toBe(500);
    expect((await f.get('datasets')).json().data).toEqual([]); expect(await f.db.collection('readings').countDocuments({})).toBe(0);
  });
  it('replays after an actual TCP response loss without a second write', async () => {
    let loseOnce = true;
    const f = await fixture({}, {}, app => app.addHook('onSend', async (request, reply, payload) => {
      if (loseOnce && request.url.endsWith('/imports') && reply.statusCode === 200) { loseOnce = false; reply.raw.destroy(); }
      return payload;
    }));
    const id = await f.ready(), key = randomUUID();
    const url = await f.app.listen({ host: '127.0.0.1', port: 0 });
    await expect(fetch(`${url}/api/v1/datasets/${id}/imports`, { method: 'POST', headers: { ...f.headers, 'idempotency-key': key } })).rejects.toThrow();
    const replay = await fetch(`${url}/api/v1/datasets/${id}/imports`, { method: 'POST', headers: { ...f.headers, 'idempotency-key': key } });
    expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ data: { status: 'imported', importSummary: { importedRows: 1 } } });
    expect(await f.db.collection('readings').countDocuments({})).toBe(1);
  });
  it('does not let an abandoned pre-start receipt clean another live import, and isolates keys by user', async () => {
    const f = await fixture(), id = await f.ready(), key = randomUUID();
    const receipts = createReceiptRepository(f.app.mongo.client, f.app.mongo.db, f.config.imports);
    const repository = createImportRepository(f.app.mongo.db, receipts, f.config.imports);
    const intent = { userId: f.userId.toHexString(), operation: 'pre-start', requestHash: 'same', resourceId: id, kind: 'import' as const };
    const abandoned = await receipts.claim({ ...intent, key });
    const other = await receipts.claim({ ...intent, key: randomUUID() });
    if (!('guard' in abandoned) || !('guard' in other)) throw new Error('Expected guards');
    await repository.start(other.guard, (await repository.get(id))!);
    await f.db.collection('idempotencyReceipts').updateOne({ _id: new ObjectId(abandoned.guard.id) }, { $set: { leaseUntil: new Date(0) } });
    expect((await f.get(`datasets/${id}/validation`)).json().status).toBe('importing');
    expect((await repository.get(id))?.attempt?.receiptId).toBe(other.guard.id);
    expect((await receipts.snapshot(abandoned.guard))?.statusCode).toBe(503);
    const anotherUser = await receipts.claim({ ...intent, userId: new ObjectId().toHexString(), key });
    expect(anotherUser).toHaveProperty('guard');
    await repository.cleanup(other.guard); await repository.fail(other.guard, { statusCode: 503, body: { error: { code: 'TEST_END', message: 'Test ended' } } });
  });
  it('reconciles an orphan retained upload after restart without publishing a dataset', async () => {
    const f = await fixture(), id = new ObjectId().toHexString();
    const receipts = createReceiptRepository(f.app.mongo.client, f.app.mongo.db, f.config.imports);
    const claimed = await receipts.claim({ userId: f.userId.toHexString(), key: randomUUID(), operation: 'interrupted upload', requestHash: 'source', resourceId: id, kind: 'upload' });
    if (!('guard' in claimed)) throw new Error('Expected guard');
    const source = resolve(f.directory, `${id}.source`); await writeFile(source, '[{}]');
    await f.app.close();
    await f.db.collection('idempotencyReceipts').updateOne({ _id: new ObjectId(claimed.guard.id) }, { $set: { leaseUntil: new Date(0) } });
    const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted);
    const response = await restarted.inject({ url: `/api/v1/datasets/${id}/validation`, headers: f.headers });
    expect(response.statusCode).toBe(404); await expect(access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.db.collection('datasets').countDocuments({})).toBe(0);
    expect((await f.db.collection('idempotencyReceipts').findOne({ _id: new ObjectId(claimed.guard.id) }))?.status).toBe('failed');
  });
  it('recovers after killing the Backend process between committed batches', async () => {
    const f = await fixture(), id = await f.ready([row(), row({ ts: '2026-01-02T00:00:00Z' }), row({ ts: '2026-01-03T00:00:00Z' })]);
    await f.app.close();
    const worker = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/b3-worker.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, MONGODB_URI: f.config.mongodbUri, IMPORT_STORAGE_DIR: f.directory },
    });
    const messages: { event: string; url?: string }[] = [];
    worker.on('message', message => messages.push(message as { event: string; url?: string }));
    try {
      await expect.poll(() => messages.find(message => message.event === 'ready')?.url, { timeout: 10000 }).toBeTruthy();
      const url = messages.find(message => message.event === 'ready')!.url!;
      const key = randomUUID();
      const request = fetch(`${url}/api/v1/datasets/${id}/imports`, { method: 'POST', headers: { ...f.headers, 'idempotency-key': key } }).catch(() => null);
      await expect.poll(() => messages.some(message => message.event === 'batch'), { timeout: 10000 }).toBe(true);
      expect(await f.db.collection('readings').countDocuments({})).toBe(2);
      const exited = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGKILL'); await exited; await request;
      await f.db.collection('idempotencyReceipts').updateOne({ key }, { $set: { leaseUntil: new Date(0) } });
      const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted);
      expect((await restarted.inject({ url: `/api/v1/datasets/${id}/validation`, headers: f.headers })).json().status).toBe('failed');
      expect(await f.db.collection('readings').countDocuments({})).toBe(0); expect(await f.db.collection('sensors').countDocuments({})).toBe(0);
      const replay = await restarted.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...f.headers, 'idempotency-key': key } });
      expect(replay.statusCode).toBe(503);
    } finally { if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL'); }
  }, 30000);
  it('persists 5,000 readings using the approved 1,000-row batches, not one giant transaction', async () => {
    const began = performance.now();
    const batches: number[] = [];
    const f = await fixture({ IMPORT_BATCH_SIZE: '1000' }, { afterBatch: async count => { batches.push(count); } });
    const source = Array.from({ length: 5000 }, (_, index) => row({ ts: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), v: index }));
    const id = await f.ready(source), response = await f.run(id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.importSummary).toMatchObject({ totalRows: 5000, importedRows: 5000, invalidRows: 0 });
    expect(batches).toEqual([1, 2, 3, 4, 5]); expect(await f.db.collection('readings').countDocuments({})).toBe(5000);
    console.info(JSON.stringify({ event: 'b3_5000_rows', elapsedMs: Math.round(performance.now() - began), batches: batches.length }));
  }, 60000);
  it('releases upload capacity after a stalled multipart envelope reaches its deadline', async () => {
    const f = await fixture({ IMPORT_TIMEOUT_MS: '1000' });
    await f.ready(); // Index preparation is outside the transport-deadline assertion.
    const before = await f.db.collection('idempotencyReceipts').countDocuments({});
    const url = await f.app.listen({ host: '127.0.0.1', port: 0 });
    const stall = () => new Promise<void>((resolve, reject) => {
      const request = httpRequest(`${url}/api/v1/datasets`, { method: 'POST', headers: { ...f.headers,
        'idempotency-key': randomUUID(), 'content-type': 'multipart/form-data; boundary=unfinished' } });
      const watchdog = setTimeout(() => { request.destroy(); reject(new Error('Upload deadline failed')); }, 3000);
      request.on('error', () => { clearTimeout(watchdog); resolve(); });
      request.on('response', response => { response.resume(); response.on('end', () => { clearTimeout(watchdog); resolve(); }); });
      request.write('--unfinished\r\nContent-Disposition: form-data; name="name"\r\n\r\npartial');
    });
    await Promise.all([stall(), stall()]);
    const uploaded = await f.upload(); expect(uploaded.statusCode, uploaded.body).toBe(201);
    expect(await f.db.collection('idempotencyReceipts').countDocuments({})).toBe(before + 1);
  });
});
