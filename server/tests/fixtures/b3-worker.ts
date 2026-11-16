// Test-only child process: simulate an abrupt crash after an actual batch commit.
import { buildApp } from '../../src/app.js';
import { loadTestConfig } from '../helpers.js';
const app = buildApp({ logger: false, config: loadTestConfig({ ...process.env, IMPORT_BATCH_SIZE: '2', LOG_LEVEL: 'silent' }),
  importTestHooks: { afterBatch: async () => { process.send?.({ event: 'batch' }); await new Promise<void>(() => {}); } },
});
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.send?.({ event: 'ready', url });
