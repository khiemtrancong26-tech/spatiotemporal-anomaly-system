import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, copyFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AnalysisRunSchema, AnomalySchema, type AnalysisRun } from '@pm25/shared-core/contracts';
import { buildApp } from '../src/app.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { loadTestConfig } from './helpers.js';
import { createAnalysisRepository, RunOwnershipLost } from '../src/modules/analysis/analysis.repository.js';
import { createOnlineEngine } from '../src/engines/online.js';
import type { AnalysisEngine, AnalysisTestHooks, DetectionRequest } from '../src/modules/analysis/analysis.types.js';
import { queryFingerprint } from '../src/shared/pagination.js';
import { EngineError } from '../src/engines/python-runner.js';

let mongo: MongoMemoryReplSet, client: MongoClient, directory: string;
const apps: FastifyInstance[] = [];
const children: ChildProcess[] = [];
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'pm25-b5-'));
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  client = await new MongoClient(mongo.getUri()).connect();
});
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); }); child.kill(); await exited;
}
afterEach(async () => { await Promise.all(children.splice(0).map(stop)); await Promise.all(apps.splice(0).map(app => app.close())); });
afterAll(async () => {
  await client?.close(); await mongo?.stop();
  if (!directory.startsWith(resolve(tmpdir()) + sep) || !directory.includes('pm25-b5-')) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
});
async function fixture(options: { enabled?: boolean; engine?: AnalysisEngine; hooks?: AnalysisTestHooks; env?: NodeJS.ProcessEnv; actualImport?: boolean } = {}) {
  const database = `b5_${randomUUID().replaceAll('-', '')}`;
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri(database), LOG_LEVEL: 'silent', IMPORT_STORAGE_DIR: directory,
    ANALYSIS_POLL_MS: '20', ANALYSIS_LEASE_MS: '2000', ANALYSIS_HEARTBEAT_MS: '300', ANALYSIS_TIMEOUT_MS: '15000', ...options.env });
  const app = buildApp({ config, logger: false, analysisWorkerEnabled: options.enabled ?? true,
    ...(options.engine ? { analysisTestEngine: options.engine } : {}), ...(options.hooks ? { analysisTestHooks: options.hooks } : {}) });
  apps.push(app); await app.ready();
  const db = client.db(database), userId = new ObjectId();
  let datasetId = new ObjectId(), sensorId = new ObjectId();
  await db.collection('users').insertOne({ _id: userId, username: 'B5 real JWT fixture', role: 'analyst', isActive: true });
  const headers = { authorization: `Bearer ${await createTokens(config.jwtSecret).issue(userId.toHexString())}` };
  if (options.actualImport) {
    const values = [...Array.from({ length: 149 }, (_, i) => i % 3 + 1), 100], boundary = `b5-${randomUUID()}`;
    const csv = `sensorId,latitude,longitude,timestamp,value\n${values.map((value, i) => `A,10,106,${new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()},${value}`).join('\n')}\n`;
    const upload = await app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...headers, 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b5.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`) });
    expect(upload.statusCode, upload.body).toBe(201); datasetId = new ObjectId(upload.json().data.id);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/datasets/${datasetId}/mapping`, headers, payload: {
      fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3',
    } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/datasets/${datasetId}/imports`, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    sensorId = (await db.collection('sensors').findOne({ datasetId }))!._id;
  } else {
    await db.collection('datasets').insertOne({ _id: datasetId, name: '[SEED B5] normalized persistence fixture', status: 'imported', createdBy: userId, createdAt: new Date() });
    await db.collection('sensors').insertOne({ _id: sensorId, datasetId, externalId: 'A', name: 'A', location: { type: 'Point', coordinates: [106, 10] }, type: 'pm25', unit: 'ug/m3' });
  }
  const input: DetectionRequest = { datasetId: datasetId.toHexString(), family: 'statistical', method: 'zscore', config: { threshold: 3 } };
  const post = (payload: unknown = input, key = randomUUID()) => app.inject({ method: 'POST', url: '/api/v1/analysis-runs', headers: { ...headers, 'idempotency-key': key, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  async function seed(values = [...Array.from({ length: 149 }, (_, i) => i % 3 + 1), 100]) {
    if (values.length) await db.collection('readings').insertMany(values.map((value, i) => ({ _id: new ObjectId(), datasetId, sensorId,
      ts: new Date(Date.UTC(2026, 0, 1) + i * 1000), value, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] } })));
  }
  async function terminal(id: string): Promise<AnalysisRun> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const response = await app.inject({ url: `/api/v1/analysis-runs/${id}`, headers }); expect(response.statusCode, response.body).toBe(200);
      const run = AnalysisRunSchema.parse(response.json().data);
      if (['completed', 'failed'].includes(run.status)) return run;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Analysis did not reach terminal state');
  }
  const repo = createAnalysisRepository(app.mongo.client, app.mongo.db, config.analysis);
  return { app, config, db, database, userId, datasetId, sensorId, headers, input, post, seed, terminal, repo };
}

/** Explicit orchestration test double: never used as evidence of detector quality. */
function allCandidatesDouble(): AnalysisEngine {
  return { ready: async () => {}, metadata: () => ({ engineVersion: 'simple-statistics@8.0.0' }),
    run: async (_guard, readings) => ({ engineVersion: 'simple-statistics@8.0.0', candidates: readings.map(({ id, ...reading }) => ({ ...reading, readingId: id, score: 1 })) }) };
}
function message(child: ChildProcess, event: string): Promise<{ event: string; url: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Child did not reach ${event}`)); }, 20000);
    const listener = (value: { event: string; url: string }) => { if (value.event === event) { cleanup(); resolve(value); } };
    const exit = () => { cleanup(); reject(new Error(`Child exited before ${event}`)); };
    function cleanup() { clearTimeout(timer); child.off('message', listener); child.off('exit', exit); }
    child.on('message', listener); child.once('exit', exit);
  });
}

describe('B5 actual HTTP/MongoDB and real library engines', () => {
  it('accepts immutable queued snapshots, runs all statistics over >one page, persists only flagged anomalies and replays after terminal', async () => {
    const f = await fixture({ actualImport: true });
    const page = await f.app.inject({ url: `/api/v1/readings?datasetId=${f.datasetId}`, headers: f.headers });
    expect(page.json().data).toHaveLength(100); expect(page.json().page.nextCursor).toBeTruthy();
    for (const method of ['zscore', 'iqr', 'moving_avg']) {
      const input = { ...f.input, method, config: method === 'iqr' ? { multiplier: 1.5 } : method === 'moving_avg' ? { threshold: 3, windowSize: 3 } : { threshold: 3 } };
      const key = randomUUID(), response = await f.post(input, key); expect(response.statusCode, response.body).toBe(202);
      expect(response.json().data.status).toBe('queued'); expect(response.json().data.scope).toEqual({});
      expect(response.json().data).not.toHaveProperty('completedAt'); expect(response.json()).not.toHaveProperty('anomalies');
      const run = await f.terminal(response.json().data.id); expect(run.status, JSON.stringify(run)).toBe('completed');
      const anomalies = await f.db.collection('anomalies').find({ analysisRunId: new ObjectId(run.id) }).toArray(); expect(anomalies).toHaveLength(1);
      expect(anomalies[0]).toMatchObject({ severity: 'low', status: 'open', note: '', version: 1, datasetId: f.datasetId, sensorId: f.sensorId, method });
      const { _id, ...anomaly } = anomalies[0]!;
      AnomalySchema.parse({ ...anomaly, id: String(_id), datasetId: String(anomaly.datasetId), sensorId: String(anomaly.sensorId),
        readingId: String(anomaly.readingId), analysisRunId: String(anomaly.analysisRunId), ts: anomaly.ts.toISOString(), updatedAt: anomaly.updatedAt.toISOString() });
      const replay = await f.post(input, key); expect(replay.statusCode).toBe(202); expect(replay.json()).toEqual(response.json());
      expect((await f.post({ ...input, scope: {} }, key)).statusCode).toBe(422);
    }
    expect(await f.db.collection('analysisRuns').countDocuments()).toBe(3);
    const results = await f.db.collection('anomalies').find().toArray(); expect(new Set(results.map(doc => String(doc.readingId))).size).toBe(1);
    expect((await f.db.collection<{ _id: string; active: number }>('analysisQueueState').findOne({ _id: 'online' }))?.active).toBe(0);
  }, 60000);
  it('performs actual PM2.5 ML inference deterministically without training in the worker', async () => {
    const f = await fixture(); await f.seed([45, 50, 55, 60, 10000]);
    const input = { ...f.input, family: 'ml', method: 'isolation_forest', config: {} };
    const outputs: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await f.post(input); expect(response.statusCode, response.body).toBe(202);
      const run = await f.terminal(response.json().data.id); expect(run.status, JSON.stringify(run)).toBe('completed');
      expect(run).toMatchObject({ engineVersion: 'scikit-learn@1.9.1', modelVersion: 'pm25-iforest-uci381-v1' });
      outputs.push(await f.db.collection('anomalies').find({ analysisRunId: new ObjectId(run.id) }, { projection: { _id: 0, readingId: 1, score: 1, severity: 1 } }).sort({ readingId: 1 }).toArray());
    }
    expect(outputs[0]).toEqual(outputs[1]); expect(outputs[0]).toHaveLength(1);
    expect((outputs[0] as { score: number; severity: string }[])[0]).toMatchObject({ severity: 'low' });
    expect((outputs[0] as { score: number }[])[0]!.score).toBeCloseTo(.3069626761725055, 12);
  }, 60000);
  it('returns empty/insufficient/constant scope honestly and honors closed sensor/time bounds', async () => {
    const f = await fixture(); await f.seed([2, 2, 2, 2]);
    const cases = [
      { scope: {}, method: 'zscore', config: { threshold: 3 }, status: 'completed' },
      { scope: { from: '2027-01-01T00:00:00Z' }, method: 'zscore', config: { threshold: 3 }, status: 'failed' },
      { scope: { from: '2026-01-01T00:00:01Z', to: '2026-01-01T00:00:01Z' }, method: 'zscore', config: { threshold: 3 }, status: 'failed' },
      { scope: { sensorIds: [f.sensorId.toHexString()], from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:03Z' }, method: 'iqr', config: { multiplier: 1.5 }, status: 'completed' },
    ];
    for (const item of cases) {
      const { status, ...change } = item, response = await f.post({ ...f.input, ...change }); expect(response.statusCode, response.body).toBe(202);
      const run = await f.terminal(response.json().data.id); expect(run.status).toBe(status);
      if (status === 'failed') expect(run.error?.code).toBe('INSUFFICIENT_DATA');
    }
    expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
  }, 60000);
  it('validates auth/schema/config, opaque IDs, sensor membership and never accepts bbox', async () => {
    const f = await fixture({ enabled: false });
    for (const url of ['/api/v1/analysis-runs', '/api/v1/analysis-runs/opaque']) expect((await f.app.inject({ url })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/api/v1/analysis-runs', payload: f.input })).statusCode).toBe(401);
    for (const change of [{ extra: 1 }, { scope: { bbox: [0, 0, 1, 1] } }, { config: { threshold: '3' } }, { family: 'unknown' }]) {
      const response = await f.post({ ...f.input, ...change }); expect([400, 422]).toContain(response.statusCode);
    }
    for (const change of [{ method: 'unknown' }, { config: {} }, { scope: { sensorIds: [] } }, { scope: { sensorIds: ['external-A'] } },
      { scope: { sensorIds: [new ObjectId().toHexString()] } }, { scope: { from: '2026-01-01T00:00:00.0001Z' } }]) expect((await f.post({ ...f.input, ...change })).statusCode).toBe(422);
    expect((await f.post({ ...f.input, datasetId: 'opaque' })).statusCode).toBe(404);
    const foreignSensor = new ObjectId();
    await f.db.collection('sensors').insertOne({ _id: foreignSensor, datasetId: new ObjectId(), externalId: 'Other dataset' });
    expect((await f.post({ ...f.input, scope: { sensorIds: [foreignSensor.toHexString()] } })).statusCode).toBe(422);
    expect((await f.app.inject({ url: '/api/v1/analysis-runs/opaque', headers: f.headers })).statusCode).toBe(404);
    await f.db.collection('datasets').updateOne({ _id: f.datasetId }, { $set: { status: 'importing' } });
    expect((await f.post()).statusCode).toBe(422);
    expect((await f.app.inject({ method: 'DELETE', url: '/api/v1/analysis-runs', headers: f.headers })).statusCode).toBe(405);
    expect(await f.db.collection('analysisRuns').countDocuments()).toBe(0);
  });
  it('keeps stable signed history pagination, current detail and imported visibility', async () => {
    const f = await fixture({ enabled: false });
    for (let i = 0; i < 5; i++) expect((await f.post()).statusCode).toBe(202);
    // Persistence fixture with equal timestamps exercises the _id tie-breaker.
    await f.db.collection('analysisRuns').updateMany({}, { $set: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const get = (query: string) => f.app.inject({ url: `/api/v1/analysis-runs?${query}`, headers: f.headers });
    for (const sort of ['createdAt:asc', 'createdAt:desc']) {
      const ids: string[] = []; let cursor: string | null = null;
      do {
        const response = await get(`datasetId=${f.datasetId}&sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        expect(response.statusCode, response.body).toBe(200); expect(response.body).not.toMatch(/"owner"|"attempt"|modelHash|policyId|createdBy|leaseUntil|writeFence/);
        const body = response.json(); ids.push(...body.data.map((run: AnalysisRun) => run.id)); cursor = body.page.nextCursor;
        if (cursor) expect((await get(`datasetId=${f.datasetId}&sort=${sort === 'createdAt:asc' ? 'createdAt:desc' : 'createdAt:asc'}&cursor=${cursor}`)).statusCode).toBe(400);
      } while (cursor);
      expect(new Set(ids).size).toBe(5);
    }
    expect((await get(`datasetId=${f.datasetId}&limit=1e2`)).statusCode).toBe(400);
    expect((await get(`datasetId=${f.datasetId}&sort=score:asc`)).statusCode).toBe(400);
    expect((await get('datasetId=opaque')).json().data).toEqual([]);
    await f.db.collection('datasets').updateOne({ _id: f.datasetId }, { $set: { status: 'failed' } });
    expect((await get(`datasetId=${f.datasetId}`)).json().data).toEqual([]);
    const run = await f.db.collection('analysisRuns').findOne();
    expect((await f.app.inject({ url: `/api/v1/analysis-runs/${run!._id}`, headers: f.headers })).statusCode).toBe(404);
  });
  it('serializes same-key acceptance and admission across two app instances, with no receipts on rejection', async () => {
    const f = await fixture({ enabled: false, env: { ANALYSIS_MAX_PENDING: '3' } });
    const other = buildApp({ config: f.config, logger: false, analysisWorkerEnabled: false }); apps.push(other); await other.ready();
    const key = randomUUID();
    const requests = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? other : f.app).inject({ method: 'POST', url: '/api/v1/analysis-runs',
      headers: { ...f.headers, 'idempotency-key': key }, payload: f.input })));
    expect(requests.map(response => response.statusCode)).toEqual(Array(8).fill(202));
    expect(new Set(requests.map(response => response.body)).size).toBe(1);
    const remaining = await Promise.all(Array.from({ length: 8 }, () => f.post()));
    expect(remaining.filter(response => response.statusCode === 202)).toHaveLength(2);
    expect(remaining.filter(response => response.statusCode === 503)).toHaveLength(6);
    expect(await f.db.collection('analysisRuns').countDocuments()).toBe(3); expect(await f.db.collection('idempotencyReceipts').countDocuments()).toBe(3);
    await f.db.collection('idempotencyReceipts').updateOne({ key }, { $set: { expiresAt: new Date(0) } });
    expect((await f.post(f.input, key)).statusCode).toBe(409); expect(await f.db.collection('analysisRuns').countDocuments()).toBe(3);
  }, 60000);
  it('fails oversized scopes instead of completing a truncated result', async () => {
    const f = await fixture({ env: { ANALYSIS_MAX_READINGS: '100' } }); await f.seed();
    const exact = await f.post({ ...f.input, scope: { to: '2026-01-01T00:01:39Z' } });
    expect((await f.terminal(exact.json().data.id)).status).toBe('completed');
    const response = await f.post(), run = await f.terminal(response.json().data.id);
    expect(run.status).toBe('failed'); expect(run.error?.code).toBe('SCOPE_LIMIT_EXCEEDED'); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
  });
  it('fails the whole multi-sensor scope when one station is insufficient, while an explicit complete station scope succeeds', async () => {
    const f = await fixture(); await f.seed();
    const sensorId = new ObjectId();
    await f.db.collection('sensors').insertOne({ _id: sensorId, datasetId: f.datasetId, externalId: 'B' });
    await f.db.collection('readings').insertOne({ _id: new ObjectId(), datasetId: f.datasetId, sensorId, ts: new Date('2026-01-01T00:00:00Z'),
      value: 2, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] } });
    const whole = await f.post(), failed = await f.terminal(whole.json().data.id);
    expect(failed.error?.code).toBe('INSUFFICIENT_DATA'); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
    const selected = await f.post({ ...f.input, scope: { sensorIds: [f.sensorId.toHexString()] } });
    expect((await f.terminal(selected.json().data.id)).status).toBe('completed');
    expect(await f.db.collection('anomalies').countDocuments()).toBe(1);
  }, 60000);
  it('rejects unavailable models before accepting, and records model failure after durable acceptance', async () => {
    const artifact = resolve(directory, `${randomUUID()}.joblib`);
    const f = await fixture({ enabled: false, env: { ANALYSIS_ARTIFACT: artifact } }); await f.seed([50, 60]);
    const input = { ...f.input, family: 'ml', method: 'isolation_forest', config: {} };
    expect((await f.post(input)).statusCode).toBe(503); expect(await f.db.collection('analysisRuns').countDocuments()).toBe(0);
    await copyFile(loadTestConfig().analysis.artifactPath, artifact);
    const accepted = await f.post(input); expect(accepted.statusCode, accepted.body).toBe(202); await unlink(artifact);
    const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
    const run = await f.terminal(accepted.json().data.id); expect(run.status).toBe('failed'); expect(run.error?.code).toBe('MODEL_UNAVAILABLE');
  }, 60000);
});

describe('B5 MongoDB worker recovery and fault injection (test doubles explicitly labeled)', () => {
  it('renews a live claim across its initial lease and prevents a second worker from executing it', async () => {
    let entered!: () => void, release!: () => void;
    const claimed = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture({ env: { ANALYSIS_LEASE_MS: '600', ANALYSIS_HEARTBEAT_MS: '100' }, hooks: { afterClaim: async () => { entered(); await blocked; } } });
    await f.seed([1, 2, 3, 4]); const accepted = await f.post(); await claimed;
    try {
      const other = buildApp({ config: f.config, logger: false }); apps.push(other); await other.ready();
      await new Promise(resolve => setTimeout(resolve, 900));
      expect(await f.repo.claim()).toBeNull();
      expect((await f.db.collection('analysisRuns').findOne())?.attempt).toBe(1);
    } finally { release(); }
    expect((await f.terminal(accepted.json().data.id)).status).toBe('completed');
  }, 60000);
  for (const mode of ['queued', 'batch']) it(`recovers after killing an actual Backend process at durable ${mode}, including lost response/replay`, async () => {
    const f = await fixture({ enabled: false }); await f.seed([...Array.from({ length: 599 }, (_, i) => i % 3 + 1), 100]);
    const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
    const child = fork(fileURLToPath(new URL('./fixtures/b5-worker.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      env: { ...environment, MONGODB_URI: f.config.mongodbUri, MONGODB_DATABASE: f.database,
        B5_CRASH_MODE: mode, ANALYSIS_POLL_MS: '20', ANALYSIS_LEASE_MS: '2000', ANALYSIS_HEARTBEAT_MS: '300' },
    }); children.push(child);
    const ready = await message(child, 'ready'), key = randomUUID(), paused = message(child, mode);
    // queued hook pauses after the transaction but before the HTTP response;
    // batch hook pauses after an actual 500-anomaly commit from a labeled double.
    const request = fetch(`${ready.url}/api/v1/analysis-runs`, { method: 'POST', headers: { ...f.headers, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(f.input) }).catch(() => null);
    await paused;
    const before = await f.db.collection('analysisRuns').findOne(); expect(before?.status).toBe(mode === 'queued' ? 'queued' : 'running');
    expect(await f.db.collection('anomalies').countDocuments()).toBe(mode === 'queued' ? 0 : 500);
    await stop(child); const firstResponse = await request;
    if (mode === 'queued') expect(firstResponse).toBeNull();
    // Fault injection advances only this test run's lease, avoiding a 30-second wait.
    if (mode === 'batch') await f.db.collection('analysisRuns').updateOne({ _id: before!._id }, { $set: { leaseUntil: new Date(0) } });
    const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
    const run = await f.terminal(String(before!._id)); expect(run.status, JSON.stringify(run)).toBe('completed');
    expect(await f.db.collection('anomalies').countDocuments()).toBe(1); expect(await f.db.collection('analysisRuns').countDocuments()).toBe(1);
    const replay = await f.post(f.input, key); expect(replay.statusCode).toBe(202); expect(replay.json().data).toMatchObject({ id: run.id, status: 'queued' });
    expect((await f.db.collection('analysisRuns').findOne())?.attempt).toBe(mode === 'queued' ? 1 : 2);
  }, 60000);
  it('fences an expired owner including writes and terminal publication, then recovers partial without duplicate effects', async () => {
    const f = await fixture({ enabled: false }); await f.seed(); const accepted = await f.post();
    const first = (await f.repo.claim())!, readings = await f.repo.readings(first, new AbortController().signal);
    await f.repo.writeBatch(first, [{ ...readings[0]!, readingId: readings[0]!.id, score: 1 }]);
    await f.db.collection('analysisRuns').updateOne({ _id: new ObjectId(first.id) }, { $set: { leaseUntil: new Date(0) } });
    const second = (await f.repo.claim())!; expect(second.id).toBe(first.id); expect(second.attempt).toBe(2);
    expect(await f.repo.renew(first)).toBe(false);
    await expect(f.repo.writeBatch(first, [{ ...readings[1]!, readingId: readings[1]!.id, score: 1 }])).rejects.toBeInstanceOf(RunOwnershipLost);
    await expect(f.repo.terminal(first)).rejects.toBeInstanceOf(RunOwnershipLost);
    await f.repo.cleanup(second); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
    const actual = await createOnlineEngine(f.config.analysis).run(second, readings, new AbortController().signal);
    await f.repo.writeBatch(second, actual.candidates); await f.repo.terminal(second);
    expect((await f.terminal(accepted.json().data.id)).status).toBe('completed'); expect(await f.db.collection('anomalies').countDocuments()).toBe(1);
    expect(await f.repo.claim()).toBeNull();
    await expect(f.repo.terminal(second)).rejects.toBeInstanceOf(RunOwnershipLost);
  }, 60000);
  it('does not complete a run when MongoDB rejects a later result batch; partial stays private', async () => {
    const f = await fixture({ engine: allCandidatesDouble(), hooks: { afterBatch: async () => {
      await f.db.command({ collMod: 'anomalies', validator: { impossibleField: { $exists: true } }, validationLevel: 'strict' });
    } } });
    await f.seed(Array(600).fill(2)); const accepted = await f.post(), run = await f.terminal(accepted.json().data.id);
    expect(run.status).toBe('failed'); expect(run.error?.code).toBe('ANALYSIS_FAILED');
    expect(await f.db.collection('anomalies').countDocuments()).toBe(500);
    expect((await f.app.inject({ url: `/api/v1/anomalies?analysisRunId=${run.id}`, headers: f.headers })).statusCode).toBe(404); // B6 is not implemented.
    expect(await f.repo.claim()).toBeNull();
  });
  it('bounds crash recovery attempts without automatically rerunning terminal runs', async () => {
    const f = await fixture({ enabled: false }); const accepted = await f.post();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const guard = await f.repo.claim(); expect(guard?.attempt).toBe(attempt);
      await f.db.collection('analysisRuns').updateOne({ _id: new ObjectId(guard!.id) }, { $set: { leaseUntil: new Date(0) } });
    }
    const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
    const run = await f.terminal(accepted.json().data.id); expect(run.status).toBe('failed'); expect(run.error?.code).toBe('WORKER_RETRIES_EXHAUSTED');
    expect(await f.repo.claim()).toBeNull();
  });
  it('times out/aborts the engine and rejects invalid output references without publishing', async () => {
    for (const behavior of ['timeout', 'foreign', 'nonfinite', 'duplicate', 'native-error']) {
      const engine = allCandidatesDouble(), original = engine.run;
      engine.run = async (guard, readings, signal) => {
        if (behavior === 'timeout') return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new EngineError('ENGINE_ABORTED', 'stopped')), { once: true }); });
        if (behavior === 'native-error') throw new EngineError('MODEL_INTEGRITY_ERROR', 'sensitive path must not leak');
        const result = await original(guard, readings, signal);
        if (behavior === 'foreign') result.candidates[0]!.readingId = 'foreign';
        if (behavior === 'nonfinite') result.candidates[0]!.score = Infinity;
        if (behavior === 'duplicate') result.candidates.push(result.candidates[0]!);
        return result;
      };
      const f = await fixture({ engine, env: { ANALYSIS_TIMEOUT_MS: '500' } }); await f.seed([1, 2]);
      const accepted = await f.post(), run = await f.terminal(accepted.json().data.id);
      expect(run.status).toBe('failed'); expect(run.error?.code).toBe(behavior === 'timeout' ? 'ENGINE_TIMEOUT' : behavior === 'native-error' ? 'MODEL_INTEGRITY_ERROR' : 'ENGINE_OUTPUT_INVALID');
      expect(JSON.stringify(run)).not.toContain('sensitive'); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
    }
  }, 60000);
  it('uses the same key namespace as B3, without the B3 sweeper consuming analysis receipts', async () => {
    const f = await fixture({ enabled: false }), key = randomUUID();
    const response = await f.post(f.input, key); expect(response.statusCode).toBe(202);
    const receipt = await f.db.collection('idempotencyReceipts').findOne({ key }); expect(receipt?.kind).toBe('analysis');
    expect(receipt?.requestHash).toBe(queryFingerprint('POST /api/v1/analysis-runs', { payload: f.input }, ''));
    const collision = await f.app.inject({ method: 'POST', url: `/api/v1/datasets/${f.datasetId}/imports`, headers: { ...f.headers, 'idempotency-key': key } });
    expect(collision.statusCode).toBe(422);
  });
});
