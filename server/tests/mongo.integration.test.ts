import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ensureOnlineIndexes, onlineIndexes } from '../src/shared/persistence/indexes.js';
import { toReadingDto, type ReadingDocument } from '../src/shared/persistence/mapping.js';
import { keysetPredicate } from '../src/shared/persistence/keyset.js';

// Despite the package name this starts a genuine mongod/WiredTiger process, not a DB mock.
// Version is test infrastructure only, not a production deployment decision.
let mongo: MongoMemoryServer;
let client: MongoClient;
const apps: FastifyInstance[] = [];
const database = `b1_test_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '8.2.6' } });
  client = new MongoClient(mongo.getUri(), { serverSelectionTimeoutMS: 2000 });
  await client.connect();
});
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

function createApp() {
  const config = loadConfig({ MONGODB_URI: mongo.getUri(database), MONGODB_TIMEOUT_MS: '1000', LOG_LEVEL: 'silent' });
  const app = buildApp({ config, logger: false });
  apps.push(app);
  return app;
}

describe('Fastify + Official Driver + actual MongoDB', () => {
  it('serves readiness over HTTP, degrades on DB loss, recovers and closes the MongoDB topology', async () => {
    const app = createApp();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${address}/api/v1/health`)).status).toBe(200);
    const healthy = await app.inject('/api/v1/health');
    expect(healthy.json().status).toBe('ok');
    try {
      await mongo.stop({ doCleanup: false });
      const unavailable = await app.inject('/api/v1/health');
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toEqual({ status: 'degraded', timestamp: expect.stringMatching(/Z$/) });
    } finally { await mongo.start(true); }
    await expect.poll(async () => (await app.inject('/api/v1/health')).statusCode, { timeout: 10_000 }).toBe(200);
    let closed = false;
    app.mongo.client.once('topologyClosed', () => { closed = true; });
    await app.close();
    expect(closed).toBe(true);
    await expect(fetch(`${address}/api/v1/health`)).rejects.toThrow();
  });

  it('starts in degraded mode when MongoDB is down and reconnects without rebuilding the app', async () => {
    const app = createApp();
    await mongo.stop({ doCleanup: false });
    try {
      expect((await app.inject('/api/v1/health')).statusCode).toBe(503);
    } finally { await mongo.start(true); }
    await expect.poll(async () => (await app.inject('/api/v1/health')).statusCode, { timeout: 10_000 }).toBe(200);
  });

  it('creates the online indexes repeatably and enforces the unique keys in MongoDB', async () => {
    const db = client.db(database);
    await ensureOnlineIndexes(db);
    await ensureOnlineIndexes(db);
    for (const [collection, definitions] of Object.entries(onlineIndexes)) {
      const installed = await db.collection(collection).listIndexes().toArray();
      for (const definition of definitions) {
        expect(installed.find((index) => index.name === definition.name)).toMatchObject({ key: definition.key,
          ...(definition.unique ? { unique: true } : {}) });
      }
    }
    expect((await db.listCollections().toArray()).map((collection) => collection.name)).not.toContain('processedMutations');
    const datasetId = new ObjectId();
    const sensorId = new ObjectId();
    const readingId = new ObjectId();
    const runId = new ObjectId();
    const uniqueCases = [
      { collection: 'users', document: { usernameNormalized: 'same-username' } },
      { collection: 'sensors', document: { datasetId, externalId: 'S01', location: { type: 'Point', coordinates: [106.7, 10.8] } } },
      { collection: 'readings', document: { datasetId, sensorId, ts: new Date('2026-11-14T00:00:00Z') } },
      { collection: 'anomalies', document: { analysisRunId: runId, readingId } },
    ];
    for (const { collection, document } of uniqueCases) {
      await db.collection(collection).insertOne({ ...document });
      await expect(db.collection(collection).insertOne({ ...document })).rejects.toMatchObject({ code: 11000 });
    }
    await db.collection('sensors').insertOne({ datasetId: new ObjectId(), externalId: 'S01' });
    await db.collection('anomalies').insertOne({ analysisRunId: new ObjectId(), readingId });
  });

  it('round-trips BSON to public DTOs and uses geo/keyset queries without losing tied timestamps', async () => {
    const db = client.db(database);
    await ensureOnlineIndexes(db);
    const datasetId = new ObjectId();
    const sensorId = new ObjectId();
    const ts = new Date('2026-11-14T08:00:00+07:00');
    const readings = db.collection<ReadingDocument>('readings');
    const documents: ReadingDocument[] = Array.from({ length: 5 }, (_, index) => ({
      _id: new ObjectId(), datasetId, sensorId: index === 0 ? sensorId : new ObjectId(), ts,
      location: { type: 'Point', coordinates: [106.7, 10.8] }, value: index, unit: 'ug/m3',
    }));
    await readings.insertMany(documents);
    const first = await readings.findOne({ _id: documents[0]!._id });
    expect(first?.ts).toBeInstanceOf(Date);
    expect(toReadingDto(first!)).toMatchObject({ id: documents[0]!._id.toHexString(), ts: '2026-11-14T01:00:00.000Z', value: 0,
      location: { type: 'Point', coordinates: [106.7, 10.8] } });
    expect(toReadingDto(first!)).not.toHaveProperty('_id');
    for (const direction of ['asc', 'desc'] as const) {
      const ids: string[] = [];
      let last: ReadingDocument | undefined;
      while (true) {
        const predicate = last ? keysetPredicate('ts', direction, { key: last.ts, id: last._id }) : {};
        const page: ReadingDocument[] = await readings.find({ datasetId, ...predicate })
          .sort({ ts: direction === 'asc' ? 1 : -1, _id: direction === 'asc' ? 1 : -1 }).limit(2).toArray();
        if (!page.length) break;
        ids.push(...page.map((document) => document._id.toHexString()));
        last = page.at(-1);
      }
      expect(new Set(ids).size).toBe(5);
      const expected = documents.map((document) => document._id.toHexString()).sort();
      expect(ids).toEqual(direction === 'asc' ? expected : expected.reverse());
    }
    const inBbox = await readings.countDocuments({ datasetId, location: { $geoWithin: { $geometry: {
      type: 'Polygon', coordinates: [[[106.6, 10.7], [106.8, 10.7], [106.8, 10.9], [106.6, 10.9], [106.6, 10.7]]],
    } } } });
    expect(inBbox).toBe(5);
    const plan = await readings.find({ datasetId, ts }).sort({ ts: 1, _id: 1 }).hint('ix_readings_dataset_ts_id').explain('executionStats');
    expect(plan.executionStats.nReturned).toBe(5);
  });
});
