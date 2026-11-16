import { ObjectId, type Db, type MongoClient, type Document } from 'mongodb';
import { AnomalySchema } from '@pm25/shared-core/contracts';
import { toObjectId, toPublicId, toGeoPoint, toUtcIso } from '../../shared/persistence/mapping.js';
import { keysetPredicate } from '../../shared/persistence/keyset.js';
import type { Anomaly, AnomalyPageInput, ReviewRequest, ReviewOutcome } from './anomalies.types.js';

interface AnomalyDocument {
  _id: ObjectId; datasetId: ObjectId; sensorId: ObjectId; readingId: ObjectId; analysisRunId: ObjectId;
  ts: Date; location: Anomaly['location']; family: Anomaly['family']; method: string; score: number;
  severity: Anomaly['severity']; status: Anomaly['status']; note: string; version: number; updatedAt: Date;
}
const validId = (id: string) => /^[\da-f]{24}$/i.test(id);
const projection = { _id: 1, datasetId: 1, sensorId: 1, readingId: 1, analysisRunId: 1, ts: 1, location: 1,
  family: 1, method: 1, score: 1, severity: 1, status: 1, note: 1, version: 1, updatedAt: 1 };
export function toAnomalyDto(document: AnomalyDocument): Anomaly {
  return AnomalySchema.parse({ id: toPublicId(document._id), datasetId: toPublicId(document.datasetId),
    sensorId: toPublicId(document.sensorId), readingId: toPublicId(document.readingId), analysisRunId: toPublicId(document.analysisRunId),
    ts: toUtcIso(document.ts), location: toGeoPoint(document.location.coordinates), family: document.family, method: document.method,
    score: document.score, severity: document.severity, status: document.status, note: document.note,
    version: document.version, updatedAt: toUtcIso(document.updatedAt) });
}

/** Shared by all read paths: apply before limit, never page private candidates first. */
function publishedPipeline(): Document[] {
  return [
    { $lookup: { from: 'analysisRuns', let: { runId: '$analysisRunId', datasetId: '$datasetId', family: '$family', method: '$method' },
      pipeline: [{ $match: { status: 'completed', $expr: { $and: [
        { $eq: ['$_id', '$$runId'] }, { $eq: ['$datasetId', '$$datasetId'] },
        { $eq: ['$family', '$$family'] }, { $eq: ['$method', '$$method'] },
      ] } } }, { $project: { _id: 1 } }, { $limit: 1 }], as: '_publishedRun' } },
    { $match: { '_publishedRun.0': { $exists: true } } },
    { $lookup: { from: 'datasets', localField: 'datasetId', foreignField: '_id',
      pipeline: [{ $match: { status: 'imported' } }, { $project: { _id: 1 } }], as: '_publishedDataset' } },
    { $match: { '_publishedDataset.0': { $exists: true } } },
  ];
}
class ReviewRollback extends Error {
  constructor(readonly outcome: Exclude<ReviewOutcome, { kind: 'updated' }>) { super(outcome.kind); }
}
export function createAnomalyRepository(client: MongoClient, db: Db) {
  const anomalies = db.collection<AnomalyDocument>('anomalies');
  return {
    async list(input: AnomalyPageInput): Promise<Anomaly[]> {
      const filter: Document = { datasetId: toObjectId(input.datasetId) };
      if (input.analysisRunId) filter.analysisRunId = toObjectId(input.analysisRunId);
      for (const key of ['status', 'severity', 'family', 'method'] as const) if (input[key] !== undefined) filter[key] = input[key];
      if (input.from || input.to) filter.ts = { ...(input.from ? { $gte: new Date(input.from) } : {}), ...(input.to ? { $lte: new Date(input.to) } : {}) };
      if (input.after) filter.$and = [keysetPredicate('ts', input.direction, { key: new Date(input.after.key), id: toObjectId(input.after.id) })];
      const direction = input.direction === 'asc' ? 1 : -1;
      return (await anomalies.aggregate<AnomalyDocument>([
        { $match: filter }, { $sort: { ts: direction, _id: direction } }, ...publishedPipeline(),
        { $limit: input.limit }, { $project: projection },
      ], { readPreference: 'primary', readConcern: { level: 'majority' } }).toArray()).map(toAnomalyDto);
    },
    async get(id: string): Promise<Anomaly | null> {
      if (!validId(id)) return null;
      const documents = await anomalies.aggregate<AnomalyDocument>([
        { $match: { _id: toObjectId(id) } }, ...publishedPipeline(), { $limit: 1 }, { $project: projection },
      ], { readPreference: 'primary', readConcern: { level: 'majority' } }).toArray();
      return documents[0] ? toAnomalyDto(documents[0]) : null;
    },
    async review(id: string, request: ReviewRequest): Promise<ReviewOutcome> {
      if (!validId(id)) return { kind: 'not-found' };
      const session = client.startSession();
      try {
        return await session.withTransaction(async (): Promise<ReviewOutcome> => {
          const existing = await anomalies.findOne({ _id: toObjectId(id) }, { projection, session });
          if (!existing) throw new ReviewRollback({ kind: 'not-found' });
          // Actual writes lock the parents against concurrent visibility transitions.
          // A no-op $set or a preflight read does not provide the same protection.
          // All reviews use dataset -> run -> anomaly order, and failed CAS rolls back fences.
          const dataset = await db.collection('datasets').updateOne({ _id: existing.datasetId, status: 'imported' },
            { $inc: { reviewFence: 1 } }, { session });
          if (!dataset.matchedCount) throw new ReviewRollback({ kind: 'not-found' });
          const run = await db.collection('analysisRuns').updateOne({ _id: existing.analysisRunId, datasetId: existing.datasetId,
            status: 'completed', family: existing.family, method: existing.method }, { $inc: { reviewFence: 1 } }, { session });
          if (!run.matchedCount) throw new ReviewRollback({ kind: 'not-found' });
          if (existing.version !== request.baseVersion) throw new ReviewRollback({ kind: 'conflict', currentVersion: existing.version });
          if (!Number.isSafeInteger(existing.version) || existing.version >= Number.MAX_SAFE_INTEGER) throw new ReviewRollback({ kind: 'version-exhausted' });
          const changes: Document = {};
          if (request.changes.status !== undefined) changes.status = request.changes.status;
          if (request.changes.note !== undefined) changes.note = request.changes.note;
          const updated = await anomalies.findOneAndUpdate({ _id: existing._id, version: request.baseVersion,
            datasetId: existing.datasetId, analysisRunId: existing.analysisRunId },
          { $set: changes, $inc: { version: 1 }, $currentDate: { updatedAt: true } },
          { session, returnDocument: 'after', projection });
          if (!updated) throw new Error('Review CAS invariant failed');
          return { kind: 'updated', data: toAnomalyDto(updated) };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000, timeoutMS: 15000 });
      } catch (error) { if (error instanceof ReviewRollback) return error.outcome; throw error; }
      finally { await session.endSession(); }
    },
  };
}
export type AnomalyRepository = ReturnType<typeof createAnomalyRepository>;
