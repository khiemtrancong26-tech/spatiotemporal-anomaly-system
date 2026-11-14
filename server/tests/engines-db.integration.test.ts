import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadTestConfig } from './helpers.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { runStatisticalAdapter } from '../src/engines/statistical.js';
import { createIsolationForestAdapter } from '../src/engines/isolation-forest.js';
import { isolationOptions } from './engine-integration.helpers.js';
import { experimentalPolicy } from '../../shared-core/tests/experimental-policies.js';
import type { Reading } from '@pm25/shared-core/contracts';

let mongo: MongoMemoryReplSet, app: FastifyInstance, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'pm25-engine-db-'));
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  app = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri(`engine_${randomUUID().replaceAll('-', '')}`), IMPORT_STORAGE_DIR: directory, LOG_LEVEL: 'silent' }), logger: false });
  await app.ready();
});
afterAll(async () => {
  await app?.close(); await mongo?.stop();
  if (!directory.startsWith(resolve(tmpdir()) + sep) || !directory.includes('pm25-engine-db-')) throw new Error('Unsafe cleanup');
  await rm(directory, { recursive: true, force: true });
});
it('feeds actual imported/query DTOs into all library adapters and creates linked in-memory candidates without B5 persistence/routes', async () => {
  const userId = new ObjectId();
  await app.mongo.db.collection('users').insertOne({ _id: userId, username: 'Engine integration fixture', role: 'analyst', isActive: true });
  const headers = { authorization: `Bearer ${await createTokens(loadTestConfig().jwtSecret).issue(userId.toHexString())}` };
  const values = [...Array.from({ length: 21 }, (_, index) => index % 3 + 1), 100];
  const csv = `sensorId,latitude,longitude,timestamp,value\n${values.map((value, index) => `A,10,106,${new Date(Date.UTC(2026, 10, 15) + index * 1000).toISOString()},${value}`).join('\n')}\n`;
  const boundary = `engine-${randomUUID()}`;
  const upload = await app.inject({ method: 'POST', url: '/api/v1/datasets', headers: { ...headers, 'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="engine.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`) });
  expect(upload.statusCode, upload.body).toBe(201); const datasetId = upload.json().data.id;
  expect((await app.inject({ method: 'PUT', url: `/api/v1/datasets/${datasetId}/mapping`, headers,
    payload: { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/v1/datasets/${datasetId}/imports`, headers: { ...headers, 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
  const response = await app.inject({ url: `/api/v1/readings?datasetId=${datasetId}&limit=100`, headers });
  expect(response.statusCode).toBe(200); const readings = response.json().data as Reading[];
  expect(readings).toHaveLength(22); expect(response.json().page.nextCursor).toBeNull();
  const last = readings.at(-1)!;
  for (const method of ['zscore', 'iqr', 'moving_avg'] as const) {
    const config = method === 'iqr' ? { multiplier: 1.5 as const } : method === 'moving_avg' ? { threshold: 3, windowSize: 3 } : { threshold: 3 };
    const evaluation = runStatisticalAdapter({ method, readings, config }, experimentalPolicy(method));
    expect(evaluation.output.status, evaluation.output.message).toBe('completed');
    expect(evaluation.candidates.map(candidate => candidate.readingId)).toEqual([last.id]);
    expect(evaluation.candidates[0]).toMatchObject({ datasetId, sensorId: last.sensorId, ts: last.ts, value: 100, location: { type: 'Point', coordinates: [106, 10] } });
  }
  // Explicit upstream synthetic features linked to DB IDs, NOT extraction/training
  // of PM2.5 features. This proves the bridge and references, not model quality.
  const features = readings.map((reading, index) => ({ readingId: reading.id, values: index === readings.length - 1 ? [10, 10] : [1.9, 2] }));
  const ml = await createIsolationForestAdapter(isolationOptions())(readings, features, { id: 'EXPERIMENT-ONLY/negative-decision', score: point => -point.decisionFunction });
  expect(ml.candidates.map(candidate => candidate.readingId)).toEqual([last.id]);
  expect(ml.candidates[0]).toMatchObject({ datasetId, sensorId: last.sensorId, ts: last.ts, value: 100 });
  expect(await app.mongo.db.collection('analysisRuns').countDocuments({})).toBe(0);
  expect(await app.mongo.db.collection('anomalies').countDocuments({})).toBe(0);
  for (const method of ['GET', 'POST'] as const) expect((await app.inject({ method, url: '/api/v1/analysis-runs', headers })).statusCode).toBe(404);
}, 60000);
