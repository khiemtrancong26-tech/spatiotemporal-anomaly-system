import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const app = buildApp({ config });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await app.close(); } catch { process.exitCode = 1; }
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch {
    await stop();
    process.exitCode = 1;
    process.stderr.write('Server startup failed. Check configuration and port availability.\n');
  }
}

main().catch(() => {
  process.stderr.write('Server configuration is invalid. Check environment variables.\n');
  process.exitCode = 1;
});
