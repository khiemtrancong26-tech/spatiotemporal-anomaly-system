import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AnomalySchema } from '@pm25/shared-core/contracts';
import { buildApp } from '../src/app.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { loadTestConfig } from './helpers.js';
import { createAnomalyRepository } from '../src/modules/anomalies/anomalies.repository.js';
import { createAnomalyService } from '../src/modules/anomalies/anomalies.service.js';
import { createAnomalyReviewAccess } from '../src/modules/anomalies/index.js';
import { createCursorCodec } from '../src/shared/pagination.js';
import { ensureOnlineIndexes } from '../src/shared/persistence/indexes.js';

let mongo: MongoMemoryReplSet, client: MongoClient, directory: string;
const apps: FastifyInstance[] = [];
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'pm25-b6-'));
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  client = await new MongoClient(mongo.getUri()).connect();
});
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
afterAll(async () => {
  await client?.close(); await mongo?.stop();
  if (!directory.startsWith(resolve(tmpdir()) + sep) || !directory.includes('pm25-b6-')) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const database = `b6_${randomUUID().replaceAll('-', '')}`;
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri(database), IMPORT_STORAGE_DIR: directory, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' });
  const app = buildApp({ config, logger: false, analysisWorkerEnabled: false }); apps.push(app); await app.ready();
  const db = client.db(database), userId = new ObjectId(), datasetId = new ObjectId(), runId = new ObjectId(), sensorId = new ObjectId();
  await ensureOnlineIndexes(db);
  await db.collection('users').insertOne({ _id: userId, username: '[SEED B6] analyst', role: 'analyst', isActive: true });
  await db.collection('datasets').insertOne({ _id: datasetId, name: '[SEED B6] persistence/visibility fixtures', status: 'imported', createdBy: userId, createdAt: new Date() });
  await db.collection('analysisRuns').insertOne({ _id: runId, datasetId, family: 'statistical', method: 'zscore', config: { threshold: 3 }, scope: {}, status: 'completed', createdAt: new Date(), completedAt: new Date() });
  const headers = { authorization: `Bearer ${await createTokens(config.jwtSecret).issue(userId.toHexString())}` };
  const get = (path: string) => app.inject({ url: `/api/v1/${path}`, headers });
  const list = (query: Record<string, string | number> = {}) => get(`anomalies?${new URLSearchParams(Object.entries({ datasetId: datasetId.toHexString(), ...query }).map(([key, value]) => [key, String(value)]))}`);
  const patch = (id: string, payload: unknown) => app.inject({ method: 'PATCH', url: `/api/v1/anomalies/${id}`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  async function seed(count = 1, overrides: Record<string, unknown> = {}) {
    const documents = Array.from({ length: count }, (_, i) => ({ _id: new ObjectId(), datasetId, sensorId, readingId: new ObjectId(), analysisRunId: runId,
      ts: new Date(Date.UTC(2026, 10, 16) + Math.floor(i / 3) * 1000), location: { type: 'Point', coordinates: [106, 10] },
      family: 'statistical', method: 'zscore', score: 4, severity: 'low', status: 'open', note: '', version: 1, updatedAt: new Date(),
      _private: 'do not expose', value: 999, ...overrides }));
    await db.collection('anomalies').insertMany(documents); return documents;
  }
  return { app, db, config, userId, datasetId, runId, sensorId, headers, get, list, patch, seed };
}
describe('B6 actual HTTP/MongoDB Replica Set', () => {
  it('hides queued/running/failed/orphan/mismatched partial from every read and review, before pagination', async () => {
    const f = await fixture(), privateIds: ObjectId[] = [];
    for (const status of ['queued', 'running', 'failed']) {
      const runId = new ObjectId();
      await f.db.collection('analysisRuns').insertOne({ _id: runId, datasetId: f.datasetId, family: 'statistical', method: 'zscore', status });
      const partial = await f.seed(75, { analysisRunId: runId }); privateIds.push(partial[0]!._id);
      expect((await f.list({ analysisRunId: runId.toHexString() })).statusCode).toBe(409);
    }
    privateIds.push((await f.seed(1, { analysisRunId: new ObjectId() }))[0]!._id);
    const otherRun = new ObjectId();
    await f.db.collection('analysisRuns').insertOne({ _id: otherRun, datasetId: new ObjectId(), family: 'statistical', method: 'zscore', status: 'completed' });
    privateIds.push((await f.seed(1, { analysisRunId: otherRun }))[0]!._id);
    privateIds.push((await f.seed(1, { method: 'method-does-not-match-run' }))[0]!._id);
    const publicRows = await f.seed(2, { ts: new Date('2026-11-17T00:00:00Z') });
    const first = await f.list({ limit: 1 }); expect(first.statusCode, first.body).toBe(200); expect(first.json().data[0].id).toBe(String(publicRows[0]!._id));
    const second = await f.list({ limit: 1, cursor: first.json().page.nextCursor }); expect(second.json().data[0].id).toBe(String(publicRows[1]!._id)); expect(second.json().page.nextCursor).toBeNull();
    for (const id of privateIds) {
      expect((await f.get(`anomalies/${id}`)).statusCode).toBe(404);
      expect((await f.patch(String(id), { baseVersion: 1, changes: { note: 'must not write' } })).statusCode).toBe(404);
      expect((await f.db.collection('anomalies').findOne({ _id: id }))?.version).toBe(1);
    }
    expect((await f.list({ analysisRunId: f.runId.toHexString() })).json().data).toHaveLength(2);
  });
  it('rejects unavailable/mismatched parents and checks visibility inside the repository, not only preflight service reads', async () => {
    const f = await fixture(), [row] = await f.seed();
    expect((await f.list({ datasetId: 'opaque' })).statusCode).toBe(422);
    expect((await f.list({ analysisRunId: 'opaque' })).statusCode).toBe(422);
    const foreignRun = new ObjectId();
    await f.db.collection('analysisRuns').insertOne({ _id: foreignRun, datasetId: new ObjectId(), status: 'completed' });
    expect((await f.list({ analysisRunId: String(foreignRun) })).json().error.code).toBe('ANALYSIS_RUN_NOT_IN_DATASET');
    const repository = createAnomalyRepository(f.app.mongo.client, f.app.mongo.db);
    const stalePreflight = createAnomalyService(repository, { getState: async () => ({ id: String(f.datasetId), status: 'imported' }) },
      { getState: async () => ({ id: String(f.runId), datasetId: String(f.datasetId), status: 'completed' }) }, createCursorCodec(f.config.cursorSecret));
    await f.db.collection('datasets').updateOne({ _id: f.datasetId }, { $set: { status: 'failed' } });
    expect((await f.list()).json().error.code).toBe('DATASET_NOT_READY');
    expect((await stalePreflight.list({ datasetId: String(f.datasetId) })).data).toEqual([]);
    expect((await f.get(`anomalies/${row!._id}`)).statusCode).toBe(404);
    expect((await f.patch(String(row!._id), { baseVersion: 1, changes: { note: 'hidden' } })).statusCode).toBe(404);
    await f.db.collection('datasets').deleteOne({ _id: f.datasetId });
    expect((await f.get(`anomalies/${row!._id}`)).statusCode).toBe(404);
  });
  it('keeps equal-ts keyset order, whitelists DTOs and binds every filter/sort while allowing limit changes', async () => {
    const f = await fixture(), rows = await f.seed(11);
    for (const sort of ['ts:asc', 'ts:desc']) {
      const ids: string[] = []; let cursor: string | null = null;
      do {
        const response = await f.list({ sort, limit: cursor ? 3 : 2, ...(cursor ? { cursor } : {}) }); expect(response.statusCode, response.body).toBe(200);
        expect(response.body).not.toMatch(/_private|"_id"|"value"|reviewFence|_published/);
        const body = response.json(); for (const value of body.data) AnomalySchema.parse(value);
        ids.push(...body.data.map((a: { id: string }) => a.id)); cursor = body.page.nextCursor;
      } while (cursor);
      const expected = [...rows].sort((a, b) => a.ts.getTime() - b.ts.getTime() || String(a._id).localeCompare(String(b._id))).map(row => String(row._id));
      expect(ids).toEqual(sort === 'ts:asc' ? expected : expected.reverse());
    }
    const first = await f.list({ limit: 1 }), cursor = first.json().page.nextCursor;
    for (const filters of [{ sort: 'ts:desc' }, { status: 'confirmed' }, { severity: 'high' }, { family: 'ml' }, { method: 'iqr' },
      { from: '2026-11-16T00:00:00Z' }, { to: '2026-11-18T00:00:00Z' }, { analysisRunId: String(f.runId) }]) expect((await f.list({ cursor, ...filters })).statusCode).toBe(400);
    const detail = await f.get(`anomalies/${rows[0]!._id}`); expect(detail.statusCode).toBe(200); expect(detail.json().data).not.toHaveProperty('value');
  });
  it('filters all detector/review fields and inclusive UTC bounds without treating no matches as unavailable', async () => {
    const f = await fixture(), [original] = await f.seed(1);
    const anotherRun = new ObjectId();
    await f.db.collection('analysisRuns').insertOne({ _id: anotherRun, datasetId: f.datasetId, family: 'statistical', method: 'zscore', status: 'completed' });
    await f.seed(1, { analysisRunId: anotherRun, readingId: original!.readingId });
    const sameReading = (await f.list()).json().data.filter((a: { readingId: string }) => a.readingId === String(original!.readingId));
    expect(sameReading).toHaveLength(2); expect(new Set(sameReading.map((a: { analysisRunId: string }) => a.analysisRunId)).size).toBe(2);
    await expect(f.seed(1, { readingId: original!.readingId })).rejects.toMatchObject({ code: 11000 });
    const mlRun = new ObjectId();
    await f.db.collection('analysisRuns').insertOne({ _id: mlRun, datasetId: f.datasetId, family: 'ml', method: 'isolation_forest', status: 'completed' });
    await f.seed(1, { analysisRunId: mlRun, family: 'ml', method: 'isolation_forest', severity: 'medium', status: 'confirmed' });
    const response = await f.list({ family: 'ml', method: 'isolation_forest', severity: 'medium', status: 'confirmed', analysisRunId: String(mlRun), from: '2026-11-16T00:00:00Z', to: '2026-11-16T00:00:00.000Z' });
    expect(response.statusCode).toBe(200); expect(response.json().data).toHaveLength(1);
    expect((await f.list({ family: 'ml', severity: 'high' })).json()).toEqual({ data: [], page: { limit: 100, nextCursor: null } });
    const emptyRun = new ObjectId(); await f.db.collection('analysisRuns').insertOne({ _id: emptyRun, datasetId: f.datasetId, status: 'completed' });
    expect((await f.list({ analysisRunId: String(emptyRun) })).json().data).toEqual([]);
  });
  it('only updates review fields atomically, retains note text and returns currentVersion on stale/same-keyless PATCH retry', async () => {
    const f = await fixture(), [row] = await f.seed();
    const before = await f.get(`anomalies/${row!._id}`), immutable = before.json().data;
    const payload = { baseVersion: 1, changes: { status: 'confirmed', note: '  Dòng 1\n<script>chỉ văn bản</script> $note  ' } };
    const response = await f.patch(String(row!._id), payload); expect(response.statusCode, response.body).toBe(200);
    const updated = response.json().data; expect(updated).toMatchObject({ ...payload.changes, version: 2 });
    for (const key of ['id', 'datasetId', 'readingId', 'sensorId', 'analysisRunId', 'ts', 'location', 'family', 'method', 'score', 'severity']) expect(updated[key]).toEqual(immutable[key]);
    expect((await f.patch(String(row!._id), payload)).json().error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    const emptyNote = await f.patch(String(row!._id), { baseVersion: 2, changes: { note: '' } });
    expect(emptyNote.json().data).toMatchObject({ status: 'confirmed', note: '', version: 3 });
    // A valid CAS with the same status is still one accepted revision, not implicit replay.
    expect((await f.patch(String(row!._id), { baseVersion: 3, changes: { status: 'confirmed' } })).json().data.version).toBe(4);
  });
  it('allows exactly one same-version winner across two app instances and preserves review after restart', async () => {
    const f = await fixture(), [row] = await f.seed();
    const other = buildApp({ config: f.config, logger: false, analysisWorkerEnabled: false }); apps.push(other); await other.ready();
    const responses = await Promise.all([f.app, other].map((app, i) => app.inject({ method: 'PATCH', url: `/api/v1/anomalies/${row!._id}`, headers: f.headers,
      payload: { baseVersion: 1, changes: { note: `client-${i}` } } })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find(r => r.statusCode === 409)!.json().error.details.currentVersion).toBe(2);
    expect((await f.db.collection('datasets').findOne({ _id: f.datasetId }))?.reviewFence).toBe(1);
    expect((await f.db.collection('analysisRuns').findOne({ _id: f.runId }))?.reviewFence).toBe(1);
    await Promise.all([f.app.close(), other.close()]);
    const fresh = buildApp({ config: f.config, logger: false, analysisWorkerEnabled: false }); apps.push(fresh); await fresh.ready();
    const restarted = await fresh.inject({ url: `/api/v1/anomalies/${row!._id}`, headers: f.headers }); expect(restarted.json().data.version).toBe(2);
    expect(restarted.json().data.note).toBe(responses.find(r => r.statusCode === 200)!.json().data.note);
  });
  it('returns 404 when parent visibility changes concurrently and rolls back parent fences when persistence fails', async () => {
    for (const parent of ['datasets', 'analysisRuns']) {
      const f = await fixture(), [row] = await f.seed(), session = client.startSession(); let patch!: ReturnType<typeof f.patch>;
      try {
        await session.withTransaction(async () => {
          await f.db.collection(parent).updateOne({ _id: parent === 'datasets' ? f.datasetId : f.runId }, { $set: { status: 'failed' } }, { session });
          patch = f.patch(String(row!._id), { baseVersion: 1, changes: { note: 'must not publish' } });
          // Dispatch while a conflicting visibility transition is still uncommitted.
          void patch.then(() => {}); await new Promise(resolve => setTimeout(resolve, 50));
        });
      } finally { await session.endSession(); }
      expect((await patch).statusCode).toBe(404); expect((await f.db.collection('anomalies').findOne({ _id: row!._id }))?.version).toBe(1);
    }
    const f = await fixture(), [row] = await f.seed();
    await f.db.command({ collMod: 'anomalies', validator: { version: { $lte: 1 } }, validationLevel: 'strict' });
    const response = await f.patch(String(row!._id), { baseVersion: 1, changes: { note: 'DB rejects v2' } });
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain('validator');
    expect((await f.db.collection('anomalies').findOne({ _id: row!._id }))?.version).toBe(1);
    expect((await f.db.collection('datasets').findOne({ _id: f.datasetId }))?.reviewFence).toBeUndefined();
    expect((await f.db.collection('analysisRuns').findOne({ _id: f.runId }))?.reviewFence).toBeUndefined();
  });
  it('reconciles a real TCP response loss by GET and returns conflict on blind replay, without a second revision', async () => {
    const f = await fixture(), [row] = await f.seed(); let loseOnce = true;
    // Build a new instance so the onSend hook is registered before boot; not a mock handler.
    const app = buildApp({ config: f.config, logger: false, analysisWorkerEnabled: false }); apps.push(app);
    app.addHook('onSend', async (request, reply, payload) => {
      if (loseOnce && request.method === 'PATCH' && reply.statusCode === 200) { loseOnce = false; reply.raw.destroy(); }
      return payload;
    });
    const url = await app.listen({ host: '127.0.0.1', port: 0 }), payload = { baseVersion: 1, changes: { note: 'committed before socket loss' } };
    await expect(fetch(`${url}/api/v1/anomalies/${row!._id}`, { method: 'PATCH', headers: { ...f.headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).rejects.toThrow();
    const current = await f.get(`anomalies/${row!._id}`); expect(current.json().data).toMatchObject({ note: payload.changes.note, version: 2 });
    expect((await f.patch(String(row!._id), payload)).statusCode).toBe(409);
    expect((await f.db.collection('anomalies').findOne({ _id: row!._id }))?.version).toBe(2);
  });
  it('enforces auth, strict payload/query fields, semantic time errors, opaque IDs and deferred endpoints', async () => {
    const f = await fixture(), [row] = await f.seed();
    for (const [method, path] of [['GET', 'anomalies?datasetId=x'], ['GET', `anomalies/${row!._id}`], ['PATCH', `anomalies/${row!._id}`]] as const) expect((await f.app.inject({ method, url: `/api/v1/${path}` })).statusCode).toBe(401);
    for (const payload of [{ baseVersion: 1, changes: {} }, { baseVersion: 0, changes: { note: '' } }, { baseVersion: '1', changes: { note: '' } },
      { baseVersion: 1, changes: { score: 7 } }, { baseVersion: 1, changes: { severity: 'high' } }, { baseVersion: 1, changes: { method: 'iqr' } },
      { baseVersion: 1, changes: { status: 'closed' } }, { baseVersion: 1, changes: { note: null } }, { baseVersion: 1, changes: { note: '' }, extra: true }]) expect((await f.patch(String(row!._id), payload)).statusCode).toBe(400);
    expect((await f.patch(String(row!._id), { baseVersion: 9007199254740992, changes: { note: '' } })).statusCode).toBe(422);
    for (const query of [{ sensorId: String(f.sensorId) }, { bbox: '0,0,1,1' }, { modelVersion: 'v1' }, { sort: 'score:desc' }, { limit: '1e2' }, { from: 'bad' }, { severity: 'critical' }]) expect((await f.list(query)).statusCode).toBe(400);
    for (const query of [{ from: '2026-11-16T00:00:00+00:00' }, { from: '2026-11-16T00:00:00.0001Z' }, { from: '2026-11-17T00:00:00Z', to: '2026-11-16T00:00:00Z' }]) expect((await f.list(query)).statusCode).toBe(422);
    expect((await f.get('anomalies/opaque')).statusCode).toBe(404);
    expect((await f.patch('opaque', { baseVersion: 1, changes: { note: '' } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'DELETE', url: `/api/v1/anomalies/${row!._id}`, headers: f.headers })).statusCode).toBe(405);
    expect((await f.get('reading-aggregates')).statusCode).toBe(400); // D018/C2 promotes only time aggregation.
    for (const path of ['review-changes', 'exports']) expect((await f.get(path)).statusCode).toBe(404);
    await f.db.collection('users').updateOne({ _id: f.userId }, { $set: { role: 'admin' } });
    expect((await f.patch(String(row!._id), { baseVersion: 1, changes: { note: 'admin allowed' } })).statusCode).toBe(200);
    await f.db.collection('users').updateOne({ _id: f.userId }, { $set: { isActive: false } });
    expect((await f.list()).statusCode).toBe(401);
  });
  it('runs actual Beijing CSV through B3/B5/B6 and persists linked results/review without requiring ML v2', async () => {
    const f = await fixture(), csv = await readFile(new URL('./fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url));
    const worker = buildApp({ config: f.config, logger: false }); apps.push(worker); await worker.ready();
    const boundary = `b6-${randomUUID()}`;
    const upload = await f.app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...f.headers, 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="beijing-12-stations-demo-2015-03.csv"\r\nContent-Type: text/csv\r\n\r\n`), csv, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
    expect(upload.statusCode, upload.body).toBe(201); const datasetId = upload.json().data.id;
    expect((await f.app.inject({ method: 'PUT', url: `/api/v1/datasets/${datasetId}/mapping`, headers: f.headers, payload: {
      fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3',
    } })).statusCode).toBe(200);
    const imported = await f.app.inject({ method: 'POST', url: `/api/v1/datasets/${datasetId}/imports`, headers: { ...f.headers, 'idempotency-key': randomUUID() } });
    expect(imported.statusCode, imported.body).toBe(200); expect(imported.json().data.importSummary.importedRows).toBe(8782);
    expect(await f.db.collection('sensors').countDocuments({ datasetId: new ObjectId(datasetId) })).toBe(12);
    const accepted = await f.app.inject({ method: 'POST', url: '/api/v1/analysis-runs', headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: { datasetId, family: 'statistical', method: 'zscore', config: { threshold: 3 } } });
    expect(accepted.statusCode, accepted.body).toBe(202); const runId = accepted.json().data.id;
    await expect.poll(async () => (await f.get(`analysis-runs/${runId}`)).json().data.status, { timeout: 20000 }).toBe('completed');
    const listed = await f.list({ datasetId, analysisRunId: runId }); expect(listed.statusCode, listed.body).toBe(200); expect(listed.json().data.length).toBeGreaterThan(0);
    const anomaly = listed.json().data[0]; AnomalySchema.parse(anomaly);
    expect(await f.db.collection('readings').countDocuments({ _id: new ObjectId(anomaly.readingId), datasetId: new ObjectId(datasetId), sensorId: new ObjectId(anomaly.sensorId) })).toBe(1);
    const reviewed = await f.patch(anomaly.id, { baseVersion: 1, changes: { status: 'confirmed', note: 'B6 review on actual Beijing import' } });
    expect(reviewed.statusCode, reviewed.body).toBe(200); expect(reviewed.json().data.version).toBe(2);
    // Reusable service is the same domain boundary; no offline mutation ledger is implemented.
    const publicReview = createAnomalyReviewAccess(f.app.mongo.client, f.app.mongo.db);
    expect((await publicReview.review(anomaly.id, { baseVersion: 2, changes: { note: '' } })).data.version).toBe(3);
  }, 60000);
});
