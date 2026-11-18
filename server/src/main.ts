import { writeSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { errorDiagnostics } from './shared/error-diagnostics.js';

function logFailure(level: 'error' | 'fatal', event: string, error: unknown) {
  writeSync(2, JSON.stringify({ level, event, ...errorDiagnostics(error) }) + '\n');
}

function fatal(event: 'uncaught_exception' | 'unhandled_rejection', error: unknown): never {
  try { logFailure('fatal', event, error); }
  finally { process.exit(1); }
}
process.once('uncaughtException', (error, origin) => fatal(origin === 'unhandledRejection' ? 'unhandled_rejection' : 'uncaught_exception', error));
process.once('unhandledRejection', (error: unknown) => fatal('unhandled_rejection', error));

async function main() {
  const config = loadConfig();
  const app = buildApp({ config });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
  };
  const shutdownFailed = (error: unknown) => {
    process.exitCode = 1;
    logFailure('error', 'shutdown_failed', error);
  };
  const shutdown = () => { stop().catch(shutdownFailed); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await stop().catch(shutdownFailed);
    throw error;
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  logFailure('error', 'startup_failed', error);
});
