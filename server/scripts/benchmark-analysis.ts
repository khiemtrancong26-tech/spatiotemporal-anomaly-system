// Disposable DB, real compiled Backend/HTTP/engines. No production database access.
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { loadConfig } from '../src/config.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { ensureOnlineIndexes } from '../src/shared/persistence/indexes.js';

const compiledUrl = new URL('../dist/app.js', import.meta.url).href;
const { buildApp }: typeof import('../src/app.js') = await import(compiledUrl);
const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
const config = loadConfig({ JWT_SECRET: randomBytes(32).toString('hex'), MONGODB_URI: mongo.getUri('b5_benchmark'), LOG_LEVEL: 'silent' });
const app = buildApp({ config, logger: false });
const results: Record<string, unknown>[] = [];
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), quantile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return { count: values.length, min: sorted[0] ?? 0, p50: quantile(.5), p95: quantile(.95), max: sorted.at(-1) ?? 0 };
};
try {
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const db = app.mongo.db;
  await ensureOnlineIndexes(db);
  const datasetId = new ObjectId(), userId = new ObjectId(), sensors = Array.from({ length: 1000 }, () => new ObjectId());
  await db.collection('users').insertOne({ _id: userId, username: '[BENCHMARK B5]', role: 'analyst', isActive: true });
  await db.collection('datasets').insertOne({ _id: datasetId, status: 'imported', name: '[SEED B5 benchmark] 500k', createdBy: userId, createdAt: new Date() });
  await db.collection('sensors').insertMany(sensors.map((_id, i) => ({ _id, datasetId, externalId: String(i), name: String(i),
    location: { type: 'Point', coordinates: [106, 10] }, type: 'pm25', unit: 'ug/m3' })));
  for (let index = 0; index < sensors.length; index += 2) {
    await db.collection('readings').insertMany(sensors.slice(index, index + 2).flatMap(sensorId => Array.from({ length: 500 }, (_, sample) => ({
      _id: new ObjectId(), datasetId, sensorId, ts: new Date(Date.UTC(2026, 0, 1) + sample * 1000),
      value: sample === 499 ? 10000 : sample % 3 + 1, unit: 'ug/m3', location: { type: 'Point', coordinates: [106, 10] },
    }))));
  }
  const scope = { sensorIds: sensors.slice(0, 60).map(id => id.toHexString()) };
  if (await db.collection('readings').countDocuments({ datasetId }) !== 500000 ||
      await db.collection('readings').countDocuments({ datasetId, sensorId: { $in: sensors.slice(0, 60) } }) !== 30000) throw new Error('Invalid benchmark scope');
  const headers = { authorization: `Bearer ${await createTokens(config.jwtSecret).issue(userId.toHexString())}` };
  for (const method of ['zscore', 'iqr', 'moving_avg', 'isolation_forest']) {
    globalThis.gc?.();
    const cpu = process.cpuUsage(), baselineRss = process.memoryUsage().rss, start = performance.now();
    let peakRss = baselineRss, sampling = true;
    const latencies: number[] = [], healthLatencies: number[] = [], errors: number[] = [];
    const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
    const sampleMemory = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
    const latencySampler = (async () => {
      while (sampling) {
        for (const kind of ['health', 'readings']) {
          const began = performance.now(), response = await fetch(`${url}/api/v1/${kind}${kind === 'readings' ? `?datasetId=${datasetId}&limit=1` : ''}`, { headers });
          await response.arrayBuffer();
          (kind === 'readings' ? latencies : healthLatencies).push(performance.now() - began);
          if (response.status !== 200) errors.push(response.status);
        }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    })();
    try {
      const response = await fetch(`${url}/api/v1/analysis-runs`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({ datasetId: datasetId.toHexString(), family: method === 'isolation_forest' ? 'ml' : 'statistical', method, scope,
          config: method === 'isolation_forest' ? {} : method === 'iqr' ? { multiplier: 1.5 } : method === 'moving_avg' ? { threshold: 3, windowSize: 3 } : { threshold: 3 } }) });
      const accepted = await response.json() as { data: { id: string; status: string } };
      if (response.status !== 202 || accepted.data.status !== 'queued') throw new Error(`Acceptance failed for ${method}`);
      let run: { status: string } | undefined;
      while (performance.now() - start < 150000) {
        const polled = await fetch(`${url}/api/v1/analysis-runs/${accepted.data.id}`, { headers });
        run = ((await polled.json()) as { data: { status: string } }).data;
        if (['completed', 'failed'].includes(run.status)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (run?.status !== 'completed') throw new Error(`Run did not complete for ${method}`);
      const anomalyCount = await db.collection('anomalies').countDocuments({ analysisRunId: new ObjectId(accepted.data.id) });
      if (method !== 'isolation_forest' && anomalyCount !== 60) throw new Error('Statistical scope was truncated or incorrect');
      const elapsedMs = performance.now() - start, usedCpu = process.cpuUsage(cpu);
      results.push({ method, status: run.status, inputReadings: 30000, anomalyCount, elapsedMs, nodeCpuMs: (usedCpu.user + usedCpu.system) / 1000,
        nodeBaselineRssMiB: baselineRss / 1048576, nodePeakRssMiB: peakRss / 1048576,
        eventLoopDelayMaxMs: delay.max / 1e6, eventLoopDelayP99Ms: delay.percentile(99) / 1e6,
        concurrentReadingsHttpMs: summary(latencies), concurrentHealthHttpMs: summary(healthLatencies), httpErrors: errors });
      if (errors.length) throw new Error('Concurrent HTTP failed');
    } finally {
      sampling = false; clearInterval(sampleMemory); delay.disable(); await latencySampler;
    }
  }
  const report = { recordedAt: new Date().toISOString(), node: process.version, mongo: (await db.command({ buildInfo: 1 })).version,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalRamMiB: totalmem() / 1048576,
    backend: 'compiled server/dist/app.js and compiled statistical worker; actual HTTP; disposable single-node replica set',
    dataset: { seededReadings: 500000, sensors: 1000, readingsPerSensor: 500, scopeSensors: 60, scopeReadings: 30000 },
    settings: { concurrency: config.analysis.concurrency, timeoutMs: config.analysis.timeoutMs, maxReadings: config.analysis.maxReadings,
      leaseMs: config.analysis.leaseMs, heartbeatMs: config.analysis.heartbeatMs, pollMs: config.analysis.pollMs }, results,
    limitations: ['Single local sequential run per method, not a 100-user/SRS SLA benchmark.',
      'Node RSS/CPU includes statistical worker threads, excludes MongoDB and Python subprocess RSS/CPU.',
      'Compiled Backend correctness/performance smoke; no ML accuracy labels or domain-quality claim.',
      'Synthetic seeded workload, not B3 import benchmark; all detector engines and persisted results are real.'] };
  await writeFile(new URL('../../docs/backend/b5-analysis-measurements.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(results)}\n`);
} finally { await app.close(); await mongo.stop(); }
