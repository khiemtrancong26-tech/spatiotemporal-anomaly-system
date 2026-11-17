export type UserRole = 'analyst' | 'admin';
export interface UserPublic { id: string; username: string; role: UserRole; isActive: boolean }
export interface AuthState { authVersion?: number; emailVerificationRequired?: boolean | undefined; emailVerifiedAt?: Date | null | undefined }
export interface EmailToken { hash: string; expiresAt: Date; cooldownUntil: Date }
export interface EmailState extends AuthState { email?: string; emailNormalized?: string; emailVerification?: EmailToken; passwordReset?: EmailToken }
export interface StoredUser extends UserPublic, AuthState { passwordHash: string }
export interface UserRepository {
  findByUsername: (usernameNormalized: string) => Promise<StoredUser | null>;
  findById: (id: string) => Promise<(UserPublic & AuthState) | null>;
  create: (input: { username: string; usernameNormalized: string; passwordHash: string; role: UserRole; createdAt: Date } & EmailState) => Promise<UserPublic>;
}
export class DuplicateUsernameError extends Error {
  constructor() { super('Username already exists'); this.name = 'DuplicateUsernameError'; }
}

export class DuplicateEmailError extends Error {}
