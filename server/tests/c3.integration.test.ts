import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { parse } from 'csv-parse/sync';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { AnalysisRunSchema, buildPm25Features, PM25_V2_POLICY, type AnalysisRun } from '@pm25/shared-core';
import { buildApp } from '../src/app.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { createAnalysisRepository, RunOwnershipLost } from '../src/modules/analysis/analysis.repository.js';
import { createOnlineEngine } from '../src/engines/online.js';
import { createIsolationForestAdapter } from '../src/engines/isolation-forest.js';
import { loadTestConfig } from './helpers.js';
import v2 from '../ml/pm25-v2-manifest.json' with { type: 'json' };
let mongo: MongoMemoryReplSet, client: MongoClient, directory: string;
const apps: FastifyInstance[] = [], children: ChildProcess[] = [];
const goldenBytes = await readFile(new URL('./fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url));
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'pm25-c3-')); mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } }); client = await new MongoClient(mongo.getUri()).connect(); });
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; const closed = new Promise<void>(r => child.once('exit', () => r())); child.kill(); await closed; }
afterEach(async () => { await Promise.all(children.splice(0).map(stop)); await Promise.all(apps.splice(0).map(a => a.close())); });
afterAll(async () => { await client?.close(); await mongo?.stop(); if (!directory.startsWith(join(tmpdir(), 'pm25-c3-'))) throw new Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }); });
async function fixture(enabled = true, csv: Buffer = goldenBytes) {
  const name = 'c3_' + randomUUID().replaceAll('-', ''), config = loadTestConfig({ MONGODB_URI: mongo.getUri(name), IMPORT_STORAGE_DIR: directory,
    LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' });
  const app = buildApp({ config, logger: false, analysisWorkerEnabled: enabled }); apps.push(app); await app.ready();
  const db = client.db(name), user = new ObjectId(); await db.collection('users').insertOne({ _id: user, role: 'analyst', isActive: true });
  const headers = { authorization: 'Bearer ' + await createTokens(config.jwtSecret).issue(String(user)) }, boundary = 'c3-' + randomUUID();
  const upload = await app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...headers, 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c3.csv"\r\nContent-Type: text/csv\r\n\r\n`), csv, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  expect(upload.statusCode, upload.body).toBe(201); const id: string = upload.json().data.id;
  const mapping = await app.inject({ method: 'PUT', url: `/api/v1/datasets/${id}/mapping`, headers, payload: { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3' } }); expect(mapping.statusCode, mapping.body).toBe(200);
  const imported = await app.inject({ method: 'POST', url: `/api/v1/datasets/${id}/imports`, headers: { ...headers, 'idempotency-key': randomUUID() } }); expect(imported.statusCode, imported.body).toBe(200);
  const body = { datasetId: id, family: 'ml', method: 'isolation_forest', config: {}, scope: {} };
  const postOn = (target: FastifyInstance, payload: unknown = body, key: string = randomUUID()) => target.inject({ method: 'POST', url: '/api/v1/analysis-runs', headers: { ...headers, 'idempotency-key': key, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  const get = (path: string) => app.inject({ url: '/api/v1/' + path, headers });
  const terminal = async (runId: string): Promise<AnalysisRun> => {
    const until = Date.now() + 30000;
    while (Date.now() < until) { const r = await get(`analysis-runs/${runId}`); expect(r.statusCode, r.body).toBe(200); const run = AnalysisRunSchema.parse(r.json().data); if (['completed', 'failed'].includes(run.status)) return run; await new Promise(r => setTimeout(r, 30)); }
    throw new Error('Functional test did not reach terminal state');
  };
  return { app, db, config, id, body, headers, postOn, post: (payload: unknown = body, key?: string) => postOn(app, payload, key), get, terminal,
    repo: createAnalysisRepository(app.mongo.client, app.mongo.db, config.analysis) };
}
it('imports golden, runs native 3-feature inference and publishes the exact disjoint summary; no unscorable anomalies', async () => {
  const f = await fixture(), response = await f.post(); expect(response.statusCode, response.body).toBe(202);
  expect(response.json().data.status).toBe('queued'); expect(response.json().data.scoringSummary).toBeUndefined();
  const run = await f.terminal(response.json().data.id); expect(run.status, JSON.stringify(run)).toBe('completed');
  expect(run.scoringSummary).toEqual(v2.golden.summary); expect(run.scoringSummary).toMatchObject({ targetCount: 8782, scoredCount: 8722, unscorableCount: 60, reasons: { temporalOnly: 48, spatialOnly: 12, both: 0 } });
  const stored = await f.db.collection('analysisRuns').findOne({ _id: new ObjectId(run.id) });
  expect(stored).toMatchObject({ policyId: PM25_V2_POLICY.id, modelHash: v2.sha256, modelVersion: v2.id, status: 'completed', scoringSummary: run.scoringSummary });
  const sensors = await f.db.collection('sensors').find({ datasetId: new ObjectId(f.id) }).toArray();
  const guard = { id: run.id, owner: 'parity-only', attempt: 1, run, policyId: PM25_V2_POLICY.id, modelHash: v2.sha256 };
  const targets = await f.repo.readings(guard, new AbortController().signal), context = await f.repo.context(guard, targets, new AbortController().signal);
  const built = buildPm25Features(f.id, targets, context.readings, context.sensors);
  const matrix = parse(await readFile(new URL('../../.local/pm25-v2-features/golden.csv', import.meta.url)), { columns: true }) as Record<string, string>[];
  const raw = parse(goldenBytes, { columns: true }) as Record<string, string>[];
  const sourceIds = new Map(raw.map(r => [`${r.sensorId}/${new Date(r.timestamp!).toISOString()}`, `${r.sensorId}|${r.sourceRowNo}`]));
  const expected = new Map(matrix.map(r => [r.readingId!, [Number(r.value), Number(r.temporal_delta), Number(r.spatial_delta)]]));
  const names = new Map(sensors.map(s => [String(s._id), s.externalId]));
  const byId = new Map(targets.map(t => [t.id, t]));
  expect(built.rows).toHaveLength(matrix.length);
  for (const row of built.rows) { const t = byId.get(row.readingId)!; expect(row.values).toEqual(expected.get(sourceIds.get(`${names.get(t.sensorId)}/${t.ts}`)!)); }
  const scoredIds = new Set(built.rows.map(r => r.readingId)), anomalies = await f.db.collection('anomalies').find({ analysisRunId: new ObjectId(run.id) }).toArray();
  expect(anomalies.length).toBeGreaterThan(0); expect(anomalies.every(a => scoredIds.has(String(a.readingId)) && a.severity === 'low')).toBe(true);
  const publicRun = await f.get(`analysis-runs/${run.id}`); expect(publicRun.body).not.toMatch(/modelHash|policyId|owner|leaseUntil/);
  const published = await f.get(`anomalies?datasetId=${f.id}&analysisRunId=${run.id}`); expect(published.statusCode).toBe(200);
  const anomalyId = published.json().data[0].id;
  expect((await f.get(`anomalies/${anomalyId}`)).statusCode).toBe(200);
  const patch = (version: number) => f.app.inject({ method: 'PATCH', url: `/api/v1/anomalies/${anomalyId}`, headers: f.headers,
    payload: { baseVersion: version, changes: { status: 'confirmed', note: 'Single-model native inference review' } } });
  const reviewed = await patch(1); expect(reviewed.statusCode, reviewed.body).toBe(200);
  expect(reviewed.json().data).toMatchObject({ status: 'confirmed', version: 2 });
  expect((await patch(1)).statusCode).toBe(409);
  expect((await f.get(`anomalies/${anomalyId}`)).json().data).toMatchObject({ note: 'Single-model native inference review', status: 'confirmed', version: 2 });
}, 60000);
it('loads history before from and neighbors outside the selected targets; excludes foreign dataset and future samples', async () => {
  const f = await fixture(false), s = await f.db.collection('sensors').findOne({ datasetId: new ObjectId(f.id), externalId: 'Aotizhongxin' });
  const time = '2015-02-28T17:00:00.000Z';
  await f.db.collection('readings').insertOne({ datasetId: new ObjectId(), sensorId: s!._id, ts: new Date(time), value: 99999 });
  const r = await f.post({ ...f.body, scope: { sensorIds: [String(s!._id)], from: time, to: time } }); expect(r.statusCode).toBe(202);
  const guard = (await f.repo.claim())!, targets = await f.repo.readings(guard, new AbortController().signal), ctx = await f.repo.context(guard, targets, new AbortController().signal);
  expect(targets).toHaveLength(1); expect(ctx.readings.some(p => p.ts < time && p.sensorId === String(s!._id))).toBe(true);
  expect(ctx.readings.some(p => p.ts === time && p.sensorId !== String(s!._id))).toBe(true);
  expect(ctx.readings.every(p => p.datasetId === f.id && p.ts <= time && p.value !== 99999)).toBe(true);
  const result = await createOnlineEngine(f.config.analysis).run(guard, targets, new AbortController().signal, ctx);
  expect(result.scoringSummary).toMatchObject({ targetCount: 1, scoredCount: 1, unscorableCount: 0 });
  await f.repo.terminal(guard, undefined, result.scoringSummary);
}, 60000);
it('fails all-unscorable data without summary or partial success, even when two peer readings exist', async () => {
  const csv = Buffer.from('sensorId,latitude,longitude,timestamp,value\n' + ['A', 'B', 'C'].flatMap((s, i) => [0, 1].map(h => `${s},0,${i * .01},2015-03-01T0${h}:00:00Z,20`)).join('\n'));
  const f = await fixture(true, csv), r = await f.post(), run = await f.terminal(r.json().data.id);
  expect(run.status).toBe('failed'); expect(run.error?.code).toBe('INSUFFICIENT_CONTEXT'); expect(run.scoringSummary).toBeUndefined();
  expect((await f.db.collection('analysisRuns').findOne())?.scoringSummary).toBeUndefined(); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
});
it('checks single-model readiness, coalesces probes and rejects pinned policy/hash/feature-order mismatches', async () => {
  const base = loadTestConfig().analysis, engine = createOnlineEngine(base);
  await expect(Promise.all([engine.ready(), engine.ready()])).resolves.toEqual([undefined, undefined]);
  await expect(createOnlineEngine({ ...base, artifactPath: join(directory, 'missing-model') }).ready()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  const f = await fixture(false), r = await f.post(), guard = (await f.repo.claim())!, targets = await f.repo.readings(guard, new AbortController().signal);
  expect(r.statusCode).toBe(202);
  await expect(engine.run({ ...guard, modelHash: '0'.repeat(64) }, targets, new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_VERSION_UNAVAILABLE' });
  await expect(engine.run({ ...guard, run: { ...guard.run, modelVersion: 'unavailable-model' } }, targets, new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_VERSION_UNAVAILABLE' });
  await expect(engine.run({ ...guard, policyId: 'other' }, targets, new AbortController().signal)).rejects.toMatchObject({ code: 'POLICY_VERSION_UNAVAILABLE' });
  const adapter = createIsolationForestAdapter({ ...base, modelId: v2.id, artifactSha256: v2.sha256,
    sklearnVersion: v2.sklearnVersion, features: ['spatial_delta', 'temporal_delta', 'value'], maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxConcurrent: 1 });
  await expect(adapter([targets[0]!], [{ readingId: targets[0]!.id, values: [50, 0, 0] }], { id: 'test', score: p => -p.decisionFunction })).rejects.toMatchObject({ code: 'FEATURE_SCHEMA_MISMATCH' });
}, 60000);
it('recovers queued single-model runs and preserves immutable acceptance receipts across restart', async () => {
  const f = await fixture(false), key = randomUUID(), response = await f.post(f.body, key);
  expect(response.statusCode).toBe(202);
  expect((await f.db.collection('analysisRuns').findOne())).toMatchObject({ modelVersion: v2.id, modelHash: v2.sha256, policyId: PM25_V2_POLICY.id });
  const before = await f.db.collection('idempotencyReceipts').findOne({ key });
  const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
  const run = await f.terminal(response.json().data.id); expect(run.status).toBe('completed'); expect(run.scoringSummary).toEqual(v2.golden.summary);
  expect((await f.postOn(restarted, f.body, key)).body).toBe(response.body);
  expect(await f.db.collection('idempotencyReceipts').findOne({ key })).toEqual(before);
}, 60000);
it('fences stale summary publication and publishes completed ML summary atomically', async () => {
  const f = await fixture(false); await f.post(); const old = (await f.repo.claim())!;
  await f.db.collection('analysisRuns').updateOne({ _id: new ObjectId(old.id) }, { $set: { leaseUntil: new Date(0) } });
  const current = (await f.repo.claim())!;
  await expect(f.repo.terminal(old, undefined, v2.golden.summary)).rejects.toBeInstanceOf(RunOwnershipLost);
  expect((await f.db.collection('analysisRuns').findOne())?.scoringSummary).toBeUndefined();
  const reads = await f.repo.readings(current, new AbortController().signal), ctx = await f.repo.context(current, reads, new AbortController().signal), result = await createOnlineEngine(f.config.analysis).run(current, reads, new AbortController().signal, ctx);
  if (result.candidates.length) await f.repo.writeBatch(current, result.candidates);
  expect((await f.get(`analysis-runs/${old.id}`)).json().data.scoringSummary).toBeUndefined();
  expect((await f.get(`anomalies?datasetId=${f.id}&analysisRunId=${old.id}`)).statusCode).toBe(409);
  await f.repo.terminal(current, undefined, result.scoringSummary); expect((await f.terminal(old.id)).scoringSummary).toEqual(v2.golden.summary);
  await expect(f.repo.terminal(current, undefined, result.scoringSummary)).rejects.toBeInstanceOf(RunOwnershipLost);
}, 60000);
it('recovers native inference after killing the Backend with real partial anomalies and no summary', async () => {
  const f = await fixture(false), environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
  const child = fork(fileURLToPath(new URL('./fixtures/c3-worker.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    env: { ...environment, MONGODB_URI: f.config.mongodbUri, IMPORT_STORAGE_DIR: directory } }); children.push(child);
  function event(name: string) { return new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Child timeout')), 25000); const listener = (m: { event: string }) => { if (m.event === name) { clearTimeout(timer); child.off('message', listener); resolve(); } }; child.on('message', listener); }); }
  await event('ready'); const partial = event('batch'), r = await f.post(); await partial;
  const id = r.json().data.id; expect(await f.db.collection('anomalies').countDocuments()).toBeGreaterThan(0); expect((await f.db.collection('analysisRuns').findOne())?.scoringSummary).toBeUndefined();
  await stop(child); await f.db.collection('analysisRuns').updateOne({ _id: new ObjectId(id) }, { $set: { leaseUntil: new Date(0) } });
  const restarted = buildApp({ config: f.config, logger: false }); apps.push(restarted); await restarted.ready();
  const run = await f.terminal(id); expect(run.status).toBe('completed'); expect(run.scoringSummary).toEqual(v2.golden.summary);
  expect((await f.db.collection('analysisRuns').findOne())?.attempt).toBe(2);
  const results = await f.db.collection('anomalies').find({ analysisRunId: new ObjectId(id) }).toArray(); expect(new Set(results.map(a => String(a.readingId))).size).toBe(results.length);
}, 60000);
it('fails safely when the sole artifact disappears after acceptance', async () => {
  const f = await fixture(false), r = await f.post(); expect(r.statusCode).toBe(202);
  const restarted = buildApp({ config: { ...f.config, analysis: { ...f.config.analysis, artifactPath: join(directory, 'lost-model') } }, logger: false }); apps.push(restarted); await restarted.ready();
  const run = await f.terminal(r.json().data.id); expect(run.status).toBe('failed'); expect(run.error?.code).toBe('MODEL_UNAVAILABLE'); expect(run.scoringSummary).toBeUndefined(); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
  await expect(createOnlineEngine({ ...f.config.analysis, artifactPath: join(directory, 'lost-model') }).ready()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
}, 60000);
it('rejects malformed native-result coverage before publishing (labeled result-corruption test double)', async () => {
  const f = await fixture(false), r = await f.post(), real = createOnlineEngine(f.config.analysis);
  const app = buildApp({ config: f.config, logger: false, analysisTestEngine: { ...real, run: async (...args) => {
    const result = await real.run(...args); return { ...result, scoringSummary: { ...result.scoringSummary!, reasons: { ...result.scoringSummary!.reasons, both: 1 } } };
  } } }); apps.push(app); await app.ready();
  const run = await f.terminal(r.json().data.id); expect(run.status).toBe('failed'); expect(run.error?.code).toBe('ENGINE_OUTPUT_INVALID'); expect(run.scoringSummary).toBeUndefined(); expect(await f.db.collection('anomalies').countDocuments()).toBe(0);
}, 60000);
it('enforces the context station guard on a small functional fixture, without truncating or changing B5 scope limits', async () => {
  const csv = Buffer.from('sensorId,latitude,longitude,timestamp,value\n' + Array.from({ length: 129 }, (_, i) => `S${i},0,${i / 10000},2015-03-01T00:00:00Z,1`).join('\n'));
  const f = await fixture(true, csv); for (const config of [{ modelVersion: 'v1' }, { modelVersion: 'v2' }, { modelVersion: ['v2'] }, { threshold: 3 }]) expect((await f.post({ ...f.body, config })).statusCode).toBe(422);
  const r = await f.post(); expect(r.statusCode).toBe(202); const run = await f.terminal(r.json().data.id);
  expect(run.status).toBe('failed'); expect(run.error?.code).toBe('CONTEXT_LIMIT_EXCEEDED'); expect(run.scoringSummary).toBeUndefined();
});
