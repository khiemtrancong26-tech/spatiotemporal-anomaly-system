import type { Db, IndexDescription } from 'mongodb';

// Online subset of infra/mongo/indexes.js; integration tests guard against drift.
// B3 adds the D012 online receipt collection; offline processedMutations remains separate.
export const onlineIndexes: Record<string, IndexDescription[]> = {
  users: [{ key: { usernameNormalized: 1 }, unique: true, name: 'uq_users_username_normalized' }],
  datasets: [{ key: { status: 1, createdAt: -1, _id: -1 }, name: 'ix_datasets_status_created' }],
  sensors: [
    { key: { datasetId: 1, externalId: 1 }, unique: true, name: 'uq_sensors_dataset_external' },
    { key: { datasetId: 1, location: '2dsphere' }, name: 'ix_sensors_dataset_geo' },
  ],
  readings: [
    { key: { datasetId: 1, sensorId: 1, ts: 1 }, unique: true, name: 'uq_readings_dataset_sensor_ts' },
    { key: { datasetId: 1, ts: 1, _id: 1 }, name: 'ix_readings_dataset_ts_id' },
    { key: { datasetId: 1, location: '2dsphere' }, name: 'ix_readings_dataset_geo' },
  ],
  analysisRuns: [{ key: { datasetId: 1, createdAt: -1, _id: -1 }, name: 'ix_runs_dataset_created' }],
  anomalies: [
    { key: { analysisRunId: 1, readingId: 1 }, unique: true, name: 'uq_anomalies_run_reading' },
    { key: { datasetId: 1, ts: 1, _id: 1 }, name: 'ix_anomalies_dataset_ts_id' },
    { key: { datasetId: 1, status: 1, ts: 1 }, name: 'ix_anomalies_dataset_status_ts' },
  ],
  idempotencyReceipts: [
    { key: { userId: 1, key: 1 }, unique: true, name: 'uq_idempotency_user_key' },
    { key: { status: 1, leaseUntil: 1 }, name: 'ix_idempotency_recovery' },
  ],
};

export async function ensureOnlineIndexes(db: Db): Promise<void> {
  for (const [collection, indexes] of Object.entries(onlineIndexes)) await db.collection(collection).createIndexes(indexes);
}
