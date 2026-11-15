import { MongoClient } from 'mongodb';
import { loadConfig } from '../src/config.js';
import { ensureOnlineIndexes } from '../src/shared/persistence/indexes.js';

async function main() {
  const config = loadConfig();
  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: config.mongodbTimeoutMs });
  try {
    await client.connect();
    await ensureOnlineIndexes(config.mongodbDatabase ? client.db(config.mongodbDatabase) : client.db());
    process.stdout.write('Online indexes verified. No data or offline receipts were deleted.\n');
  } finally { await client.close(); }
}
main().catch(() => {
  process.stderr.write('Index setup failed. Check database connectivity, permissions and existing duplicates.\n');
  process.exitCode = 1;
});
