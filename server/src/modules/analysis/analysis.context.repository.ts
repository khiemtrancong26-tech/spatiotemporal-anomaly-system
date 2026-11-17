import type { Db } from 'mongodb';
import { PM25_V2_POLICY, selectPm25Neighbors, type FeaturePoint, type FeatureSensor } from '@pm25/shared-core';
import type { Reading } from '@pm25/shared-core/contracts';
import { EngineError } from '../../engines/python-runner.js';
import { toObjectId, toPublicId, toGeoPoint } from '../../shared/persistence/mapping.js';
import type { RunGuard } from './analysis.types.js';

export interface FeatureContext { sensors: FeatureSensor[]; readings: FeaturePoint[] }
export const CONTEXT_GUARDS = { maxReadings: 200000, maxSensors: 128, maxBytes: 16 * 1024 * 1024 } as const;
export function createAnalysisContextReader(db: Db, timeoutMs: number) {
  return async (guard: RunGuard, targets: readonly Reading[], signal: AbortSignal): Promise<FeatureContext> => {
    if (!targets.length) return { sensors: [], readings: [] };
    const datasetId = guard.run.datasetId, dataset = toObjectId(datasetId);
    const options = { signal, readPreference: 'primary' as const, maxTimeMS: timeoutMs };
    const parent = await db.collection('datasets').findOne({ _id: dataset, status: 'imported' }, { ...options, projection: { _id: 1 } });
    if (!parent) throw new EngineError('ENGINE_INPUT_INVALID', 'Context dataset is unavailable.');
    const documents = await db.collection('sensors').find({ datasetId: dataset }, { ...options,
      projection: { _id: 1, datasetId: 1, externalId: 1, location: 1 }, limit: 10001 }).toArray();
    if (documents.length > 10000) throw new EngineError('CONTEXT_LIMIT_EXCEEDED', 'Station metadata exceeds the import limit.');
    const sensors: FeatureSensor[] = documents.map(s => ({ id: toPublicId(s._id), datasetId, externalId: String(s.externalId), location: { type: 'Point', coordinates: toGeoPoint(s.location.coordinates).coordinates } }));
    const targetSensors = [...new Set(targets.map(r => r.sensorId))];
    if (targetSensors.length > CONTEXT_GUARDS.maxSensors) throw new EngineError('CONTEXT_LIMIT_EXCEEDED', 'Too many stations for context.');
    const graph = selectPm25Neighbors(datasetId, targetSensors, sensors), ids = new Set(targetSensors);
    for (const neighbors of graph.values()) for (const id of neighbors) ids.add(id);
    if (ids.size > CONTEXT_GUARDS.maxSensors) throw new EngineError('CONTEXT_LIMIT_EXCEEDED', 'Context station guard exceeded.');
    const times = targets.map(t => Date.parse(t.ts)), from = Math.min(...times) - PM25_V2_POLICY.temporalMaxGapMs, to = Math.max(...times);
    const cursor = db.collection('readings').find({ datasetId: dataset, sensorId: { $in: [...ids].map(toObjectId) },
      _id: { $nin: targets.map(t => toObjectId(t.id)) }, ts: { $gte: new Date(from), $lte: new Date(to) },
    }, { ...options, projection: { _id: 1, sensorId: 1, ts: 1, value: 1 }, limit: CONTEXT_GUARDS.maxReadings + 1 });
    const readings: FeaturePoint[] = []; let bytes = Buffer.byteLength(JSON.stringify(sensors));
    if (bytes > CONTEXT_GUARDS.maxBytes) throw new EngineError('CONTEXT_LIMIT_EXCEEDED', 'Context byte guard exceeded.');
    try { for await (const p of cursor) {
      if (signal.aborted) throw new EngineError('ENGINE_ABORTED', 'Context acquisition stopped.');
      const point = { id: toPublicId(p._id), datasetId, sensorId: toPublicId(p.sensorId), ts: p.ts.toISOString(), value: Number(p.value) };
      bytes += Buffer.byteLength(JSON.stringify(point));
      if (readings.length === CONTEXT_GUARDS.maxReadings || bytes > CONTEXT_GUARDS.maxBytes) throw new EngineError('CONTEXT_LIMIT_EXCEEDED', 'Context guard exceeded; no truncated evaluation.');
      readings.push(point);
    } } finally { await cursor.close(); }
    return { sensors, readings };
  };
}
