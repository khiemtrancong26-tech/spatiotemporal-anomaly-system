import type { Db, MongoClient } from 'mongodb';

export interface HealthRepository { ping: () => Promise<boolean> }
export function createHealthRepository(client: MongoClient, db: Db, timeoutMs: number): HealthRepository {
  return { ping: async () => {
    // Failed initial connect can leave a closed topology. Explicit connect retries that case;
    // on healthy clients it reuses the existing pool (no new client/connection per request).
    await client.connect();
    return (await db.command({ ping: 1, maxTimeMS: timeoutMs })).ok === 1;
  } };
}
