/** Process-crash fixture with the real model, never an injected detector. */
import { buildApp } from '../../src/app.js';
import { loadTestConfig } from '../helpers.js';
const app = buildApp({ config: loadTestConfig({ ...process.env, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' }), logger: false,
  analysisTestHooks: { afterBatch: async () => { process.send?.({ event: 'batch' }); await new Promise<void>(() => {}); } } });
await app.listen({ host: '127.0.0.1', port: 0 }); process.send?.({ event: 'ready' });
