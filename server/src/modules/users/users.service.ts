import { HttpError } from '../../shared/http/errors.js';
import { DuplicateEmailError, DuplicateUsernameError, type EmailState, type UserPublic, type UserRepository, type UserRole } from './users.types.js';
import type { PasswordHasher } from './passwords.js';

export function normalizeUsername(username: string) { return username.trim().toLowerCase(); }
export function createUserService(repository: UserRepository, passwords: PasswordHasher, now: () => Date = () => new Date()) {
  async function prepareUser(input: { username: string; password: string; role: UserRole } & EmailState) {
    const username = input.username.trim();
    if (!username || Array.from(input.password).length < 8 || !['analyst', 'admin'].includes(input.role)) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid account details.');
    }
    const passwordHash = await passwords.hash(input.password);
    const fields = { ...input }; delete (fields as Partial<typeof input>).password;
    return { ...fields, username, usernameNormalized: normalizeUsername(username), passwordHash, role: input.role, createdAt: now() };
  }
  return {
    prepareUser,
    async createUser(input: { username: string; password: string; role: UserRole } & EmailState): Promise<UserPublic> {
      const prepared = await prepareUser(input);
      try { return await repository.create(prepared); }
      catch (error) {
        if (error instanceof DuplicateEmailError) throw new HttpError(409, 'EMAIL_EXISTS', 'Email already registered.');
        if (error instanceof DuplicateUsernameError) throw new HttpError(409, 'USERNAME_EXISTS', 'Username already exists.');
        throw error;
      }
    },
    async authenticateSession(username: string, password: string) {
      const user = await repository.findByUsername(normalizeUsername(username));
      const valid = await passwords.verify(password, user?.passwordHash ?? passwords.dummyHash);
      if (!valid || !user?.isActive) return null;
      if (user.emailVerificationRequired === true && !user.emailVerifiedAt) throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before login.');
      return { user: { id: user.id, username: user.username, role: user.role, isActive: user.isActive }, authVersion: user.authVersion ?? 0 };
    },
    async authenticate(username: string, password: string): Promise<UserPublic | null> {
      return (await this.authenticateSession(username, password))?.user ?? null;
    },
    async authenticateToken(id: string, version: number) {
      const user = await repository.findById(id);
      return user?.isActive && (user.authVersion ?? 0) === version && !(user.emailVerificationRequired === true && !user.emailVerifiedAt)
        ? { id: user.id, username: user.username, role: user.role, isActive: user.isActive } : null;
    },
    async findActiveById(id: string): Promise<UserPublic | null> {
      const user = await repository.findById(id);
      return user?.isActive ? { id: user.id, username: user.username, role: user.role, isActive: user.isActive } : null;
    },
    async currentUser(id: string): Promise<UserPublic> {
      const user = await repository.findById(id);
      if (!user?.isActive) throw new HttpError(401, 'UNAUTHORIZED', 'Valid authentication is required.');
      return { id: user.id, username: user.username, role: user.role, isActive: user.isActive };
    },
  };
}
