import { HttpError } from '../../shared/http/errors.js';
import { requireIdempotencyKey } from '../../shared/idempotency.js';
import { createCursorCodec, listSorts, parsePageQuery, queryFingerprint } from '../../shared/pagination.js';
import { DuplicateUsernameError, type UserRole } from '../users/users.types.js';
import type { createUserService } from '../users/index.js';
import { AdminStoreError, type createAdminRepository } from './admin.repository.js';
async function store<T>(work: () => Promise<T>) {
  try { return await work(); } catch (error) {
    if (error instanceof DuplicateUsernameError) throw new HttpError(409, 'USERNAME_EXISTS', 'Username already exists.');
    if (error instanceof AdminStoreError) {
      const status = { USER_NOT_FOUND: 404, LAST_ACTIVE_ADMIN: 409, ADMIN_ACCESS_CHANGED: 403, REPLICA_SET_REQUIRED: 500,
        IDEMPOTENCY_PAYLOAD_MISMATCH: 422, IDEMPOTENCY_EXPIRED: 409, REQUEST_IN_PROGRESS: 409 };
      throw new HttpError(status[error.code], error.code, error.code === 'LAST_ACTIVE_ADMIN' ? 'At least one active admin must remain.' : 'Admin operation could not be completed.');
    }
    throw error;
  }
}
export function createAdminService(repository: ReturnType<typeof createAdminRepository>, users: ReturnType<typeof createUserService>, codec: ReturnType<typeof createCursorCodec>) {
  return {
    async list(query: { sort?: string; limit?: number; cursor?: string }) {
      const page = parsePageQuery(query, listSorts.users, 'username:asc'), fingerprint = queryFingerprint('admin.users.list', {}, page.sort);
      const after = page.cursor ? codec.decode(page.cursor, fingerprint) : undefined;
      if (after && (!/^[a-f\d]{24}$/i.test(after.id) || after.key !== after.key.trim().toLowerCase())) throw new HttpError(400, 'INVALID_CURSOR', 'Invalid user cursor.');
      const rows = await repository.list(page.sort.endsWith(':asc') ? 'asc' : 'desc', page.limit + 1, after), data = rows.slice(0, page.limit), last = data.at(-1);
      return { data: data.map(row => row.data), page: { limit: page.limit, nextCursor: rows.length > page.limit && last ? codec.encode({ key: last.key, id: last.data.id }, fingerprint) : null } };
    },
    async create(actor: string, key: unknown, input: { username: string; password: string; role: UserRole }) {
      const intent = { userId: actor, key: requireIdempotencyKey(key), operation: 'POST /api/v1/admin/users', requestHash: queryFingerprint('POST /api/v1/admin/users', { payload: input }, '') };
      await store(repository.prepare); const old = await store(() => repository.replay(intent)); if (old) return old;
      const prepared = await users.prepareUser(input);
      return store(() => repository.create(intent, prepared));
    },
    update: (actor: string, id: string, changes: { role?: UserRole; isActive?: boolean }) => store(async () => ({ data: await repository.update(actor, id, changes) })),
  };
}
