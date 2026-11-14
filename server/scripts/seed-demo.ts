import { MongoClient } from 'mongodb';
import { loadConfig } from '../src/config.js';
import { seedDemo } from '../src/dev/seed-demo.js';

async function main() {
  const config = loadConfig();
  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: config.mongodbTimeoutMs });
  try {
    await client.connect();
    await seedDemo(config.mongodbDatabase ? client.db(config.mongodbDatabase) : client.db(), process.env);
    process.stdout.write('Demo accounts prepared. Existing passwords/roles were not changed; optional data is labeled [SEED B2].\n');
  } finally { await client.close(); }
}
main().catch(() => {
  process.stderr.write('Demo seed failed. Check SEED_* configuration, database connectivity and existing accounts.\n');
  process.exitCode = 1;
});
