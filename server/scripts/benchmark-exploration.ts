/** Disposable C2 diagnostic: no env DB, no ML, no production dataset mutation. */
import { cpus, totalmem, platform, release } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { parse } from 'csv-parse/sync';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { ensureOnlineIndexes } from '../src/shared/persistence/indexes.js';
import { configureExplorationMetadata } from '../src/modules/exploration/exploration.metadata.js';
import { buildExplorationPipeline } from '../src/modules/exploration/exploration.repository.js';
import type { Sampling } from '@pm25/shared-core';
const secret = 'C2-disposable-benchmark-only-secret-at-least-32-bytes';
const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
const client = await new MongoClient(mongo.getUri()).connect(), db = client.db('c2_disposable_measurements');
const app = buildApp({ config: loadConfig({ JWT_SECRET: secret, MONGODB_URI: mongo.getUri(db.databaseName), LOG_LEVEL: 'silent' }), logger: false, analysisWorkerEnabled: false });
function indexes(value: unknown, found = new Set<string>()): string[] {
  if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) { if (key === 'indexName' && typeof v === 'string') found.add(v); else if (typeof v === 'object') indexes(v, found); }
  return [...found];
}
try {
  await ensureOnlineIndexes(db); await app.ready();
  const user = new ObjectId(); await db.collection('users').insertOne({ _id: user, role: 'analyst', isActive: true });
  const token = await createTokens(secret).issue(String(user)), url = await app.listen({ host: '127.0.0.1', port: 0 });
  const results = [];
  for (const mode of ['golden-csv-seed', 'synthetic-500000'] as const) {
    const id = new ObjectId(), sensors = new Map<string, ObjectId>();
    await db.collection('datasets').insertOne({ _id: id, status: 'imported', sourceFilename: `[QUERY HARNESS ${mode}; not a B3 import]` });
    let sampling: Sampling, readings = 0;
    if (mode === 'golden-csv-seed') {
      const rows = parse(await readFile(new URL('../tests/fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url)), { columns: true }) as Record<string, string>[];
      for (const row of rows) if (!sensors.has(row.sensorId!)) sensors.set(row.sensorId!, new ObjectId());
      for (let start = 0; start < rows.length; start += 1000) await db.collection('readings').insertMany(rows.slice(start, start + 1000).map(row => ({ datasetId: id, sensorId: sensors.get(row.sensorId!), ts: new Date(row.timestamp!), value: Number(row.value), unit: 'ug/m3', location: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] } })));
      const m = JSON.parse(await readFile(new URL('../tests/fixtures/beijing-exploration-metadata.json', import.meta.url), 'utf8'));
      sampling = m.sampling; readings = rows.length;
    } else {
      for (let s = 0; s < 20; s++) sensors.set(`SYN-${s}`, new ObjectId());
      const stations = [...sensors.values()], start = Date.parse('2026-11-01T00:00:00Z');
      for (let offset = 0; offset < 500000; offset += 2000) await db.collection('readings').insertMany(Array.from({ length: 2000 }, (_, i) => ({ datasetId: id, sensorId: stations[(offset + i) % 20], ts: new Date(start + Math.floor((offset + i) / 20) * 60000), value: (offset + i) % 300, unit: 'ug/m3', location: { type: 'Point', coordinates: [116, 40] } })));
      sampling = { cadenceSeconds: 60, anchor: new Date(start).toISOString(), expectedFrom: new Date(start).toISOString(), expectedTo: new Date(start + 24999 * 60000).toISOString() }; readings = 500000;
    }
    await db.collection('sensors').insertMany([...sensors].map(([name, _id]) => ({ _id, datasetId: id, externalId: name, name, location: { type: 'Point', coordinates: [116, 40] } })));
    await configureExplorationMetadata(db, String(id), { timeZone: '+08:00', provenance: `Explicit ${mode} query measurement, not training`, sampling });
    const cases = [];
    for (const kind of ['profile', 'hour', 'day'] as const) {
      const query = new URLSearchParams({ datasetId: String(id), from: sampling.expectedFrom, to: sampling.expectedTo, bucket: kind === 'profile' ? 'hour' : kind });
      const endpoint = kind === 'profile' ? `${url}/api/v1/datasets/${id}/profile` : `${url}/api/v1/reading-aggregates?${query}`;
      const durations: number[] = []; let bytes = 0, status = 0, maxRss = process.memoryUsage().rss, maxHeap = process.memoryUsage().heapUsed;
      const before = process.memoryUsage();
      const timer = setInterval(() => { const m = process.memoryUsage(); maxRss = Math.max(maxRss, m.rss); maxHeap = Math.max(maxHeap, m.heapUsed); }, 5);
      try { for (let i = 0; i < 3; i++) {
        const start = performance.now(), response = await fetch(endpoint, { headers: { authorization: 'Bearer ' + token } }), body = await response.text();
        durations.push(Math.round((performance.now() - start) * 100) / 100); bytes = Buffer.byteLength(body); status = response.status;
        if (status !== 200) throw new Error(`C2 ${mode}/${kind}: ${status} ${body}`);
        const data = JSON.parse(body).data;
        if (kind === 'profile' && data.dataset.readingCount !== readings) throw new Error('Incomplete profile');
        if (kind !== 'profile' && data.series.flatMap((s: { buckets: { count: number }[] }) => s.buckets).reduce((n: number, b: { count: number }) => n + b.count, 0) !== readings) throw new Error('Incomplete aggregate');
      } } finally { clearInterval(timer); }
      const scope = { sensorIds: null, bbox: null, from: kind === 'profile' ? null : sampling.expectedFrom, to: kind === 'profile' ? null : sampling.expectedTo };
      const pipeline = buildExplorationPipeline(String(id), [...sensors.values()].map(String), scope, sampling, 500000, kind === 'profile' ? undefined : { size: kind === 'hour' ? 3600000 : 86400000, offset: 8 * 3600000 });
      const explain = await db.collection('readings').aggregate(pipeline, { maxTimeMS: 5000, allowDiskUse: false }).explain('executionStats');
      cases.push({ kind, status, samplesMs: durations, responseBytes: bytes, sampledNodeRssGrowthBytes: Math.max(0, maxRss - before.rss), sampledNodeHeapGrowthBytes: Math.max(0, maxHeap - before.heapUsed), indexes: indexes(explain), explain });
      process.stdout.write(`${mode}/${kind}: ${durations.join(', ')} ms; ${bytes} bytes\n`);
    }
    results.push({ mode, readings, stations: sensors.size, cases });
  }
  const report = { measuredAt: new Date().toISOString(), node: process.version, mongodb: (await db.command({ buildInfo: 1 })).version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, physicalRamBytes: totalmem(),
    scope: 'Disposable single-node Replica Set; real localhost HTTP/JWT and production query pipeline. Golden bytes seeded directly for query timing (B3 import correctness is integration/E2E). Synthetic 500k/20 stations at 1-minute cadence. Three sequential calls/case; first call included, no load/SLA claim. Sampled Node process includes HTTP client and validation, excludes mongod; not an isolated backend peak. No model inference or training.', results };
  await writeFile(new URL('../../docs/backend/c2-query-measurements.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
} finally { await app.close(); await client.close(); await mongo.stop(); }
