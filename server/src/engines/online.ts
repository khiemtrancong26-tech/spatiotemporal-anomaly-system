import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import type { Reading, StatisticalDetectorInput } from '@pm25/shared-core/contracts';
import { STATISTICS_ENGINE_VERSION } from '@pm25/shared-core/statistics';
import type { AnalysisConfig } from '../config.js';
import type { AnalysisEngine } from '../modules/analysis/analysis.types.js';
import { createIsolationForestAdapter } from './isolation-forest.js';
import { EngineError } from './python-runner.js';
import { ANALYSIS_POLICY_ID } from './statistical.policy.js';
import manifest from '../../ml/pm25-v2-manifest.json' with { type: 'json' };
import { buildPm25Features, PM25_V2_POLICY } from '@pm25/shared-core';
import { createCapacity } from '../shared/import-capacity.js';

function statistics(input: StatisticalDetectorInput, signal: AbortSignal) {
  return new Promise<Awaited<ReturnType<typeof import('./statistical.js')['runStatisticalAdapter']>>>((resolve, reject) => {
    if (signal.aborted) { reject(new EngineError('ENGINE_ABORTED', 'Engine aborted.')); return; }
    const source = import.meta.url.endsWith('.ts');
    const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']
      .flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
    const worker = new Worker(new URL(source ? './statistical.worker.ts' : './statistical.worker.js', import.meta.url), {
      workerData: input, env: { ...environment, TSX_DISABLE_CACHE: '1' }, execArgv: source ? ['--import', 'tsx'] : [],
    });
    let message: unknown, failure: Error | undefined;
    const abort = () => { failure = new EngineError('ENGINE_ABORTED', 'Engine aborted.'); void worker.terminate(); };
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', result => { message = result; });
    worker.once('error', () => { failure = new EngineError('ENGINE_UNAVAILABLE', 'Statistical worker unavailable.'); });
    worker.once('exit', code => {
      signal.removeEventListener('abort', abort);
      if (failure) { reject(failure); return; }
      if (code !== 0 || !message || typeof message !== 'object' || !('output' in message) || !('candidates' in message)) {
        reject(new EngineError('ENGINE_OUTPUT_INVALID', 'Statistical worker returned invalid output.')); return;
      }
      resolve(message as Awaited<ReturnType<typeof import('./statistical.js')['runStatisticalAdapter']>>);
    });
  });
}

export function createOnlineEngine(config: AnalysisConfig): AnalysisEngine {
  const policyId = PM25_V2_POLICY.id;
  const adapter = createIsolationForestAdapter({ ...config, modelId: manifest.id, artifactSha256: manifest.sha256,
    sklearnVersion: manifest.sklearnVersion, features: manifest.features,
    maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxConcurrent: config.concurrency });
  const nativeCapacity = createCapacity(config.concurrency);
  async function invoke(...args: Parameters<typeof adapter>) {
    // Keep readiness and inference within the existing native capacity and timeout.
    const deadline = AbortSignal.timeout(config.timeoutMs), outer = args[3], signal = outer ? AbortSignal.any([outer, deadline]) : deadline;
    let release = nativeCapacity.acquire();
    while (!release) {
      try { await delay(25, undefined, { signal }); }
      catch { throw new EngineError(outer?.aborted ? 'ENGINE_ABORTED' : 'ENGINE_TIMEOUT', 'Native capacity wait stopped.'); }
      release = nativeCapacity.acquire();
    }
    try { return await adapter(args[0], args[1], args[2], signal); } finally { release(); }
  }
  const policyMatches = () => manifest.policyId === policyId &&
    manifest.featurePolicySha256 === createHash('sha256').update(JSON.stringify(PM25_V2_POLICY)).digest('hex');
  let probe: Promise<unknown> | undefined;
  return {
    metadata: family => family === 'statistical' ? { engineVersion: STATISTICS_ENGINE_VERSION }
      : { engineVersion: `scikit-learn@${manifest.sklearnVersion}`, modelVersion: manifest.id, modelHash: manifest.sha256, policyId },
    async ready() {
      try {
        if (!(await stat(config.pythonExecutable)).isFile() || !(await stat(config.scriptPath)).isFile()) throw new Error();
        const configured = JSON.parse(await readFile(config.manifestPath, 'utf8'));
        if (JSON.stringify(configured) !== JSON.stringify(manifest) || (await stat(config.artifactPath)).size !== manifest.bytes ||
            createHash('sha256').update(await readFile(config.artifactPath)).digest('hex') !== manifest.sha256 || !policyMatches()) throw new Error();
        const reading: Reading = { id: 'readiness', datasetId: 'readiness', sensorId: 'readiness', ts: '2026-01-01T00:00:00.000Z', value: 50, unit: 'ug/m3', location: { type: 'Point', coordinates: [0, 0] } };
        probe ??= invoke([reading], [{ readingId: reading.id, values: [50, 0, 0] }],
          { id: policyId, score: point => -point.decisionFunction }).catch(error => { probe = undefined; throw error; });
        await probe;
      } catch { throw new EngineError('MODEL_UNAVAILABLE', 'The configured PM2.5 model is not ready.'); }
    },
    async run(guard, readings, signal, context) {
      if (!readings.length) throw new EngineError('INSUFFICIENT_DATA', 'No readings in the accepted scope.');
      if (guard.run.family === 'statistical') {
        if (guard.policyId !== ANALYSIS_POLICY_ID) throw new EngineError('POLICY_VERSION_UNAVAILABLE', 'Run policy is unavailable in this worker build.');
        if (guard.run.engineVersion !== STATISTICS_ENGINE_VERSION) throw new EngineError('ENGINE_VERSION_UNAVAILABLE', 'Run engine version is unavailable.');
        const result = await statistics({ method: guard.run.method as StatisticalDetectorInput['method'],
          config: guard.run.config, readings }, signal);
        if (result.output.status !== 'completed') throw new EngineError(result.output.status === 'insufficient_data' ? 'INSUFFICIENT_DATA' : 'ENGINE_INPUT_INVALID', 'Statistical scope could not be evaluated under the approved policy.');
        return { candidates: result.candidates, engineVersion: result.engineVersion };
      }
      if (guard.run.modelVersion !== manifest.id || guard.modelHash !== manifest.sha256) throw new EngineError('MODEL_VERSION_UNAVAILABLE', 'Run model identity does not match the configured model.');
      if (guard.policyId !== policyId || !policyMatches()) throw new EngineError('POLICY_VERSION_UNAVAILABLE', 'Pinned feature policy does not match this build.');
      if (!context) throw new EngineError('ENGINE_INPUT_INVALID', 'Explicit PM2.5 context is required.');
      let built;
      try { built = buildPm25Features(guard.run.datasetId, readings, context.readings, context.sensors); }
      catch { throw new EngineError('ENGINE_INPUT_INVALID', 'Invalid PM2.5 feature inputs.'); }
      if (!built.rows.length) throw new EngineError('INSUFFICIENT_CONTEXT', 'No target has complete features.');
      const ids = new Set(built.scorable.map(r => r.id)), selected = readings.filter(r => ids.has(r.id));
      const result = await invoke(selected, built.rows, { id: policyId, score: point => -point.decisionFunction }, signal);
      return { candidates: result.candidates, engineVersion: result.engineVersion, modelVersion: result.modelId,
        scoringSummary: built.summary, scoredReadingIds: selected.map(r => r.id) };
    },
  };
}
