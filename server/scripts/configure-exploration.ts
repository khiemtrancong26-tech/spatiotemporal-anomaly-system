import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { loadConfig } from '../src/config.js';
import { configureExplorationMetadata } from '../src/modules/exploration/exploration.metadata.js';
async function main() {
  const [id, file, ...extra] = process.argv.slice(2);
  if (!id || !file || extra.length) throw new Error('Usage: npm run db:exploration --workspace @pm25/server -- DATASET_ID METADATA_JSON_PATH');
  const config = loadConfig(), input: unknown = JSON.parse(await readFile(file, 'utf8'));
  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: config.mongodbTimeoutMs });
  try {
    await client.connect();
    const metadata = await configureExplorationMetadata(config.mongodbDatabase ? client.db(config.mongodbDatabase) : client.db(), id, input);
    process.stdout.write(JSON.stringify({ datasetId: id, metadata }) + '\n');
  } finally { await client.close(); }
}
main().catch(error => { process.stderr.write(error instanceof Error ? error.message + '\n' : 'Metadata configuration failed\n'); process.exitCode = 1; });
