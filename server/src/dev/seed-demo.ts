import { ObjectId, type Db } from 'mongodb';
import { createPasswordHasher, createUserRepository, createUserService, normalizeUsername } from '../modules/users/index.js';

export async function seedDemo(db: Db, env: NodeJS.ProcessEnv) {
  const admin = { username: env.SEED_ADMIN_USERNAME ?? '', password: env.SEED_ADMIN_PASSWORD ?? '', role: 'admin' as const };
  const analyst = { username: env.SEED_ANALYST_USERNAME ?? '', password: env.SEED_ANALYST_PASSWORD ?? '', role: 'analyst' as const };
  for (const input of [admin, analyst]) {
    if (!input.username.trim() || Array.from(input.password).length < 8) throw new Error('Seed username/password configuration is required');
  }
  if (normalizeUsername(admin.username) === normalizeUsername(analyst.username)) throw new Error('Seed usernames must differ');
  if (env.SEED_DEMO_DATA !== undefined && !['true', 'false'].includes(env.SEED_DEMO_DATA)) throw new Error('Invalid SEED_DEMO_DATA');
  const repository = createUserRepository(db);
  const service = createUserService(repository, createPasswordHasher());
  async function account(input: typeof admin | typeof analyst) {
    const existing = await repository.findByUsername(normalizeUsername(input.username));
    if (existing) {
      if (existing.role !== input.role || !existing.isActive) throw new Error('Seed account has incompatible role or state');
      // Re-running seed never resets existing passwords, roles or activation state.
      return { id: existing.id, username: existing.username, role: existing.role, isActive: existing.isActive };
    }
    return service.createUser(input);
  }
  const adminUser = await account(admin);
  const analystUser = await account(analyst);
  if (env.SEED_DEMO_DATA === 'true') {
    const id = new ObjectId('00000000000000000000b201');
    const name = '[SEED B2] Metadata demo — not a real import';
    const existing = await db.collection('datasets').findOne({ _id: id });
    if (existing && (existing.name !== name || !existing.createdBy?.equals(new ObjectId(analystUser.id)))) {
      throw new Error('Seed dataset ID is already used');
    }
    await db.collection('datasets').updateOne({ _id: id }, { $setOnInsert: {
      name, sourceFilename: '[seed-b2] metadata-only.csv', status: 'imported',
      createdBy: new ObjectId(analystUser.id), createdAt: new Date(),
      importSummary: { totalRows: 0, importedRows: 0, duplicateRows: 0, conflictingRows: 0, invalidRows: 0, issues: [] },
    } }, { upsert: true });
  }
  return { admin: adminUser, analyst: analystUser };
}
