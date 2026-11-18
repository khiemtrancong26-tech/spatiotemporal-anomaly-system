import { datasetAccessFilter, type DatasetActor } from '../datasets/dataset-access.js';
import type { DatasetWriteScheduler } from '../datasets/dataset-write.js';
import { defaultReviewConfig } from '../../config.js';
import { MongoServerError, ObjectId, type ClientSession, type Db, type MongoClient, type Document } from 'mongodb';
import { AnomalySchema } from '@pm25/shared-core/contracts';
import { toObjectId, toPublicId, toGeoPoint, toUtcIso } from '../../shared/persistence/mapping.js';
import { keysetPredicate } from '../../shared/persistence/keyset.js';
import type { Anomaly, AnomalyPageInput, ReviewRequest, ReviewOutcome, SyncReviewOutcome } from './anomalies.types.js';

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

function importedDataset(actor: DatasetActor): Document[] {
  return [
    { $lookup: { from: 'datasets', localField: 'datasetId', foreignField: '_id',
      pipeline: [{ $match: { ...datasetAccessFilter(actor), status: 'imported' } }, { $project: { _id: 1 } }], as: '_publishedDataset' } },
    { $match: { '_publishedDataset.0': { $exists: true } } },
  ];
}

/** Apply visibility before the page limit. */
function publishedPipeline(actor: DatasetActor): Document[] {
  return [
    { $lookup: { from: 'analysisRuns', localField: 'analysisRunId', foreignField: '_id',
      let: { runId: '$analysisRunId', datasetId: '$datasetId', family: '$family', method: '$method' },
      pipeline: [{ $match: { status: 'completed', $expr: { $and: [
        { $eq: ['$_id', '$$runId'] }, { $eq: ['$datasetId', '$$datasetId'] },
        { $eq: ['$family', '$$family'] }, { $eq: ['$method', '$$method'] },
      ] } } }, { $project: { _id: 1 } }, { $limit: 1 }], as: '_publishedRun' } },
    { $match: { '_publishedRun.0': { $exists: true } } },
    ...importedDataset(actor),
  ];
}

export function buildAnomalyListQuery(input: AnomalyPageInput): { collection: string; pipeline: Document[] } {
  const datasetId = toObjectId(input.datasetId);
  const filter: Document = { datasetId };
  for (const key of ['status', 'severity', 'family', 'method'] as const) if (input[key] !== undefined) filter[key] = input[key];
  if (input.from || input.to) filter.ts = { ...(input.from ? { $gte: new Date(input.from) } : {}), ...(input.to ? { $lte: new Date(input.to) } : {}) };
  if (input.after) filter.$and = [keysetPredicate('ts', input.direction, { key: new Date(input.after.key), id: toObjectId(input.after.id) })];
  const direction = input.direction === 'asc' ? 1 : -1;
  const sort = { $sort: { ts: direction, _id: direction } };
  const page = [{ $limit: input.limit }, { $project: projection }];
  if (!input.analysisRunId) return { collection: 'anomalies',
    pipeline: [{ $match: filter }, sort, ...publishedPipeline(input.actor), ...page] };
  const runId = toObjectId(input.analysisRunId);
  // Anchor the lookup at one published run and authorize its dataset once per page.
  // The adjacent unwind lets MongoDB emit rows individually from the lookup.
  return { collection: 'analysisRuns', pipeline: [
    { $match: { _id: runId, datasetId, status: 'completed',
      $expr: { $eq: ['$datasetId', { $literal: datasetId }] } } },
    ...importedDataset(input.actor),
    { $lookup: { from: 'anomalies', let: { family: '$family', method: '$method' }, pipeline: [
      { $match: { ...filter, analysisRunId: runId, $expr: { $and: [
        { $eq: ['$analysisRunId', { $literal: runId }] }, { $eq: ['$datasetId', { $literal: datasetId }] },
        { $eq: ['$family', '$$family'] }, { $eq: ['$method', '$$method'] },
      ] } } }, sort, ...page,
    ], as: '_page' } },
    { $unwind: '$_page' }, { $replaceWith: '$_page' },
  ] };
}
class ReviewRollback extends Error {
  constructor(readonly outcome: Exclude<ReviewOutcome, { kind: 'updated' }>) { super(outcome.kind); }
}
export function createAnomalyRepository(client: MongoClient, db: Db, config = defaultReviewConfig, schedule?: DatasetWriteScheduler) {
  const anomalies = db.collection<AnomalyDocument>('anomalies');
  // The collection's built-in unique _id index scopes receipts to the authenticated actor.
  type ReceiptOutcome = Exclude<ReviewOutcome, { kind: 'updated' }> | { kind: 'applied' };
  const receipts = db.collection<{ _id: string; fingerprint: string; outcome: ReceiptOutcome }>('processedReviewMutations');
  const transaction = { readConcern: { level: 'snapshot' as const }, writeConcern: { w: 'majority' as const }, ...config.transaction };

  async function scheduleReview<T>(id: string, actor: DatasetActor, work: () => Promise<T>): Promise<T> {
    if (!schedule || !config.maxWaitingPerDataset || !validId(id)) return work();
    const [visible] = await anomalies.aggregate<Pick<AnomalyDocument, 'datasetId'>>([
      { $match: { _id: toObjectId(id) } }, ...publishedPipeline(actor), { $project: { _id: 0, datasetId: 1 } },
    ], { readPreference: 'primary', readConcern: { level: 'majority' } }).toArray();
    return visible ? schedule(toPublicId(visible.datasetId), work) : work();
  }

  async function applyReview(id: string, request: ReviewRequest, actor: DatasetActor, session: ClientSession): Promise<ReviewOutcome> {
    if (!validId(id)) return { kind: 'not-found' };
    const [existing] = await anomalies.aggregate<AnomalyDocument>([
      { $match: { _id: toObjectId(id) } }, ...publishedPipeline(actor), { $project: projection },
    ], { session }).toArray();
    if (!existing) return { kind: 'not-found' };
    if (existing.version !== request.baseVersion) return { kind: 'conflict', currentVersion: existing.version };
    if (!Number.isSafeInteger(existing.version) || existing.version >= Number.MAX_SAFE_INTEGER) return { kind: 'version-exhausted' };
    // Actual writes fence concurrent changes to visibility. Keep the dataset -> run -> anomaly order.
    const dataset = await db.collection('datasets').updateOne({ ...datasetAccessFilter(actor), _id: existing.datasetId, status: 'imported' },
      { $inc: { reviewFence: 1 } }, { session });
    if (!dataset.matchedCount) throw new ReviewRollback({ kind: 'not-found' });
    const run = await db.collection('analysisRuns').updateOne({ _id: existing.analysisRunId, datasetId: existing.datasetId,
      status: 'completed', family: existing.family, method: existing.method }, { $inc: { reviewFence: 1 } }, { session });
    if (!run.matchedCount) throw new ReviewRollback({ kind: 'not-found' });
    const updated = await anomalies.findOneAndUpdate({ _id: existing._id, version: request.baseVersion,
      datasetId: existing.datasetId, analysisRunId: existing.analysisRunId },
    { $set: request.changes, $inc: { version: 1 }, $currentDate: { updatedAt: true } },
    { session, returnDocument: 'after', projection });
    if (!updated) throw new Error('Review CAS invariant failed');
    return { kind: 'updated', data: toAnomalyDto(updated) };
  }

  async function syncReview(id: string, request: ReviewRequest, actor: DatasetActor, mutationId: string, fingerprint: string): Promise<SyncReviewOutcome> {
    const key = `${actor.id}:${mutationId}`;
    return scheduleReview(id, actor, () => client.withSession(async session => {
      const attempt = () => session.withTransaction(async (): Promise<SyncReviewOutcome> => {
        const receipt = await receipts.findOne({ _id: key }, { session });
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) return { kind: 'mutation-reused' };
          // Recheck visibility before disclosing even a previous conflict/version.
          if (receipt.outcome.kind !== 'not-found' && !(await anomalies.aggregate([
            { $match: { _id: toObjectId(id) } }, ...publishedPipeline(actor), { $limit: 1 },
          ], { session }).toArray()).length) return { kind: 'not-found' };
          return receipt.outcome.kind === 'applied' ? { kind: 'duplicate' } : receipt.outcome;
        }
        const outcome = await applyReview(id, request, actor, session);
        await receipts.insertOne({ _id: key, fingerprint, outcome: outcome.kind === 'updated' ? { kind: 'applied' } : outcome }, { session });
        return outcome;
      }, transaction);
      try { return await attempt(); }
      catch (error) {
        if (error instanceof ReviewRollback) return error.outcome;
        if (error instanceof MongoServerError && error.code === 11000) return attempt();
        throw error;
      }
    }));
  }
  return {
    async list(input: AnomalyPageInput): Promise<Anomaly[]> {
      const { collection, pipeline } = buildAnomalyListQuery(input);
      return (await db.collection(collection).aggregate<AnomalyDocument>(pipeline,
        { readPreference: 'primary', readConcern: { level: 'majority' } }).toArray()).map(toAnomalyDto);
    },
    async get(id: string, actor: DatasetActor): Promise<Anomaly | null> {
      if (!validId(id)) return null;
      const documents = await anomalies.aggregate<AnomalyDocument>([
        { $match: { _id: toObjectId(id) } }, ...publishedPipeline(actor), { $limit: 1 }, { $project: projection },
      ], { readPreference: 'primary', readConcern: { level: 'majority' } }).toArray();
      return documents[0] ? toAnomalyDto(documents[0]) : null;
    },
    async review(id: string, request: ReviewRequest, actor: DatasetActor): Promise<ReviewOutcome> {
      if (!validId(id)) return { kind: 'not-found' };
      return scheduleReview(id, actor, async () => {
        try {
          return await client.withSession(session => session.withTransaction(() => applyReview(id, request, actor, session), transaction));
        } catch (error) { if (error instanceof ReviewRollback) return error.outcome; throw error; }
      });
    },
    syncReview,
  };
}
export type AnomalyRepository = ReturnType<typeof createAnomalyRepository>;
