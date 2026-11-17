import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { buildApp } from '../src/app.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { loadTestConfig } from './helpers.js';
it('isolates all dataset APIs between two analysts while preserving Admin, real import/analysis and denied in-flight import access', async () => {
  const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  const storage = await mkdtemp(join(tmpdir(), 'pm25-ownership-'));
  let hold = false, entered!: () => void, release!: () => void;
  const blocked = new Promise<void>(r => { entered = r; }), resume = new Promise<void>(r => { release = r; });
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri('ownership'), IMPORT_STORAGE_DIR: storage, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' });
  const app = buildApp({ config, logger: false, importTestHooks: { afterBatch: async () => { if (hold) { entered(); await resume; } } } });
  try {
    await app.ready(); const tokens = createTokens(config.jwtSecret);
    const users = await Promise.all(['A', 'B', 'C'].map(username => app.users.createUser({ username, password: 'ownership-test-password', role: username === 'C' ? 'admin' : 'analyst' })));
    const auth = await Promise.all(users.map(u => tokens.issue(u.id)));
    const request = (who: number, method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, key?: string) => app.inject({ method, url: '/api/v1/' + path,
      headers: { authorization: 'Bearer ' + auth[who], ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
    const mapping = { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3' };
    async function upload(who: number, name: string) {
      const csv = 'sensorId,latitude,longitude,timestamp,value\n' + Array.from({ length: 20 }, (_, i) => `S,10,106,${new Date(Date.UTC(2026, 0, 1, i)).toISOString()},${i === 19 ? 100 : 1}`).join('\n'), boundary = randomUUID();
      const r = await app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { authorization: 'Bearer ' + auth[who], 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`) });
      expect(r.statusCode, r.body).toBe(201); return r.json().data.id as string;
    }
    async function imported(who: number, name: string) { const id = await upload(who, name); expect((await request(who, 'PUT', `datasets/${id}/mapping`, mapping)).statusCode).toBe(200); expect((await request(who, 'POST', `datasets/${id}/imports`, undefined, randomUUID())).statusCode).toBe(200); return id; }
    const a = await imported(0, 'Private-A'), b = await imported(1, 'Private-B');
    for (const [who, ids] of [[0, [a]], [1, [b]], [2, [a, b]]] as const) { const r = await request(who, 'GET', 'datasets'); expect(r.statusCode).toBe(200); expect(r.json().data.map((d: { id: string }) => d.id).sort()).toEqual([...ids].sort()); }
    const missing = String(new ObjectId()), from = '2026-01-01T00:00:00Z', to = '2026-01-01T19:00:00Z';
    const paths = [`sensors?datasetId=${a}`, `readings?datasetId=${a}`, `datasets/${a}/profile`, `reading-aggregates?datasetId=${a}&from=${from}&to=${to}&bucket=hour`, `anomalies?datasetId=${a}`];
    for (const path of paths) {
      const denied = await request(1, 'GET', path), unknown = await request(1, 'GET', path.replace(a, missing)); expect(denied.statusCode).toBe(422); expect(denied.body).toBe(unknown.body);
      expect((await request(0, 'GET', path)).statusCode).toBe(200); expect((await request(2, 'GET', path)).statusCode).toBe(200);
    }
    for (const [method, suffix, body] of [['GET', 'validation', undefined], ['PUT', 'mapping', mapping], ['POST', 'imports', undefined]] as const) {
      const r = await request(1, method, `datasets/${a}/${suffix}`, body, randomUUID()); expect(r.statusCode).toBe(404); expect(r.body).not.toMatch(/Private-A|sourceFilename|columns/);
    }
    const first = await request(0, 'GET', `readings?datasetId=${a}&limit=1`), cursor = first.json().page.nextCursor; expect(first.headers['cache-control']).toBe('private, no-store');
    expect((await request(1, 'GET', `readings?datasetId=${b}&cursor=${cursor}`)).statusCode).toBe(400);
    expect((await request(2, 'GET', `readings?datasetId=${a}&cursor=${cursor}`)).statusCode).toBe(400);
    for (const forged of [`readings?datasetId=${a}&role=admin`, `datasets?createdBy=${users[0]!.id}`]) expect((await request(1, 'GET', forged)).statusCode).toBe(400);
    const detection = { datasetId: a, family: 'statistical', method: 'zscore', config: { threshold: 3 } };
    expect((await request(1, 'POST', 'analysis-runs', detection, randomUUID())).statusCode).toBe(404);
    const accepted = await request(0, 'POST', 'analysis-runs', detection, randomUUID()); expect(accepted.statusCode, accepted.body).toBe(202); const runId = accepted.json().data.id;
    const until = Date.now() + 10000; let run;
    do { run = (await request(0, 'GET', 'analysis-runs/' + runId)).json().data; if (run.status === 'completed' || run.status === 'failed') break; await new Promise(r => setTimeout(r, 20)); } while (Date.now() < until);
    expect(run.status, JSON.stringify(run)).toBe('completed');
    expect((await request(1, 'GET', 'analysis-runs/' + runId)).statusCode).toBe(404); expect((await request(1, 'GET', 'analysis-runs?datasetId=' + a)).json().data).toEqual([]);
    expect((await request(2, 'GET', 'analysis-runs/' + runId)).statusCode).toBe(200);
    const results = await request(0, 'GET', `anomalies?datasetId=${a}&analysisRunId=${runId}`); expect(results.json().data).toHaveLength(1); const anomaly = results.json().data[0];
    for (const method of ['GET', 'PATCH'] as const) expect((await request(1, method, 'anomalies/' + anomaly.id, method === 'PATCH' ? { baseVersion: 1, changes: { note: 'unauthorized' } } : undefined)).statusCode).toBe(404);
    expect((await request(1, 'GET', `anomalies?datasetId=${b}&analysisRunId=${runId}`)).json().error.code).toBe('ANALYSIS_RUN_NOT_FOUND');
    expect((await request(2, 'PATCH', 'anomalies/' + anomaly.id, { baseVersion: 1, changes: { note: 'Admin reviewed' } })).statusCode).toBe(200);
    expect((await request(0, 'PATCH', 'anomalies/' + anomaly.id, { baseVersion: 2, changes: { status: 'confirmed' } })).statusCode).toBe(200);
    const pending = await upload(0, 'Private-pending');
    expect((await request(0, 'GET', `datasets/${pending}/validation`)).statusCode).toBe(200); expect((await request(1, 'GET', `datasets/${pending}/validation`)).statusCode).toBe(404);
    expect((await request(0, 'GET', `readings?datasetId=${pending}`)).json().error.code).toBe('DATASET_NOT_READY'); expect((await request(1, 'GET', `readings?datasetId=${pending}`)).json().error.code).toBe('DATASET_NOT_FOUND');
    await request(0, 'PUT', `datasets/${pending}/mapping`, mapping); hold = true;
    const importing = request(0, 'POST', `datasets/${pending}/imports`, undefined, randomUUID()); await blocked;
    expect((await request(1, 'POST', `datasets/${pending}/imports`, undefined, randomUUID())).statusCode).toBe(404);
    expect((await request(1, 'GET', `datasets/${pending}/validation`)).statusCode).toBe(404);
    expect((await request(0, 'GET', `datasets/${pending}/validation`)).json().status).toBe('importing'); release(); expect((await importing).statusCode).toBe(200);
    // Quarantine legacy malformed ownership without migration/deletion.
    for (const createdBy of [undefined, 'invalid', users[0]!.id]) { const id = new ObjectId(); await app.mongo.db.collection('datasets').insertOne({ _id: id, status: 'imported', ...(createdBy ? { createdBy } : {}) }); expect((await request(0, 'GET', `readings?datasetId=${id}`)).json().error.code).toBe('DATASET_NOT_FOUND'); }
    const page = await request(0, 'GET', 'datasets?limit=1'); const accountCursor = page.json().page.nextCursor; expect(accountCursor).toBeTruthy(); expect((await request(1, 'GET', 'datasets?cursor=' + accountCursor)).statusCode).toBe(400);
    expect(await app.mongo.db.collection('analysisRuns').countDocuments()).toBe(1);
  } finally { release?.(); await app.close(); await mongo.stop(); if (storage.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-ownership-')) await rm(storage, { recursive: true, force: true }); }
}, 45000);
