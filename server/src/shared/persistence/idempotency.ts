import { randomUUID } from 'node:crypto';
import { MongoServerError, ObjectId, type ClientSession, type Db, type MongoClient } from 'mongodb';
import type { ImportConfig } from '../../config.js';
import { HttpError } from '../http/errors.js';
import type { StoredResponse } from '../idempotency.js';

export const interruptedResponse: StoredResponse = { statusCode: 503, body: {
  error: { code: 'OPERATION_INTERRUPTED', message: 'Operation did not complete. Check dataset status before starting a new attempt.' },
} };
export class OwnershipLostError extends HttpError {
  constructor() { super(409, 'REQUEST_IN_PROGRESS', 'Operation ownership changed; check status before retrying.'); }
}
export interface ReceiptGuard { id: string; owner: string; resourceId: string; kind: 'upload' | 'import' }
export interface ReceiptIntent { userId: string; key: string; operation: string; requestHash: string; resourceId: string; kind: ReceiptGuard['kind'] }
interface ReceiptDocument {
  _id: ObjectId; userId: ObjectId; key: string; operation: string; requestHash: string;
  resourceId: string; kind: ReceiptGuard['kind']; owner: string;
  status: 'processing' | 'completed' | 'failed'; createdAt: Date; expiresAt: Date; leaseUntil: Date;
  response?: StoredResponse;
}

export function createReceiptRepository(client: MongoClient, db: Db, limits: ImportConfig, now: () => Date = () => new Date()) {
  const receipts = db.collection<ReceiptDocument>('idempotencyReceipts');
  let preparation: Promise<void> | undefined;
  async function prepare() {
    preparation ??= (async () => {
      await client.connect();
      const hello = await db.command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid') throw new HttpError(503, 'REPLICA_SET_REQUIRED', 'Import requires a MongoDB replica set with transaction support.');
      await receipts.createIndex({ userId: 1, key: 1 }, { unique: true, name: 'uq_idempotency_user_key' });
      await receipts.createIndex({ status: 1, leaseUntil: 1 }, { name: 'ix_idempotency_recovery' });
    })();
    try { await preparation; } catch (error) { preparation = undefined; throw error; }
  }
  function guard(document: ReceiptDocument): ReceiptGuard {
    return { id: document._id.toHexString(), owner: document.owner, resourceId: document.resourceId, kind: document.kind };
  }
  async function complete(ownership: ReceiptGuard, response: StoredResponse, session: ClientSession) {
    const result = await receipts.updateOne({ _id: new ObjectId(ownership.id), owner: ownership.owner, status: 'processing' },
      { $set: { status: response.statusCode < 400 ? 'completed' : 'failed', response } }, { session });
    if (!result.matchedCount) throw new OwnershipLostError();
  }
  async function inspect(input: ReceiptIntent): Promise<{ replay: StoredResponse } | null> {
    const existing = await receipts.findOne({ userId: new ObjectId(input.userId), key: input.key });
    if (!existing) return null;
    if (existing.operation !== input.operation || existing.requestHash !== input.requestHash) {
      throw new HttpError(422, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'The idempotency key was used for a different operation or payload.');
    }
    if (existing.expiresAt <= now()) throw new HttpError(409, 'IDEMPOTENCY_EXPIRED', 'The replay window has expired. The old key will not execute a new operation.');
    if (existing.status !== 'processing' && existing.response) return { replay: existing.response };
    throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'This operation is still being processed or recovered.');
  }
  async function transaction<T>(ownership: ReceiptGuard, work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        const time = now();
        const lock = await receipts.updateOne({ _id: new ObjectId(ownership.id), owner: ownership.owner, status: 'processing', leaseUntil: { $gt: time } },
          { $set: { leaseUntil: new Date(time.getTime() + limits.leaseMs) } }, { session });
        if (!lock.matchedCount) throw new OwnershipLostError();
        return work(session);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: limits.timeoutMs });
    } finally { await session.endSession(); }
  }
  return {
    prepare, inspect,
    async claim(input: ReceiptIntent): Promise<{ guard: ReceiptGuard } | { replay: StoredResponse }> {
      await prepare();
      const time = now();
      const document: ReceiptDocument = { _id: new ObjectId(), ...input, userId: new ObjectId(input.userId), owner: randomUUID(),
        status: 'processing', createdAt: time, expiresAt: new Date(time.getTime() + limits.replayMs), leaseUntil: new Date(time.getTime() + limits.leaseMs) };
      try { await receipts.insertOne(document); return { guard: guard(document) }; }
      catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw error; }
      const existing = await inspect(input);
      if (!existing) throw new OwnershipLostError();
      return existing;
    },
    transaction, complete,
    async finish(ownership: ReceiptGuard, response: StoredResponse) {
      await transaction(ownership, session => complete(ownership, response, session));
    },
    async snapshot(ownership: ReceiptGuard): Promise<StoredResponse | null> {
      const document = await receipts.findOne({ _id: new ObjectId(ownership.id) });
      return document?.status !== 'processing' ? document?.response ?? null : null;
    },
    async renew(ownership: ReceiptGuard) {
      const time = now();
      const result = await receipts.updateOne({ _id: new ObjectId(ownership.id), owner: ownership.owner, status: 'processing', leaseUntil: { $gt: time } },
        { $set: { leaseUntil: new Date(time.getTime() + limits.leaseMs) } });
      return result.matchedCount === 1;
    },
    async takeExpired(filter: { resourceId?: string; userId?: string; key?: string } = {}): Promise<ReceiptGuard | null> {
      await prepare();
      const time = now();
      const document = await receipts.findOneAndUpdate({ status: 'processing', kind: { $in: ['upload', 'import'] }, leaseUntil: { $lte: time },
        ...(filter.resourceId ? { resourceId: filter.resourceId } : {}), ...(filter.userId ? { userId: new ObjectId(filter.userId) } : {}),
        ...(filter.key ? { key: filter.key } : {}),
      },
        { $set: { owner: randomUUID(), leaseUntil: new Date(time.getTime() + limits.leaseMs) } }, { returnDocument: 'after', sort: { leaseUntil: 1 } });
      return document ? guard(document) : null;
    },
  };
}
export type ReceiptRepository = ReturnType<typeof createReceiptRepository>;
