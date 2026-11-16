import { MongoServerError, ObjectId, type Db } from 'mongodb';
import { DuplicateUsernameError, type StoredUser, type UserPublic, type UserRepository, type UserRole } from './users.types.js';

interface UserDocument {
  _id: ObjectId; username: string; usernameNormalized: string; passwordHash: string;
  role: UserRole; isActive: boolean; createdAt: Date;
}
function toPublicUser(document: Pick<UserDocument, '_id' | 'username' | 'role' | 'isActive'>): UserPublic {
  return { id: document._id.toHexString(), username: document.username, role: document.role, isActive: document.isActive };
}

export function createUserRepository(db: Db): UserRepository {
  const collection = db.collection<UserDocument>('users');
  let uniqueIndex: Promise<string> | undefined;
  async function requireUniqueIndex() {
    // The approved unique key must exist BEFORE an account can be created, including
    // concurrent Register/bootstrap/Admin requests on a fresh database.
    uniqueIndex ??= collection.createIndex({ usernameNormalized: 1 }, { unique: true, name: 'uq_users_username_normalized' });
    try { await uniqueIndex; } catch (error) { uniqueIndex = undefined; throw error; }
  }
  return {
    async findByUsername(usernameNormalized): Promise<StoredUser | null> {
      const document = await collection.findOne({ usernameNormalized });
      return document ? { ...toPublicUser(document), passwordHash: document.passwordHash } : null;
    },
    async findById(id) {
      if (!/^[0-9a-f]{24}$/i.test(id)) return null;
      const document = await collection.findOne({ _id: new ObjectId(id) }, { projection: { _id: 1, username: 1, role: 1, isActive: 1 } });
      return document ? toPublicUser(document) : null;
    },
    async create(input) {
      await requireUniqueIndex();
      const document: UserDocument = { _id: new ObjectId(), ...input, isActive: true };
      try { await collection.insertOne(document); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.usernameNormalized === 1) {
          throw new DuplicateUsernameError();
        }
        throw error;
      }
      return toPublicUser(document);
    },
  };
}
