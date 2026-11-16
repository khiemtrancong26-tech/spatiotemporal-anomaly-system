import fp from 'fastify-plugin';
import { MongoClient, type Db } from 'mongodb';
import type { ServerConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    mongo: { client: MongoClient; db: Db; timeoutMs: number };
  }
}

export const mongoPlugin = fp<{ config: ServerConfig }>(async (app, { config }) => {
  const client = new MongoClient(config.mongodbUri, {
    appName: 'pm25-server',
    serverSelectionTimeoutMS: config.mongodbTimeoutMs,
    connectTimeoutMS: config.mongodbTimeoutMs,
    waitQueueTimeoutMS: config.mongodbTimeoutMs,
    socketTimeoutMS: config.mongodbTimeoutMs,
  });
  const db = config.mongodbDatabase ? client.db(config.mongodbDatabase) : client.db();
  app.decorate('mongo', { client, db, timeoutMs: config.mongodbTimeoutMs });
  app.addHook('onClose', async () => { await client.close(); });
  app.addHook('onReady', async () => {
    try {
      await client.connect();
    } catch {
      // Keep readiness reachable as 503 and let the driver reconnect after MongoDB recovers.
      app.log.warn({ event: 'mongodb_unavailable' }, 'MongoDB is unavailable');
    }
  });
}, { name: 'mongo' });
