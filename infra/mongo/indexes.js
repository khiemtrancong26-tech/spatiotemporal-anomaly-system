// MongoDB indexes — proposal for SDD v0.3 (not automatically executed).
// mongosh '<MONGODB_URI>/<DB_NAME>' infra/mongo/indexes.js
// Ensure the correct DB is selected; requires db role with createIndex rights.
// For sync multi-document transactions deploy MongoDB in replica-set mode.
// Unique indexes will FAIL on pre-existing duplicates: inspect/clean data first.

const indexes = [
  ['users', { usernameNormalized: 1 }, { unique: true, name: 'uq_users_username_normalized' }],
  ['datasets', { status: 1, createdAt: -1, _id: -1 }, { name: 'ix_datasets_status_created' }],
  ['sensors', { datasetId: 1, externalId: 1 }, { unique: true, name: 'uq_sensors_dataset_external' }],
  ['sensors', { datasetId: 1, location: '2dsphere' }, { name: 'ix_sensors_dataset_geo' }],
  ['readings', { datasetId: 1, sensorId: 1, ts: 1 }, { unique: true, name: 'uq_readings_dataset_sensor_ts' }],
  ['readings', { datasetId: 1, ts: 1, _id: 1 }, { name: 'ix_readings_dataset_ts_id' }],
  ['readings', { datasetId: 1, location: '2dsphere' }, { name: 'ix_readings_dataset_geo' }],
  ['analysisRuns', { datasetId: 1, createdAt: -1, _id: -1 }, { name: 'ix_runs_dataset_created' }],
  ['anomalies', { analysisRunId: 1, readingId: 1 }, { unique: true, name: 'uq_anomalies_run_reading' }],
  ['anomalies', { datasetId: 1, ts: 1, _id: 1 }, { name: 'ix_anomalies_dataset_ts_id' }],
  ['anomalies', { updatedAt: 1, _id: 1 }, { name: 'ix_anomalies_sync_updated' }],
  ['anomalies', { datasetId: 1, status: 1, ts: 1 }, { name: 'ix_anomalies_dataset_status_ts' }],
  ['processedMutations', { clientMutationId: 1 }, { unique: true, name: 'uq_mutations_client_id' }],
];

for (const [collection, keys, options] of indexes) {
  print(`${collection} -> ${options.name}`);
  db.getCollection(collection).createIndex(keys, options);
}
print('MongoDB proposed indexes created; run explain() with representative queries.');
