import { MongoServerError, ObjectId, type Db, type ClientSession } from 'mongodb';
import { DuplicateEmailError, DuplicateUsernameError, type EmailState, type StoredUser, type UserPublic, type UserRepository, type UserRole } from './users.types.js';

interface UserDocument extends EmailState {
  _id: ObjectId; username: string; usernameNormalized: string; passwordHash: string;
  role: UserRole; isActive: boolean; createdAt: Date;
}
export function toPublicUser(document: Pick<UserDocument, '_id' | 'username' | 'role' | 'isActive'>): UserPublic {
  return { id: document._id.toHexString(), username: document.username, role: document.role, isActive: document.isActive };
}

export function createUserRepository(db: Db) {
  const collection = db.collection<UserDocument>('users');
  let uniqueIndex: Promise<unknown> | undefined;
  async function requireUniqueIndex() {
    // The approved unique key must exist BEFORE an account can be created, including
    // concurrent Register/bootstrap/Admin requests on a fresh database.
    uniqueIndex ??= collection.createIndexes([{ key: { usernameNormalized: 1 }, unique: true, name: 'uq_users_username_normalized' }, { key: { emailNormalized: 1 }, unique: true, name: 'uq_users_email_normalized', partialFilterExpression: { emailNormalized: { $type: 'string' } } }]);
    try { await uniqueIndex; } catch (error) { uniqueIndex = undefined; throw error; }
  }
  return {
    ensureIndexes: requireUniqueIndex,
    async issueEmailToken(emailNormalized: string, purpose: 'emailVerification' | 'passwordReset', token: NonNullable<EmailState['emailVerification']>, now: Date) {
      await requireUniqueIndex();
      const eligible = purpose === 'emailVerification' ? { emailVerificationRequired: true, emailVerifiedAt: null } : { emailVerifiedAt: { $type: 'date' as const } };
      const user = await collection.findOneAndUpdate({ emailNormalized, isActive: true, ...eligible,
        $or: [{ [`${purpose}.cooldownUntil`]: { $exists: false } }, { [`${purpose}.cooldownUntil`]: { $lte: now } }] },
        { $set: { [purpose]: token } }, { returnDocument: 'after' });
      return user?.email;
    },
    async releaseEmailCooldown(hash: string, purpose: 'emailVerification' | 'passwordReset') {
      await collection.updateOne({ [`${purpose}.hash`]: hash }, { $unset: { [`${purpose}.cooldownUntil`]: '' } });
    },
    async verifyEmail(hash: string, now: Date) {
      return (await collection.updateOne({ 'emailVerification.hash': hash, 'emailVerification.expiresAt': { $gt: now }, emailVerificationRequired: true },
        { $set: { emailVerifiedAt: now }, $unset: { emailVerification: '' } })).modifiedCount === 1;
    },
    async resetPassword(hash: string, passwordHash: string, now: Date) {
      return (await collection.updateOne({ 'passwordReset.hash': hash, 'passwordReset.expiresAt': { $gt: now }, isActive: true, emailVerifiedAt: { $type: 'date' } },
        { $set: { passwordHash }, $unset: { passwordReset: '' }, $inc: { authVersion: 1 } })).modifiedCount === 1;
    },
    async findByUsername(usernameNormalized: string): Promise<StoredUser | null> {
      const document = await collection.findOne({ usernameNormalized });
      return document ? { ...toPublicUser(document), passwordHash: document.passwordHash, authVersion: document.authVersion ?? 0, emailVerificationRequired: document.emailVerificationRequired, emailVerifiedAt: document.emailVerifiedAt } : null;
    },
    async findById(id: string) {
      if (!/^[0-9a-f]{24}$/i.test(id)) return null;
      const document = await collection.findOne({ _id: new ObjectId(id) }, { projection: { _id: 1, username: 1, role: 1, isActive: 1, authVersion: 1, emailVerificationRequired: 1, emailVerifiedAt: 1 } });
      return document ? { ...toPublicUser(document), authVersion: document.authVersion ?? 0, emailVerificationRequired: document.emailVerificationRequired, emailVerifiedAt: document.emailVerifiedAt } : null;
    },
    async create(input: Parameters<UserRepository['create']>[0], session?: ClientSession) {
      await requireUniqueIndex();
      const document: UserDocument = { _id: new ObjectId(), ...input, isActive: true };
      try { await collection.insertOne(document, session ? { session } : {}); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.emailNormalized === 1) throw new DuplicateEmailError();
        if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.usernameNormalized === 1) {
          throw new DuplicateUsernameError();
        }
        throw error;
      }
      return toPublicUser(document);
    },
  };
}
