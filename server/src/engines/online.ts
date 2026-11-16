import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import type { Reading, StatisticalDetectorInput } from '@pm25/shared-core/contracts';
import { STATISTICS_ENGINE_VERSION } from '@pm25/shared-core/statistics';
import type { AnalysisConfig } from '../config.js';
import type { AnalysisEngine } from '../modules/analysis/analysis.types.js';
import { createIsolationForestAdapter } from './isolation-forest.js';
import { EngineError } from './python-runner.js';
import { ANALYSIS_POLICY_ID } from './statistical.policy.js';
import manifest from '../../ml/pm25-manifest.json' with { type: 'json' };

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
  const adapter = createIsolationForestAdapter({ ...config, scriptPath: config.scriptPath,
    modelId: manifest.id, artifactSha256: manifest.sha256, sklearnVersion: manifest.sklearnVersion, features: manifest.features,
    maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxConcurrent: config.concurrency });
  async function infer(readings: Reading[], signal?: AbortSignal) {
    return adapter(readings, readings.map(reading => ({ readingId: reading.id, values: [reading.value] })),
      { id: ANALYSIS_POLICY_ID, score: point => -point.decisionFunction }, signal);
  }
  let probe: Promise<unknown> | undefined;
  return {
    metadata: family => family === 'statistical' ? { engineVersion: STATISTICS_ENGINE_VERSION }
      : { engineVersion: `scikit-learn@${manifest.sklearnVersion}`, modelVersion: manifest.id, modelHash: manifest.sha256 },
    async ready() {
      // Validate the operator's manifest against the version pinned in this build.
      // Hash verification precedes pickle loading in both this probe and inference.
      try {
        if (!(await stat(config.pythonExecutable)).isFile() || !(await stat(config.scriptPath)).isFile()) throw new Error();
        const configured = JSON.parse(await readFile(config.manifestPath, 'utf8'));
        if (JSON.stringify(configured) !== JSON.stringify(manifest) || (await stat(config.artifactPath)).size !== manifest.bytes ||
            createHash('sha256').update(await readFile(config.artifactPath)).digest('hex') !== manifest.sha256) throw new Error();
        // Coalesce the initial native runtime probe. File integrity is checked on
        // every admission; active ML jobs must not make readiness report BUSY.
        probe ??= infer([{ id: 'readiness', datasetId: 'readiness', sensorId: 'readiness', ts: '2026-01-01T00:00:00.000Z',
          value: 50, unit: 'ug/m3', location: { type: 'Point', coordinates: [0, 0] } }]).catch(error => { probe = undefined; throw error; });
        await probe;
      } catch { throw new EngineError('MODEL_UNAVAILABLE', 'The configured PM2.5 model is not ready.'); }
    },
    async run(guard, readings, signal) {
      if (guard.policyId !== ANALYSIS_POLICY_ID) throw new EngineError('POLICY_VERSION_UNAVAILABLE', 'Run policy is unavailable in this worker build.');
      if (!readings.length) throw new EngineError('INSUFFICIENT_DATA', 'No readings in the accepted scope.');
      if (guard.run.family === 'statistical') {
        if (guard.run.engineVersion !== STATISTICS_ENGINE_VERSION) throw new EngineError('ENGINE_VERSION_UNAVAILABLE', 'Run engine version is unavailable.');
        const result = await statistics({ method: guard.run.method as StatisticalDetectorInput['method'],
          config: guard.run.config, readings }, signal);
        if (result.output.status !== 'completed') throw new EngineError(result.output.status === 'insufficient_data' ? 'INSUFFICIENT_DATA' : 'ENGINE_INPUT_INVALID', 'Statistical scope could not be evaluated under the approved policy.');
        return { candidates: result.candidates, engineVersion: result.engineVersion };
      }
      if (guard.run.modelVersion !== manifest.id || guard.modelHash !== manifest.sha256) throw new EngineError('MODEL_VERSION_UNAVAILABLE', 'Run model version is unavailable.');
      const result = await infer(readings, signal);
      return { candidates: result.candidates, engineVersion: result.engineVersion, modelVersion: result.modelId };
    },
  };
}
