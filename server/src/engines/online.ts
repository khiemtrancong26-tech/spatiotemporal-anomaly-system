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
import manifest from '../../ml/pm25-manifest.json' with { type: 'json' };
import v2Manifest from '../../ml/pm25-v2-manifest.json' with { type: 'json' };
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
  // Two pinned local models, not a registry service. Existing native adapter/protocol is unchanged.
  const models = {
    v1: { manifest, artifactPath: config.artifactPath, manifestPath: config.manifestPath, policyId: ANALYSIS_POLICY_ID },
    v2: { manifest: v2Manifest, artifactPath: config.v2ArtifactPath, manifestPath: config.v2ManifestPath, policyId: PM25_V2_POLICY.id },
  };
  const adapters = { v1: makeAdapter(models.v1), v2: makeAdapter(models.v2) };
  const nativeCapacity = createCapacity(config.concurrency);
  async function invoke(version: 'v1' | 'v2', ...args: Parameters<typeof adapters.v1>) {
    // Preserve the old process-wide native limit across both models/probes.
    // Waiting is abortable and bounded by the existing attempt timeout, never extra parallelism.
    const deadline = AbortSignal.timeout(config.timeoutMs), outer = args[3], signal = outer ? AbortSignal.any([outer, deadline]) : deadline;
    let release = nativeCapacity.acquire();
    while (!release) {
      try { await delay(25, undefined, { signal }); }
      catch { throw new EngineError(outer?.aborted ? 'ENGINE_ABORTED' : 'ENGINE_TIMEOUT', 'Native capacity wait stopped.'); }
      release = nativeCapacity.acquire();
    }
    try { return await adapters[version](args[0], args[1], args[2], signal); } finally { release(); }
  }
  function makeAdapter(model: typeof models[keyof typeof models]) {
    return createIsolationForestAdapter({ ...config, artifactPath: model.artifactPath, manifestPath: model.manifestPath,
      modelId: model.manifest.id, artifactSha256: model.manifest.sha256, sklearnVersion: model.manifest.sklearnVersion, features: model.manifest.features,
      maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxConcurrent: config.concurrency });
  }
  const probes: Partial<Record<'v1' | 'v2', Promise<unknown>>> = {};
  return {
    metadata: (family, version = 'v1') => {
      const model = models[version];
      return family === 'statistical' ? { engineVersion: STATISTICS_ENGINE_VERSION }
        : { engineVersion: `scikit-learn@${model.manifest.sklearnVersion}`, modelVersion: model.manifest.id, modelHash: model.manifest.sha256,
          ...(version === 'v2' ? { policyId: model.policyId } : {}) };
    },
    async ready(version = 'v1') {
      const model = models[version], expected = model.manifest;
      try {
        if (version === 'v2' && !config.v2Enabled) throw new Error();
        if (!(await stat(config.pythonExecutable)).isFile() || !(await stat(config.scriptPath)).isFile()) throw new Error();
        const configured = JSON.parse(await readFile(model.manifestPath, 'utf8'));
        if (JSON.stringify(configured) !== JSON.stringify(expected) || (await stat(model.artifactPath)).size !== expected.bytes ||
            createHash('sha256').update(await readFile(model.artifactPath)).digest('hex') !== expected.sha256) throw new Error();
        if (version === 'v2' && (v2Manifest.policyId !== PM25_V2_POLICY.id || v2Manifest.featurePolicySha256 !== createHash('sha256').update(JSON.stringify(PM25_V2_POLICY)).digest('hex'))) throw new Error();
        const reading: Reading = { id: 'readiness', datasetId: 'readiness', sensorId: 'readiness', ts: '2026-01-01T00:00:00.000Z', value: 50, unit: 'ug/m3', location: { type: 'Point', coordinates: [0, 0] } };
        // Retain the existing coalesced readiness probe, independently per version.
        probes[version] ??= invoke(version, [reading], [{ readingId: reading.id, values: version === 'v1' ? [50] : [50, 0, 0] }],
          { id: model.policyId, score: point => -point.decisionFunction }).catch(error => { delete probes[version]; throw error; });
        await probes[version];
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
      const version = guard.run.modelVersion === manifest.id ? 'v1' : guard.run.modelVersion === v2Manifest.id ? 'v2' : undefined;
      if (!version || guard.modelHash !== models[version].manifest.sha256) throw new EngineError('MODEL_VERSION_UNAVAILABLE', 'Run model version/hash is unavailable.');
      const model = models[version];
      if (guard.policyId !== model.policyId) throw new EngineError('POLICY_VERSION_UNAVAILABLE', 'Run feature policy is unavailable.');
      if (version === 'v2' && v2Manifest.featurePolicySha256 !== createHash('sha256').update(JSON.stringify(PM25_V2_POLICY)).digest('hex')) throw new EngineError('POLICY_VERSION_UNAVAILABLE', 'Pinned feature policy does not match this build.');
      let selected = readings, rows = readings.map(r => ({ readingId: r.id, values: [r.value] }));
      let scoringSummary;
      if (version === 'v2') {
        if (!context) throw new EngineError('ENGINE_INPUT_INVALID', 'Explicit v2 context is required.');
        let built;
        try { built = buildPm25Features(guard.run.datasetId, readings, context.readings, context.sensors); }
        catch { throw new EngineError('ENGINE_INPUT_INVALID', 'Invalid v2 feature inputs.'); }
        if (!built.rows.length) throw new EngineError('INSUFFICIENT_CONTEXT', 'No target has complete v2 features.');
        const ids = new Set(built.scorable.map(r => r.id)); selected = readings.filter(r => ids.has(r.id)); rows = built.rows; scoringSummary = built.summary;
      }
      const result = await invoke(version, selected, rows, { id: model.policyId, score: point => -point.decisionFunction }, signal);
      return { candidates: result.candidates, engineVersion: result.engineVersion, modelVersion: result.modelId,
        ...(scoringSummary ? { scoringSummary, scoredReadingIds: selected.map(r => r.id) } : {}) };
    },
  };
}
