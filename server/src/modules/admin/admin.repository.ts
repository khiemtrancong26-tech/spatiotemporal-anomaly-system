import { MongoServerError, ObjectId, type ClientSession, type Db, type MongoClient } from 'mongodb';
import { createUserRepository, toPublicUser } from '../users/users.repository.js';
import type { UserRepository, UserRole } from '../users/users.types.js';
import type { IdempotencyIntent, StoredResponse } from '../../shared/idempotency.js';
import { keysetPredicate } from '../../shared/persistence/keyset.js';
export class AdminStoreError extends Error {
  constructor(readonly code: 'USER_NOT_FOUND' | 'LAST_ACTIVE_ADMIN' | 'ADMIN_ACCESS_CHANGED' | 'REPLICA_SET_REQUIRED' | 'IDEMPOTENCY_PAYLOAD_MISMATCH' | 'IDEMPOTENCY_EXPIRED' | 'REQUEST_IN_PROGRESS') { super(code); }
}
interface AdminUser { _id: ObjectId; username: string; usernameNormalized: string; role: UserRole; isActive: boolean; adminWriteFence?: number }
interface Receipt { _id: ObjectId; userId: ObjectId; key: string; operation: string; requestHash: string; status: string; expiresAt: Date; response: StoredResponse; kind: string; resourceId: string; createdAt: Date }
const validId = (id: string) => /^[a-f\d]{24}$/i.test(id);
const publicProjection = { _id: 1, username: 1, usernameNormalized: 1, role: 1, isActive: 1 };
export function createAdminRepository(client: MongoClient, db: Db) {
  const users = db.collection<AdminUser>('users'), commonUsers = createUserRepository(db), receipts = db.collection<Receipt>('idempotencyReceipts');
  let prepared: Promise<void> | undefined;
  async function prepare() {
    prepared ??= (async () => {
      const hello = await db.command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid') throw new AdminStoreError('REPLICA_SET_REQUIRED');
      await commonUsers.ensureIndexes();
      await receipts.createIndex({ userId: 1, key: 1 }, { unique: true, name: 'uq_idempotency_user_key' });
    })();
    try { await prepared; } catch (error) { prepared = undefined; throw error; }
  }
  async function transaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = client.startSession();
    try { return await session.withTransaction(work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000, timeoutMS: 15000 }); }
    finally { await session.endSession(); }
  }
  async function replay(intent: IdempotencyIntent, session?: ClientSession): Promise<StoredResponse | null> {
    const receipt = await receipts.findOne({ userId: new ObjectId(intent.userId), key: intent.key }, session ? { session } : { readConcern: { level: 'majority' } });
    if (!receipt) return null;
    if (receipt.operation !== intent.operation || receipt.requestHash !== intent.requestHash) throw new AdminStoreError('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (receipt.expiresAt <= new Date()) throw new AdminStoreError('IDEMPOTENCY_EXPIRED');
    if (receipt.status !== 'completed' || !receipt.response) throw new AdminStoreError('REQUEST_IN_PROGRESS');
    return receipt.response;
  }
  async function lockAdmins(actor: string, session: ClientSession) {
    // Real writes to the SAME active admins prevent snapshot write-skew between
    // concurrent demotions/deactivations. A loser retries the transaction on a fresh snapshot.
    await users.updateMany({ role: 'admin', isActive: true }, { $inc: { adminWriteFence: 1 } }, { session });
    if (!await users.findOne({ _id: new ObjectId(actor), role: 'admin', isActive: true }, { session })) throw new AdminStoreError('ADMIN_ACCESS_CHANGED');
  }
  return {
    prepare, replay,
    async list(direction: 'asc' | 'desc', limit: number, after?: { key: string; id: string }) {
      const order = direction === 'asc' ? 1 : -1;
      return (await users.find(after ? keysetPredicate('usernameNormalized', direction, { key: after.key, id: new ObjectId(after.id) }) : {}, { projection: publicProjection })
        .sort({ usernameNormalized: order, _id: order }).limit(limit).toArray()).map(user => ({ data: toPublicUser(user), key: user.usernameNormalized }));
    },
    async create(intent: IdempotencyIntent, input: Parameters<UserRepository['create']>[0]): Promise<StoredResponse> {
      await prepare();
      try {
        return await transaction(async session => {
          const prior = await replay(intent, session); if (prior) return prior;
          // Insert receipt first: username failures roll it back; same-key races replay the committed response.
          const id = new ObjectId(), now = new Date();
          await receipts.insertOne({ _id: id, ...intent, userId: new ObjectId(intent.userId), kind: 'admin-create', resourceId: '', status: 'completed',
            createdAt: now, expiresAt: new Date(+now + 24 * 3600000), response: { statusCode: 201, body: {} } }, { session });
          await lockAdmins(intent.userId, session);
          const data = await commonUsers.create(input, session), response = { statusCode: 201, body: { data } };
          await receipts.updateOne({ _id: id }, { $set: { resourceId: data.id, response } }, { session });
          return response;
        });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) { const old = await replay(intent); if (old) return old; }
        throw error;
      }
    },
    async update(actor: string, id: string, changes: { role?: UserRole; isActive?: boolean }) {
      if (!validId(id)) throw new AdminStoreError('USER_NOT_FOUND');
      await prepare();
      return transaction(async session => {
        await lockAdmins(actor, session);
        const target = await users.findOne({ _id: new ObjectId(id) }, { session, projection: publicProjection });
        if (!target) throw new AdminStoreError('USER_NOT_FOUND');
        if (target.role === 'admin' && target.isActive && (changes.role === 'analyst' || changes.isActive === false) &&
          await users.countDocuments({ role: 'admin', isActive: true }, { session }) <= 1) throw new AdminStoreError('LAST_ACTIVE_ADMIN');
        const updated = await users.findOneAndUpdate({ _id: target._id }, { $set: changes }, { session, returnDocument: 'after', projection: publicProjection });
        return toPublicUser(updated!);
      });
    },
  };
}
