import { randomUUID } from 'node:crypto';
import { MongoServerError, ObjectId, type ClientSession, type Db, type MongoClient } from 'mongodb';
import type { AnalysisRun, Reading } from '@pm25/shared-core/contracts';
import type { AnalysisConfig } from '../../config.js';
import type { Candidate } from '../../engines/results.js';
import { ANALYSIS_POLICY_ID } from '../../engines/statistical.policy.js';
import { EngineError } from '../../engines/python-runner.js';
import { AnalysisStoreError } from './analysis.errors.js';
import type { IdempotencyIntent, StoredResponse } from '../../shared/idempotency.js';
import { keysetPredicate } from '../../shared/persistence/keyset.js';
import { toObjectId, toPublicId, toReadingDto, type ReadingDocument } from '../../shared/persistence/mapping.js';
import type { DetectionRequest, RunGuard } from './analysis.types.js';

interface RunDocument {
  _id: ObjectId; datasetId: ObjectId; createdBy: ObjectId; family: AnalysisRun['family']; method: string;
  config: AnalysisRun['config']; scope: AnalysisRun['scope']; status: AnalysisRun['status']; createdAt: Date;
  completedAt?: Date; error?: AnalysisRun['error']; engineVersion: string; modelVersion?: string;
  policyId: string; modelHash?: string; attempt: number; owner?: string; leaseUntil?: Date; writeFence: number;
}
interface QueueState { _id: string; active: number }
interface ReceiptDocument {
  _id: ObjectId; userId: ObjectId; key: string; operation: string; requestHash: string;
  kind: 'analysis'; status: 'completed'; resourceId: string; createdAt: Date; expiresAt: Date; response: StoredResponse;
}
export class RunOwnershipLost extends Error {}
const validId = (id: string) => /^[a-f\d]{24}$/i.test(id);
export function toAnalysisDto(document: RunDocument): AnalysisRun {
  return { id: toPublicId(document._id), datasetId: toPublicId(document.datasetId), family: document.family,
    method: document.method, config: structuredClone(document.config), scope: structuredClone(document.scope),
    status: document.status, createdAt: document.createdAt.toISOString(), engineVersion: document.engineVersion,
    ...(document.modelVersion !== undefined ? { modelVersion: document.modelVersion } : {}),
    ...(document.completedAt ? { completedAt: document.completedAt.toISOString() } : {}),
    ...(document.error ? { error: { code: document.error.code, message: document.error.message } } : {}) };
}

export function createAnalysisRepository(client: MongoClient, db: Db, config: AnalysisConfig) {
  const runs = db.collection<RunDocument>('analysisRuns'), receipts = db.collection<ReceiptDocument>('idempotencyReceipts');
  const anomalies = db.collection('anomalies'), queue = db.collection<QueueState>('analysisQueueState');
  let prepared: Promise<void> | undefined;
  async function prepare() {
    prepared ??= (async () => {
      await client.connect();
      const hello = await db.command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid') throw new AnalysisStoreError('REPLICA_SET_REQUIRED', 'Analysis requires a MongoDB replica set.');
      await runs.createIndexes([
        { key: { datasetId: 1, createdAt: -1, _id: -1 }, name: 'ix_runs_dataset_created' },
        { key: { status: 1, leaseUntil: 1, createdAt: 1 }, name: 'ix_runs_claim' },
      ]);
      await anomalies.createIndex({ analysisRunId: 1, readingId: 1 }, { unique: true, name: 'uq_anomalies_run_reading' });
      await receipts.createIndex({ userId: 1, key: 1 }, { unique: true, name: 'uq_idempotency_user_key' });
      // Never reset a pre-existing counter: acceptance/terminal updates maintain it transactionally.
      await queue.updateOne({ _id: 'online' }, { $setOnInsert: { active: 0 } }, { upsert: true, writeConcern: { w: 'majority' } });
    })();
    try { await prepared; } catch (error) { prepared = undefined; throw error; }
  }
  async function transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = client.startSession();
    try { return await session.withTransaction(work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
      maxCommitTimeMS: 10_000, timeoutMS: 15_000 }); }
    finally { await session.endSession(); }
  }
  async function replay(intent: IdempotencyIntent): Promise<StoredResponse | null> {
    const found = await receipts.findOne({ userId: toObjectId(intent.userId), key: intent.key }, { readConcern: { level: 'majority' } });
    if (!found) return null;
    if (found.operation !== intent.operation || found.requestHash !== intent.requestHash) throw new AnalysisStoreError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The key belongs to a different operation or payload.');
    if (found.expiresAt <= new Date()) throw new AnalysisStoreError('IDEMPOTENCY_EXPIRED', 'The replay window expired; this key will not execute a new operation.');
    // This collection also contains B3 processing receipts. Never recover them here.
    if (found.status !== 'completed' || !found.response) throw new AnalysisStoreError('REQUEST_IN_PROGRESS', 'Acceptance is still being processed.');
    return found.response;
  }
  function filterGuard(guard: RunGuard) {
    return { _id: toObjectId(guard.id), owner: guard.owner, attempt: guard.attempt, status: 'running' as const,
      $expr: { $gt: ['$leaseUntil', '$$NOW'] } };
  }
  async function fenced<T>(guard: RunGuard, work: (session: ClientSession) => Promise<T>) {
    return transaction(async session => {
      // A write to the same run document serializes against claim/heartbeat/terminal transitions.
      const lock = await runs.updateOne(filterGuard(guard), { $inc: { writeFence: 1 } }, { session });
      if (!lock.matchedCount) throw new RunOwnershipLost();
      return work(session);
    });
  }
  return {
    prepare, replay,
    async accept(intent: IdempotencyIntent, input: DetectionRequest, metadata: { engineVersion: string; modelVersion?: string; modelHash?: string }): Promise<StoredResponse> {
      await prepare();
      const old = await replay(intent); if (old) return old;
      const now = new Date(), document: RunDocument = { _id: new ObjectId(), datasetId: toObjectId(input.datasetId),
        createdBy: toObjectId(intent.userId), family: input.family, method: input.method, config: structuredClone(input.config),
        scope: structuredClone(input.scope ?? {}), status: 'queued', createdAt: now, ...metadata,
        policyId: ANALYSIS_POLICY_ID, attempt: 0, leaseUntil: new Date(0), writeFence: 0 };
      const response: StoredResponse = { statusCode: 202, body: { data: toAnalysisDto(document) } };
      try {
        await transaction(async session => {
          // Insert first so same-key races resolve as replay, even when the queue becomes full.
          await receipts.insertOne({ _id: new ObjectId(), ...intent, userId: toObjectId(intent.userId), kind: 'analysis',
            resourceId: document._id.toHexString(), status: 'completed', createdAt: now,
            expiresAt: new Date(now.getTime() + config.replayMs), response }, { session });
          const slot = await queue.updateOne({ _id: 'online', active: { $lt: config.maxPending } }, { $inc: { active: 1 } }, { session });
          if (!slot.matchedCount) throw new AnalysisStoreError('ANALYSIS_QUEUE_FULL', 'Analysis capacity is full. No run was accepted.');
          await runs.insertOne(document, { session });
        });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          const existing = await replay(intent); if (existing) return existing;
        }
        throw error;
      }
      return response;
    },
    async sensorsInDataset(datasetId: string, ids: string[]) {
      const unique = [...new Set(ids)];
      if (unique.some(id => !validId(id))) return false;
      return await db.collection('sensors').countDocuments({ datasetId: toObjectId(datasetId), _id: { $in: unique.map(toObjectId) } }) === unique.length;
    },
    async get(id: string): Promise<AnalysisRun | null> {
      if (!validId(id)) return null;
      const doc = await runs.findOne({ _id: toObjectId(id) }, { readPreference: 'primary' });
      return doc ? toAnalysisDto(doc) : null;
    },
    async list(input: { datasetId: string; direction: 'asc' | 'desc'; limit: number; after?: { key: string; id: string } }): Promise<AnalysisRun[]> {
      if (!validId(input.datasetId)) return [];
      const boundary = input.after ? keysetPredicate('createdAt', input.direction, { key: new Date(input.after.key), id: toObjectId(input.after.id) }) : {};
      const direction = input.direction === 'asc' ? 1 : -1;
      return (await runs.find({ datasetId: toObjectId(input.datasetId), ...boundary }, { readPreference: 'primary' })
        .sort({ createdAt: direction, _id: direction }).limit(input.limit).toArray()).map(toAnalysisDto);
    },
    async claim(): Promise<RunGuard | null> {
      await prepare();
      const document = await runs.findOneAndUpdate({ status: { $in: ['queued', 'running'] }, $expr: { $lte: ['$leaseUntil', '$$NOW'] } },
        [{ $set: { status: 'running', owner: randomUUID(), attempt: { $add: ['$attempt', 1] },
          leaseUntil: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: config.leaseMs } } } }],
        { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after', writeConcern: { w: 'majority' } });
      return document ? { id: toPublicId(document._id), owner: document.owner!, attempt: document.attempt,
        run: toAnalysisDto(document), policyId: document.policyId, ...(document.modelHash ? { modelHash: document.modelHash } : {}) } : null;
    },
    async renew(guard: RunGuard): Promise<boolean> {
      const result = await runs.updateOne(filterGuard(guard), [{ $set: {
        leaseUntil: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: config.leaseMs } },
      } }], { writeConcern: { w: 'majority' } });
      return result.matchedCount === 1;
    },
    async cleanup(guard: RunGuard) {
      for (;;) {
        const ids = await anomalies.find({ analysisRunId: toObjectId(guard.id) }, { projection: { _id: 1 } }).limit(config.batchSize).toArray();
        if (!ids.length) return;
        await fenced(guard, session => anomalies.deleteMany({ _id: { $in: ids.map(doc => doc._id) }, analysisRunId: toObjectId(guard.id) }, { session }));
      }
    },
    async readings(guard: RunGuard, signal: AbortSignal): Promise<Reading[]> {
      const scope = guard.run.scope;
      const cursor = db.collection<ReadingDocument>('readings').find({ datasetId: toObjectId(guard.run.datasetId),
        ...(scope.sensorIds ? { sensorId: { $in: [...new Set(scope.sensorIds)].map(toObjectId) } } : {}),
        ...(scope.from || scope.to ? { ts: { ...(scope.from ? { $gte: new Date(scope.from) } : {}), ...(scope.to ? { $lte: new Date(scope.to) } : {}) } } : {}),
      }, { projection: { _id: 1, datasetId: 1, sensorId: 1, ts: 1, location: 1, value: 1, unit: 1 },
        sort: { ts: 1, _id: 1 }, limit: config.maxReadings + 1, batchSize: config.batchSize, readPreference: 'primary', maxTimeMS: config.timeoutMs });
      const output: Reading[] = [];
      try {
        for await (const document of cursor) {
          if (signal.aborted) throw new EngineError('ENGINE_ABORTED', 'Analysis stopped.');
          if (output.length === config.maxReadings) throw new EngineError('SCOPE_LIMIT_EXCEEDED', 'Analysis scope exceeds the configured reading limit. No truncated result was published.');
          output.push(toReadingDto(document));
        }
      } finally { await cursor.close(); }
      return output;
    },
    async writeBatch(guard: RunGuard, candidates: Candidate[]) {
      await fenced(guard, async session => {
        const time = new Date();
        await anomalies.insertMany(candidates.map(candidate => ({ _id: new ObjectId(),
          datasetId: toObjectId(candidate.datasetId), sensorId: toObjectId(candidate.sensorId), readingId: toObjectId(candidate.readingId),
          analysisRunId: toObjectId(guard.id), ts: new Date(candidate.ts), location: candidate.location,
          family: guard.run.family, method: guard.run.method, score: candidate.score, severity: 'low',
          status: 'open', note: '', version: 1, updatedAt: time,
        })), { session, ordered: true });
      });
    },
    async terminal(guard: RunGuard, error?: { code: string; message: string }) {
      await fenced(guard, async session => {
        await runs.updateOne({ _id: toObjectId(guard.id) }, [{ $set: { status: error ? 'failed' : 'completed', completedAt: '$$NOW',
          ...(error ? { error: { $literal: error } } : {}) } }, { $unset: ['owner', 'leaseUntil'] }], { session });
        const released = await queue.updateOne({ _id: 'online', active: { $gte: 1 } }, { $inc: { active: -1 } }, { session });
        if (!released.matchedCount) throw new Error('Analysis queue counter invariant failed');
      });
    },
  };
}
export type AnalysisRepository = ReturnType<typeof createAnalysisRepository>;
