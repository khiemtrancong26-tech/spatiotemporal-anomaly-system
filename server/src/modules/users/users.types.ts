export type UserRole = 'analyst' | 'admin';
export interface UserPublic { id: string; username: string; role: UserRole; isActive: boolean }
export interface StoredUser extends UserPublic { passwordHash: string }
export interface UserRepository {
  findByUsername: (usernameNormalized: string) => Promise<StoredUser | null>;
  findById: (id: string) => Promise<UserPublic | null>;
  create: (input: { username: string; usernameNormalized: string; passwordHash: string; role: UserRole; createdAt: Date }) => Promise<UserPublic>;
}
export class DuplicateUsernameError extends Error {
  constructor() { super('Username already exists'); this.name = 'DuplicateUsernameError'; }
}
