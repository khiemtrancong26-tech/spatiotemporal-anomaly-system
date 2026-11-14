import { HttpError } from '../../shared/http/errors.js';
import { DuplicateUsernameError, type UserPublic, type UserRepository, type UserRole } from './users.types.js';
import type { PasswordHasher } from './passwords.js';

export function normalizeUsername(username: string) { return username.trim().toLowerCase(); }
export function createUserService(repository: UserRepository, passwords: PasswordHasher, now: () => Date = () => new Date()) {
  return {
    async createUser(input: { username: string; password: string; role: UserRole }): Promise<UserPublic> {
      const username = input.username.trim();
      if (!username || Array.from(input.password).length < 8 || !['analyst', 'admin'].includes(input.role)) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid account details.');
      }
      const passwordHash = await passwords.hash(input.password);
      try {
        return await repository.create({ username, usernameNormalized: normalizeUsername(username), passwordHash, role: input.role, createdAt: now() });
      } catch (error) {
        if (error instanceof DuplicateUsernameError) throw new HttpError(409, 'USERNAME_EXISTS', 'Username already exists.');
        throw error;
      }
    },
    async authenticate(username: string, password: string): Promise<UserPublic | null> {
      const user = await repository.findByUsername(normalizeUsername(username));
      const valid = await passwords.verify(password, user?.passwordHash ?? passwords.dummyHash);
      if (!valid || !user?.isActive) return null;
      return { id: user.id, username: user.username, role: user.role, isActive: user.isActive };
    },
    async findActiveById(id: string): Promise<UserPublic | null> {
      const user = await repository.findById(id);
      return user?.isActive ? user : null;
    },
    async currentUser(id: string): Promise<UserPublic> {
      const user = await repository.findById(id);
      if (!user?.isActive) throw new HttpError(401, 'UNAUTHORIZED', 'Valid authentication is required.');
      return user;
    },
  };
}
