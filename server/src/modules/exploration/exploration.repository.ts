import type { Db, Document } from 'mongodb';
import { ExplorationMetadataSchema, type ExplorationScope, type Sampling } from '@pm25/shared-core';
import { toObjectId } from '../../shared/persistence/mapping.js';
import type { ExplorationRepository, QueryContext } from './exploration.types.js';

// Override the legacy 2s socket budget only for C2; the operation timer remains the outer bound.
const options = (ctx: QueryContext) => ({ signal: ctx.signal, maxTimeMS: ctx.remaining(), socketTimeoutMS: ctx.remaining(), readPreference: 'primary' as const });
function bboxMatch(bbox: readonly number[] | null): Document {
  return bbox ? { 'location.coordinates.0': { $gte: bbox[0], $lte: bbox[2] }, 'location.coordinates.1': { $gte: bbox[1], $lte: bbox[3] } } : {};
}
/** Also used by the explain harness; diagnostic queries must match production. */
export function buildExplorationPipeline(id: string, ids: string[], scope: ExplorationScope, sampling: Sampling | null, maxReadings: number,
  bucket?: { size: number; offset: number }): Document[] {
  const match: Document = { datasetId: toObjectId(id), sensorId: { $in: ids.map(toObjectId) }, ...bboxMatch(scope.bbox) };
  if (scope.from || scope.to) match.ts = { ...(scope.from ? { $gte: new Date(scope.from) } : {}), ...(scope.to ? { $lte: new Date(scope.to) } : {}) };
  const onGrid = sampling ? { $and: [ { $gte: ['$ts', new Date(sampling.expectedFrom)] }, { $lte: ['$ts', new Date(sampling.expectedTo)] },
    { $eq: [{ $mod: [{ $subtract: [{ $toLong: '$ts' }, Date.parse(sampling.anchor)] }, sampling.cadenceSeconds * 1000] }, 0] } ] } : false;
  const timeBucket = bucket ? { $toLong: { $dateTrunc: { date: '$ts', unit: bucket.size === 3600000 ? 'hour' : 'day',
    timezone: bucket.offset === 0 ? 'UTC' : bucket.offset === 8 * 3600000 ? '+08:00' : '+07:00' } } } : { $literal: 0 };
  // The existing unique(datasetId,sensorId,ts) index guarantees one observation per slot.
  return [{ $match: match }, { $limit: maxReadings + 1 },
    { $group: { _id: { sensor: '$sensorId', bucket: timeBucket }, count: { $sum: 1 }, sum: { $sum: '$value' },
      min: { $min: '$value' }, max: { $max: '$value' }, from: { $min: '$ts' }, to: { $max: '$ts' }, observed: { $sum: { $cond: [onGrid, 1, 0] } } } }];
}
export function createExplorationRepository(db: Db, maxReadings: number): ExplorationRepository {
  return {
    async dataset(id, ctx) {
      const row = await db.collection('datasets').findOne({ _id: toObjectId(id) }, { ...options(ctx), projection: { status: 1, explorationMetadata: 1, importSummary: 1 } });
      if (!row) return null;
      const metadata = row.explorationMetadata ? ExplorationMetadataSchema.parse(row.explorationMetadata) : {
        version: null, timeZone: '+07:00' as const, source: 'fallback' as const, provenance: null, sampling: null,
      };
      return { status: String(row.status), metadata, ...(row.importSummary ? { importSummary: row.importSummary } : {}) };
    },
    async sensors(id, ctx, scope) {
      const rows = await db.collection('sensors').find({ datasetId: toObjectId(id),
        ...(scope?.sensorIds ? { _id: { $in: scope.sensorIds.map(toObjectId) } } : {}), ...bboxMatch(scope?.bbox ?? null),
      }, { ...options(ctx), projection: { _id: 1 }, limit: 10001 }).toArray();
      return rows.map(r => r._id.toHexString()).sort();
    },
    async groups(id, ids, scope, sampling, ctx, bucket) {
      if (!ids.length) return [];
      const rows = await db.collection('readings').aggregate(buildExplorationPipeline(id, ids, scope, sampling, maxReadings, bucket), { ...options(ctx), allowDiskUse: false }).toArray();
      return rows.map(r => ({ sensorId: r._id.sensor.toHexString(), bucket: Number(r._id.bucket), count: r.count, sum: r.sum,
        min: r.min, max: r.max, from: r.from.getTime(), to: r.to.getTime(), observed: r.observed }));
    },
  };
}
