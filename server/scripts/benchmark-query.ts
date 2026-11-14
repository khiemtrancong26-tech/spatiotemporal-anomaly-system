/** B4 single-client diagnostic on disposable synthetic data. Never uses env DB/credentials. */
import { cpus, totalmem, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId, Double } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { ensureOnlineIndexes } from '../src/shared/persistence/indexes.js';
import { buildQuery } from '../src/modules/query/query.repository.js';
import type { PageInput } from '../src/modules/query/query.types.js';
import { createCursorCodec, queryFingerprint } from '../src/shared/pagination.js';

const secret = 'B4-disposable-benchmark-only-secret-never-use-in-production';
const start = Date.UTC(2026, 10, 14), samples = 10;
const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
const client = await new MongoClient(mongo.getUri()).connect(), db = client.db('b4_disposable_measurements');
const config = loadConfig({ JWT_SECRET: secret, MONGODB_URI: mongo.getUri(db.databaseName), LOG_LEVEL: 'silent', MONGODB_TIMEOUT_MS: '10000' });
const app = buildApp({ config, logger: false });
type Case = { name: string; kind: 'sensors' | 'readings'; input: PageInput; query: Record<string, string> };
function details(value: unknown, key: string, result = new Set<string>()): string[] {
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) {
    if (name === key && typeof item === 'string') result.add(item);
    if (item && typeof item === 'object') details(item, key, result);
  }
  return [...result];
}
try {
  await ensureOnlineIndexes(db);
  const userId = new ObjectId();
  await db.collection('users').insertOne({ _id: userId, username: 'B4 synthetic benchmark', role: 'analyst', isActive: true });
  const token = await createTokens(secret).issue(userId.toHexString());
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const results = [];
  for (const [count, stationCount] of [[100000, 200], [500000, 500]] as const) {
    const datasetId = new ObjectId();
    const stations = Array.from({ length: stationCount }, (_, index) => ({ _id: new ObjectId(), datasetId,
      externalId: `S${String(index).padStart(4, '0')}`, name: `Synthetic station ${index}`,
      location: { type: 'Point', coordinates: [100 + index % 25 / 10, 5 + Math.floor(index / 25) / 10] }, type: 'pm25', unit: 'ug/m3' }));
    await db.collection('datasets').insertOne({ _id: datasetId, name: `[SYNTHETIC B4] ${count} readings`, sourceFilename: '[seed, not B3 import]', status: 'imported', createdBy: userId, createdAt: new Date(start) });
    await db.collection('sensors').insertMany(stations);
    const seedStart = performance.now();
    for (let offset = 0; offset < count; offset += 2000) {
      const batch = Array.from({ length: Math.min(2000, count - offset) }, (_, local) => {
        const index = offset + local, sensor = stations[index % stationCount]!;
        return { _id: new ObjectId(), datasetId, sensorId: sensor._id, ts: new Date(start + Math.floor(index / stationCount) * 60000),
          location: sensor.location, value: new Double(index % 300), unit: 'ug/m3' };
      });
      await db.collection('readings').insertMany(batch, { ordered: true });
    }
    const seedMs = Math.round(performance.now() - seedStart), id = datasetId.toHexString();
    process.stdout.write(`Seeded ${count} synthetic readings / ${stationCount} stations in ${seedMs} ms\n`);
    const base: PageInput = { datasetId: id, direction: 'asc', limit: 101 };
    const from = new Date(start + 100 * 60000).toISOString(), to = new Date(start + 110 * 60000).toISOString();
    const sensorId = stations[53]!._id.toHexString();
    const middle = await db.collection('readings').findOne({ datasetId, ts: new Date(start + Math.floor(count / stationCount / 2) * 60000) });
    if (!middle) throw new Error('Missing middle boundary');
    const after = { id: middle._id.toHexString(), key: middle.ts.toISOString() as string };
    const cursor = createCursorCodec(config.cursorSecret).encode(after, queryFingerprint('readings.list', { datasetId: id }, 'ts:asc'));
    const cases: Case[] = [
      { name: 'sensors_default', kind: 'sensors', input: base, query: {} },
      { name: 'sensors_bbox', kind: 'sensors', input: { ...base, bbox: [100.2, 5.2, 100.4, 5.4] }, query: { bbox: '100.2,5.2,100.4,5.4' } },
      { name: 'readings_default', kind: 'readings', input: base, query: {} },
      { name: 'readings_time', kind: 'readings', input: { ...base, from, to }, query: { from, to } },
      { name: 'readings_sensor_time_bbox', kind: 'readings', input: { ...base, sensorId, from, to, bbox: [100.2, 5.2, 100.4, 5.4] }, query: { sensorId, from, to, bbox: '100.2,5.2,100.4,5.4' } },
      { name: 'readings_bbox', kind: 'readings', input: { ...base, bbox: [100.2, 5.2, 100.4, 5.4] }, query: { bbox: '100.2,5.2,100.4,5.4' } },
      { name: 'readings_bbox_empty', kind: 'readings', input: { ...base, bbox: [0, 0, 1, 1] }, query: { bbox: '0,0,1,1' } },
      { name: 'readings_deep_cursor', kind: 'readings', input: { ...base, after }, query: { cursor } },
    ];
    const measurements = [];
    for (const entry of cases) {
      const { filter, options } = buildQuery(entry.input, entry.kind === 'readings');
      const explain = await db.collection(entry.kind).find(filter, options).explain('executionStats');
      const endpoint = `${url}/api/v1/${entry.kind}?${new URLSearchParams({ datasetId: id, limit: '100', ...entry.query })}`;
      async function request() {
        const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
        const body = await response.text();
        if (response.status !== 200) throw new Error(`Diagnostic HTTP failed: ${response.status}`);
        return { bytes: Buffer.byteLength(body), rows: (JSON.parse(body) as { data: unknown[] }).data.length };
      }
      await request(); global.gc?.();
      const before = process.memoryUsage(); let maxRss = before.rss, maxHeap = before.heapUsed;
      const monitor = setInterval(() => { const memory = process.memoryUsage(); maxRss = Math.max(maxRss, memory.rss); maxHeap = Math.max(maxHeap, memory.heapUsed); }, 5);
      const latencies: number[] = []; let payload = { bytes: 0, rows: 0 };
      try {
        for (let sample = 0; sample < samples; sample++) {
          const began = performance.now(); payload = await request(); latencies.push(performance.now() - began);
        }
      } finally { clearInterval(monitor); }
      latencies.sort((a, b) => a - b);
      const stats = explain.executionStats;
      measurements.push({ name: entry.name, pageSize: 100, actualRows: payload.rows, responseBytes: payload.bytes, samples,
        httpMedianMs: Number(latencies[Math.floor(samples / 2)]!.toFixed(2)), httpP95Ms: Number(latencies[Math.ceil(samples * .95) - 1]!.toFixed(2)),
        explain: { nReturned: stats.nReturned, totalKeysExamined: stats.totalKeysExamined, totalDocsExamined: stats.totalDocsExamined,
          executionTimeMillis: stats.executionTimeMillis, indexes: details(explain.queryPlanner.winningPlan, 'indexName'), stages: details(explain.queryPlanner.winningPlan, 'stage') },
        sampledProcessRssGrowthBytes: Math.max(0, maxRss - before.rss), sampledProcessHeapGrowthBytes: Math.max(0, maxHeap - before.heapUsed) });
    }
    // Diagnose the existing geo index separately: spherical polygon semantics differ
    // from the approved coordinate rectangle. This is NOT the production predicate.
    const geo = await db.collection('readings').find({ datasetId, location: { $geoWithin: { $geometry: { type: 'Polygon', coordinates: [[[100.2, 5.2], [100.4, 5.2], [100.4, 5.4], [100.2, 5.4], [100.2, 5.2]]] } } } })
      .hint('ix_readings_dataset_geo').limit(101).explain('executionStats');
    results.push({ readings: count, stations: stationCount, seedMs, measurements, geoIndexDiagnosticOnly: {
      indexes: details(geo.queryPlanner.winningPlan, 'indexName'), nReturned: geo.executionStats.nReturned,
      totalKeysExamined: geo.executionStats.totalKeysExamined, totalDocsExamined: geo.executionStats.totalDocsExamined, executionTimeMillis: geo.executionStats.executionTimeMillis,
    } });
  }
  const report = { strategy: 'Exact coordinate rectangle + conservative sphere prefilter; unchanged 13 production indexes, no production hints', measuredAt: new Date().toISOString(), node: process.version, mongodb: (await db.command({ buildInfo: 1 })).version,
    topology: 'temporary single-node replica set', platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, physicalRamBytes: totalmem(),
    scope: 'Synthetic seed, not a B3 import or detector evaluation. One localhost HTTP client, 1 warmup + 10 sequential requests/case, no TLS. Memory samples include Backend and fetch harness in the same Node process, exclude mongod, and are not an isolated Server peak or a bounded-memory proof. No 100-VU/10-minute stress or SLA claim.',
    results };
  const output = new URL('../../docs/backend/b4-query-measurements.json', import.meta.url);
  await mkdir(new URL('./', output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${fileURLToPath(output)}\n`);
} finally { await app.close(); await client.close(); await mongo.stop(); }
