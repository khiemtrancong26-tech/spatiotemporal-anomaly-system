/** Full HTTP benchmark. All runtime data lives in a fresh local replica set and temp files. */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { cpus, freemem, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Double, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { createTokens } from '../dist/modules/auth/tokens.js';
import { ensureOnlineIndexes } from '../dist/shared/persistence/indexes.js';
import { buildQuery } from '../dist/modules/query/query.repository.js';
import * as anomalyQueries from '../dist/modules/anomalies/anomalies.repository.js';
import { createCursorCodec, queryFingerprint } from '../dist/shared/pagination.js';

const output = resolve(process.argv[2] ?? '.local/performance.json');
const phases = (process.argv[3] ?? '4,16,40,100,review,mixed').split(',');
if (phases.some(phase => !['4', '16', '40', '100', 'review', 'mixed', 'srs'].includes(phase))) throw new Error('Unknown benchmark phase');
const dir = await mkdtemp(join(tmpdir(), 'pm25-performance-'));
const start = Date.UTC(2026, 0, 1);
const time = hour => new Date(start + hour * 3600_000);
const datasetId = new ObjectId(), ownerId = new ObjectId(), runId = new ObjectId(), otherRun = new ObjectId();
const mapping = { fieldMap: Object.fromEntries(['sensorId', 'latitude', 'longitude', 'timestamp', 'value'].map(key => [key, key])), unit: 'ug/m3' };
const asJson = input => JSON.stringify(input, null, 2) + '\n';
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = p => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
}
function cpuTotals() {
  const times = cpus().map(cpu => cpu.times);
  return [times.reduce((sum, cpu) => sum + cpu.idle, 0), times.reduce((sum, cpu) => sum + Object.values(cpu).reduce((x, y) => x + y, 0), 0)];
}
function indexNames(value, result = new Set()) {
  for (const [key, child] of Object.entries(value ?? {})) {
    if (key === 'indexName' && typeof child === 'string') result.add(child);
    if (child && typeof child === 'object') indexNames(child, result);
  }
  return [...result];
}
function sampleWindowsPython() {
  if (process.platform !== 'win32') return;
  // Count native Python descendants of this benchmark, excluding the Windows venv launchers.
  const command = `
    $ErrorActionPreference = 'Stop'
    while ($true) {
      $all = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'")
      $tree = @(${process.pid})
      do {
        $size = $tree.Count
        $tree += @($all | Where-Object { $_.ParentProcessId -in $tree -and $_.ProcessId -notin $tree } | ForEach-Object ProcessId)
      } until ($tree.Count -eq $size)
      $parents = @($all | ForEach-Object ParentProcessId)
      $sample = @($all | Where-Object { $_.ProcessId -in $tree -and $_.ProcessId -notin $parents } |
        Select-Object ProcessId,WorkingSetSize,UserModeTime,KernelModeTime)
      ConvertTo-Json -InputObject $sample -Compress
      Start-Sleep -Milliseconds 350
    }
  `;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const cpuByPid = new Map();
  const result = { sampledProcesses: 0, peakConcurrent: 0, peakWorkingSetBytes: 0, observedCpuSeconds: 0 };
  let buffer = '';
  child.on('error', error => { result.error = error.code; });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    const lines = (buffer + chunk).split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let processes;
      try { processes = JSON.parse(line); }
      catch { result.error = 'Could not decode a Windows process sample'; continue; }
      result.peakConcurrent = Math.max(result.peakConcurrent, processes.length);
      result.peakWorkingSetBytes = Math.max(result.peakWorkingSetBytes, processes.reduce((bytes, p) => bytes + Number(p.WorkingSetSize), 0));
      for (const p of processes) cpuByPid.set(p.ProcessId, (Number(p.UserModeTime) + Number(p.KernelModeTime)) / 1e7);
    }
  });
  return () => {
    child.kill();
    result.sampledProcesses = cpuByPid.size;
    result.observedCpuSeconds = [...cpuByPid.values()].reduce((seconds, value) => seconds + value, 0);
    return result;
  };
}
let mongo, client, app;
try {
  if (freemem() < 2 * 1024 ** 3) throw new Error('At least 2 GiB available RAM is required to begin');
  const disk = await statfs(dir);
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error('At least 2 GiB free disk space is required to begin');
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' },
    replSet: { count: 1, args: ['--wiredTigerCacheSizeGB', '0.5'] } });
  const secret = randomBytes(48).toString('hex'), name = 'performance_disposable';
  const config = loadConfig({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(IMPORT_|ANALYSIS_|REVIEW_|MONGODB_(?:MAX_|MIN_|WAIT_|CONNECT_|SOCKET_|SERVER_|TRANSACTION_))/.test(key))),
    JWT_SECRET: secret, MONGODB_URI: mongo.getUri(name), IMPORT_STORAGE_DIR: dir, LOG_LEVEL: 'warn',
  });
  client = await new MongoClient(mongo.getUri(name)).connect();
  const db = client.db();
  await ensureOnlineIndexes(db);
  await db.collection('users').insertOne({ _id: ownerId, username: 'Performance fixture', role: 'analyst', isActive: true });
  await db.collection('datasets').insertOne({ _id: datasetId, name: 'Synthetic benchmark', sourceFilename: 'synthetic.csv',
    status: 'imported', createdAt: time(0), createdBy: ownerId });
  const stations = Array.from({ length: 12 }, (_, index) => ({
    _id: new ObjectId(), datasetId, externalId: 'S' + index, name: 'Sensor ' + index, type: 'pm25', unit: 'ug/m3',
    location: { type: 'Point', coordinates: [116.2 + index / 100, 39.9 + index % 3 / 100] },
  }));
  await db.collection('sensors').insertMany(stations);
  await db.collection('analysisRuns').insertMany([runId, otherRun].map(_id => ({ _id, datasetId, createdBy: ownerId,
    status: 'completed', family: 'statistical', method: 'zscore', createdAt: time(0), completedAt: time(0), scope: {}, config: { threshold: 3 } })));
  const reviews = [];
  let boundary;
  for (let offset = 0; offset < 48000; offset += 1000) {
    const rows = Array.from({ length: 1000 }, (_, index) => {
      const i = offset + index, hour = Math.floor(i / stations.length), sensor = stations[i % stations.length];
      return { _id: new ObjectId(), datasetId, sensorId: sensor._id, ts: time(hour),
        location: sensor.location, value: new Double(hour % 71 === 0 ? 350 : 30 + i % 65), unit: 'ug/m3' };
    });
    await db.collection('readings').insertMany(rows);
    if (offset === 36000) boundary = rows[0];
    const anomalies = rows.filter((_, i) => i % 2 === 0).map((row, i) => ({ _id: new ObjectId(), datasetId,
      analysisRunId: (offset / 2 + i) % 10 === 0 ? runId : otherRun, readingId: row._id, sensorId: row.sensorId, ts: row.ts,
      location: row.location, family: 'statistical', method: 'zscore', score: 4, severity: 'high', status: 'open', note: '', version: 1, updatedAt: row.ts }));
    reviews.push(...anomalies.map(row => row._id));
    await db.collection('anomalies').insertMany(anomalies);
  }
  const { filter, options } = buildQuery({ datasetId: String(datasetId), direction: 'asc', limit: 101,
    after: { id: String(boundary._id), key: boundary.ts.toISOString() } }, true);
  const explainFind = async (collection, where, opts) => {
    const explain = await db.collection(collection).find(where, opts).explain('executionStats');
    const { nReturned, totalKeysExamined, totalDocsExamined } = explain.executionStats;
    return { nReturned, totalKeysExamined, totalDocsExamined, indexes: indexNames(explain.queryPlanner.winningPlan) };
  };
  const anomalyPage = [{ $match: { datasetId, analysisRunId: runId, status: 'open' } },
    { $sort: { ts: 1, _id: 1 } }, { $limit: 101 }];
  const anomalyPlan = await db.collection('anomalies').aggregate(anomalyPage).explain('executionStats');
  const anomalyCursor = anomalyPlan.stages?.find(stage => stage.$cursor)?.$cursor ?? anomalyPlan;
  const { nReturned, totalKeysExamined, totalDocsExamined } = anomalyCursor.executionStats;
  const plans = { deepReadings: await explainFind('readings', filter, options),
    sensors: await explainFind('sensors', { datasetId }, { sort: { externalId: 1, _id: 1 }, limit: 101 }),
    datasets: await explainFind('datasets', { createdBy: ownerId, status: 'imported' }, { sort: { createdAt: -1, _id: -1 }, limit: 101 }),
    anomalyPagePrefix: { nReturned, totalKeysExamined, totalDocsExamined, indexes: indexNames(anomalyCursor.queryPlanner.winningPlan) } };
  if (anomalyQueries.buildAnomalyListQuery) {
    const { collection, pipeline } = anomalyQueries.buildAnomalyListQuery({ datasetId: String(datasetId), analysisRunId: String(runId),
      direction: 'asc', status: 'open', limit: 101, actor: { id: String(ownerId), role: 'analyst' } });
    const explain = await db.collection(collection).aggregate(pipeline).explain('executionStats');
    plans.anomalyProductionStages = explain.stages?.map(stage => ({
      stage: Object.keys(stage)[0], from: stage.$lookup?.from, unwind: Boolean(stage.$lookup?.unwinding),
      returned: stage.nReturned, keys: stage.totalKeysExamined, documents: stage.totalDocsExamined, indexes: stage.indexesUsed,
    }));
  }
  const codec = createCursorCodec(config.cursorSecret);
  const cursor = codec.encode({ id: String(boundary._id), key: boundary.ts.toISOString() },
    queryFingerprint('readings.list', { datasetId: String(datasetId), userId: String(ownerId), role: 'analyst' }, 'ts:asc'));
  const token = await createTokens(secret).issue(String(ownerId));
  app = buildApp({ config });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  let pool, checkoutActive = 0;
  const mongoClient = app.mongo.client;
  mongoClient.on('connectionCheckedOut', event => {
    checkoutActive++;
    if (pool) { pool.ms.push(event.durationMS); pool.peak = Math.max(pool.peak, checkoutActive); }
  });
  mongoClient.on('connectionCheckedIn', () => { checkoutActive--; });
  mongoClient.on('connectionCheckOutFailed', event => { if (pool) pool.failures[event.reason] = (pool.failures[event.reason] ?? 0) + 1; });
  const checked = async (path, status, args = {}) => {
    const response = await fetch(url + '/api/v1' + path, { ...args, headers: { authorization: 'Bearer ' + token, ...args.headers },
      signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (response.status !== status) throw new Error(path + ': ' + response.status + ' ' + JSON.stringify(body));
    return body;
  };
  await checked('/readings?datasetId=' + datasetId + '&cursor=' + encodeURIComponent(cursor), 200);
  await checked('/anomalies?datasetId=' + datasetId + '&analysisRunId=' + runId + '&status=open', 200);
  const csv = ['sensorId,latitude,longitude,timestamp,value', ...Array.from({ length: 6000 }, (_, i) =>
    `s${i % 12},39.9,116.2,${time(Math.floor(i / 12)).toISOString()},${20 + i % 91}`)].join('\n');
  const csvPath = join(dir, 'fixture.csv'), fixturePath = join(dir, 'fixture.json');
  await writeFile(csvPath, csv);
  const imports = [];
  if (phases.includes('mixed')) for (let i = 0; i < 6; i++) {
    const form = new FormData();
    form.set('file', new Blob([csv], { type: 'text/csv' }), 'synthetic.csv');
    const uploaded = await checked('/datasets', 201, { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: form });
    const id = uploaded.data.id;
    await checked('/datasets/' + id + '/mapping', 200, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mapping) });
    imports.push(id);
  }
  const reviewIds = [...reviews.slice(0, 2400)];
  const report = { measuredAt: new Date().toISOString(), node: process.version,
    mongo: (await db.command({ buildInfo: 1 })).version, workload: { readings: 48000, anomalies: 24000, stations: 12, csvRows: 6000 },
    hardware: { cpu: cpus()[0].model, logicalCpus: cpus().length, ram: totalmem() },
    config: { analysisConcurrency: config.analysis.concurrency, ...Object.fromEntries(Object.entries(config.imports).filter(([key]) => key !== 'storageDir')),
      mongodb: config.mongodb, review: config.review, mongoTimeoutMs: config.mongodbTimeoutMs, logLevel: config.logLevel },
    plans, phases: {} };
  for (const phase of phases) {
    await sleep(1000);
    const duration = phase === 'srs' ? '10m' : phase === 'mixed' ? '30s' : phase === 'review' ? '15s' : '10s';
    const summary = join(dir, 'k6-summary.json');
    await rm(summary, { force: true });
    const reviewSet = phase === 'mixed' ? reviews.slice(2400, 2880) : reviewIds;
    await writeFile(fixturePath, JSON.stringify({ url, token, dataset: String(datasetId), run: String(runId), cursor,
      detail: String(reviews[0]), reviews: reviewSet.map(String), imports, scopeEnd: time(479).toISOString(), mapping }));
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    const before = await db.command({ serverStatus: 1 });
    const cpuStart = process.cpuUsage();
    const began = performance.now();
    histogram.enable();
    pool = { ms: [], peak: checkoutActive, failures: {} };
    const stopPythonSampler = phase === 'mixed' ? sampleWindowsPython() : undefined;
    const child = spawn('k6', ['run', '--quiet', '--no-color', fileURLToPath(new URL('./performance.k6.js', import.meta.url))],
      { windowsHide: true, stdio: 'inherit', env: { ...process.env, PERF_FIXTURE: fixturePath, PERF_CSV: csvPath,
        PERF_PHASE: phase, PERF_DURATION: duration, PERF_SUMMARY: summary } });
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    let stopped, peakRss = 0, peakMongoRss = 0, peakRunning = 0, peakImports = 0, lowRam = Infinity;
    let previousCpu = cpuTotals(), previousSample = performance.now(), busyMs = 0, maxSystemCpu = 0, nextDbSample = 0;
    const started = new Map();
    const monitor = async () => {
      while (child.exitCode === null && child.signalCode === null) {
        const memory = freemem(), cpu = cpuTotals(), sampledAt = performance.now();
        const cpuTicks = cpu[1] - previousCpu[1];
        if (cpuTicks > 0) {
          const utilization = 1 - (cpu[0] - previousCpu[0]) / cpuTicks;
          maxSystemCpu = Math.max(maxSystemCpu, utilization);
          busyMs = utilization >= .98 ? busyMs + sampledAt - previousSample : 0;
          previousCpu = cpu;
          previousSample = sampledAt;
        }
        lowRam = Math.min(lowRam, memory);
        peakRss = Math.max(peakRss, process.memoryUsage.rss());
        if (performance.now() >= nextDbSample) {
          const status = await db.command({ serverStatus: 1 }, { timeoutMS: 2000 });
          peakMongoRss = Math.max(peakMongoRss, status.mem.resident);
          nextDbSample = performance.now() + 1500;
        }
        if (phase === 'mixed') {
          const running = await db.collection('analysisRuns').find({ status: 'running' }, { projection: { _id: 1 } }).toArray();
          for (const run of running) if (!started.has(String(run._id))) started.set(String(run._id), Date.now());
          peakRunning = Math.max(peakRunning, running.length);
          peakImports = Math.max(peakImports, await db.collection('datasets').countDocuments({ status: 'importing' }));
        }
        stopped = memory < 1.5 * 1024 ** 3 ? 'available RAM below 1.5 GiB' : busyMs >= 30_000 ? 'system CPU above 98% for 30s' : undefined;
        if (stopped) { child.kill(); return; }
        await sleep(500);
      }
    };
    console.log('Running ' + phase + ' (' + duration + ')');
    const deadline = setTimeout(() => { stopped = 'absolute deadline'; child.kill(); }, phase === 'srs' ? 625_000 : 46_000);
    let code, python;
    try {
      [code] = await Promise.all([done, monitor()]);
    } finally { child.kill(); python = stopPythonSampler?.(); clearTimeout(deadline); histogram.disable(); }
    const elapsedMs = performance.now() - began;
    const cpu = process.cpuUsage(cpuStart), after = await db.command({ serverStatus: 1 });
    const jobs = phase === 'mixed' ? await db.collection('analysisRuns').find({ _id: { $nin: [runId, otherRun] } }).toArray() : [];
    const k6 = code === 0 || code === 99 ? JSON.parse(await readFile(summary, 'utf8')) : null;
    report.phases[phase] = { duration, elapsedMs, k6Exit: code, stopped, metrics: k6?.metrics,
      maxSystemCpu, lowRam, peakNodeRssBytes: peakRss, peakMongoRssMiB: peakMongoRss,
      nodeCpuCorePercent: (cpu.user + cpu.system) / elapsedMs / 10,
      eventLoopMs: { p95: histogram.percentile(95) / 1e6, p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6 },
      mongoCheckoutMs: stats(pool.ms), peakCheckedOut: pool.peak, checkoutFailures: pool.failures,
      writeConflicts: after.metrics.operation.writeConflicts - before.metrics.operation.writeConflicts,
      transactions: { committed: after.transactions.totalCommitted - before.transactions.totalCommitted,
        aborted: after.transactions.totalAborted - before.transactions.totalAborted },
      peakRunning, peakImports, python, jobs: jobs.map(job => ({ method: job.method, status: job.status, error: job.error?.code,
        waitUpperBoundMs: started.has(String(job._id)) ? started.get(String(job._id)) - job.createdAt.getTime() : undefined,
        completionMs: job.completedAt ? job.completedAt.getTime() - job.createdAt.getTime() : undefined })) };
    pool = undefined;
    await writeFile(output, asJson(report));
    if (code !== 0) throw new Error('k6 exited ' + code + (stopped ? ' (' + stopped + ')' : ''));
  }
} finally {
  const closes = await Promise.allSettled([app?.close(), client?.close()]);
  try { await mongo?.stop(); } finally { await rm(dir, { recursive: true, force: true }); }
  for (const close of closes) if (close.status === 'rejected') {
    console.error('Benchmark cleanup failed', close.reason);
    process.exitCode = 1;
  }
}
