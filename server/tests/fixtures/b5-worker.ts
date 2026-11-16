// Test-only child process. Double flags every row to exercise multi-batch recovery.
import { buildApp } from '../../src/app.js';
import { loadTestConfig } from '../helpers.js';
import type { AnalysisEngine } from '../../src/modules/analysis/analysis.types.js';

const double: AnalysisEngine = {
  metadata: () => ({ engineVersion: 'simple-statistics@8.0.0' }), ready: async () => {},
  run: async (_guard, readings) => ({ engineVersion: 'simple-statistics@8.0.0',
    candidates: readings.map(({ id, ...reading }) => ({ ...reading, readingId: id, score: 1 })) }),
};
const pause = async (event: string) => { process.send?.({ event }); await new Promise<void>(() => {}); };
const mode = process.env.B5_CRASH_MODE;
const app = buildApp({ config: loadTestConfig({ ...process.env, LOG_LEVEL: 'silent' }), logger: false,
  analysisWorkerEnabled: mode !== 'queued',
  ...(mode === 'batch' ? { analysisTestEngine: double } : {}),
  analysisTestHooks: mode === 'queued' ? { afterAccepted: () => pause('queued') } : { afterBatch: () => pause('batch') },
});
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.send?.({ event: 'ready', url });
