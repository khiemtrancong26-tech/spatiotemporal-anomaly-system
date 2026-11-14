import { describe, expect, it, vi } from 'vitest';
import { decodeJwt, SignJWT } from 'jose';
import { createTaskLimiter } from '../src/shared/concurrency.js';
import { createPasswordHasher } from '../src/modules/users/passwords.js';
import { createUserService, normalizeUsername } from '../src/modules/users/users.service.js';
import { DuplicateUsernameError, type UserRepository } from '../src/modules/users/users.types.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { testSecret } from './helpers.js';

const publicUser = { id: '507f1f77bcf86cd799439011', username: 'AnalystOne', role: 'analyst' as const, isActive: true };
function fakeRepository(): UserRepository {
  return { create: vi.fn().mockResolvedValue(publicUser), findById: vi.fn().mockResolvedValue(publicUser),
    findByUsername: vi.fn().mockResolvedValue({ ...publicUser, passwordHash: 'test-hash' }) };
}
const fakePasswords = () => ({ hash: vi.fn().mockResolvedValue('test-hash'), verify: vi.fn().mockResolvedValue(true), dummyHash: 'dummy-test-hash' });

describe('D011 password resource limits', () => {
  it('permits two jobs, queues the rest FIFO, and releases slots even after failure', async () => {
    const run = createTaskLimiter(2);
    const release: (() => void)[] = [];
    const started: number[] = [];
    let active = 0;
    let maximum = 0;
    const jobs = [0, 1, 2, 3].map(index => run(async () => {
      active++; maximum = Math.max(maximum, active); started.push(index);
      await new Promise<void>(resolve => release.push(resolve));
      active--;
      if (index === 0) throw new Error('controlled-failure');
      return index;
    }).catch(() => -1));
    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    release.shift()!();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    release.shift()!();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    release.splice(0).forEach(done => done());
    expect(await Promise.all(jobs)).toEqual([-1, 1, 2, 3]);
    expect(maximum).toBe(2);
    expect(() => createTaskLimiter(0)).toThrow();
  });
  it('hashes/verifies using actual asynchronous scrypt, random 16-byte salts and the approved parameters', async () => {
    const passwords = createPasswordHasher();
    const [first, second] = await Promise.all([passwords.hash(' Password-with-spaces '), passwords.hash(' Password-with-spaces ')]);
    expect(first).toMatch(/^\$scrypt\$131072\$8\$1\$/);
    expect(first).not.toBe(second);
    expect(Buffer.from(first.split('$')[5]!, 'base64url')).toHaveLength(16);
    expect(await passwords.verify(' Password-with-spaces ', first)).toBe(true);
    expect(await passwords.verify('Password-with-spaces', first)).toBe(false);
    expect(await passwords.verify('unknown-user-password', passwords.dummyHash)).toBe(false);
    for (const bad of ['plaintext', first.replace('131072', '1048576'), '$scrypt$131072$8$1$bad$bad', `${first}$extra`]) {
      expect(await passwords.verify('password', bad)).toBe(false);
    }
  });
});

describe('User service with labeled repository/password test doubles', () => {
  it('normalizes usernames once, preserves display case and uses the same creation rule for both roles', async () => {
    const repository = fakeRepository();
    const passwords = fakePasswords();
    const service = createUserService(repository, passwords, () => new Date('2026-11-14T00:00:00Z'));
    expect(normalizeUsername('  AnalystOne  ')).toBe('analystone');
    await service.createUser({ username: '  AnalystOne  ', password: 'valid-password', role: 'analyst' });
    expect(repository.create).toHaveBeenCalledWith({ username: 'AnalystOne', usernameNormalized: 'analystone', passwordHash: 'test-hash',
      role: 'analyst', createdAt: new Date('2026-11-14T00:00:00Z') });
    await service.createUser({ username: 'Admin', password: 'valid-password', role: 'admin' });
    await expect(service.createUser({ username: '   ', password: 'valid-password', role: 'analyst' })).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.createUser({ username: 'Analyst', password: 'short', role: 'analyst' })).rejects.toMatchObject({ statusCode: 422 });
    vi.mocked(repository.create).mockRejectedValueOnce(new DuplicateUsernameError());
    await expect(service.createUser({ username: 'AnalystOne', password: 'valid-password', role: 'analyst' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('does a same-cost dummy comparison for unknown users and never returns a password hash', async () => {
    const repository = fakeRepository();
    const passwords = fakePasswords();
    const service = createUserService(repository, passwords);
    expect(await service.authenticate(' ANALYSTONE ', 'password')).toEqual(publicUser);
    expect(repository.findByUsername).toHaveBeenCalledWith('analystone');
    vi.mocked(repository.findByUsername).mockResolvedValueOnce(null);
    expect(await service.authenticate('missing', 'password')).toBeNull();
    expect(passwords.verify).toHaveBeenLastCalledWith('password', passwords.dummyHash);
    vi.mocked(repository.findByUsername).mockResolvedValueOnce({ ...publicUser, isActive: false, passwordHash: 'test-hash' });
    expect(await service.authenticate('inactive', 'password')).toBeNull();
    vi.mocked(passwords.verify).mockResolvedValueOnce(false);
    expect(await service.authenticate('AnalystOne', 'bad-password')).toBeNull();
    expect(await service.currentUser(publicUser.id)).toEqual(publicUser);
    expect(await service.findActiveById(publicUser.id)).toEqual(publicUser);
    vi.mocked(repository.findById).mockResolvedValue(null);
    expect(await service.findActiveById('missing')).toBeNull();
    await expect(service.currentUser('missing')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('JWT HS256 and auth service', () => {
  it('issues a one-hour JWT and rejects expiration, bad signature, issuer, audience or algorithm', async () => {
    const date = new Date('2026-11-14T00:00:00Z');
    const tokens = createTokens(testSecret, () => date);
    const token = await tokens.issue(publicUser.id);
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(3600);
    expect(claims).not.toHaveProperty('role');
    expect(await tokens.verify(token)).toBe(publicUser.id);
    expect(await createTokens(testSecret, () => new Date(date.getTime() + 3600_000)).verify(token)).toBeNull();
    expect(await createTokens('another-test-secret-at-least-32-bytes', () => date).verify(token)).toBeNull();
    for (const bad of ['', 'not.jwt', 'eyJhbGciOiJub25lIn0.e30.']) expect(await tokens.verify(bad)).toBeNull();
    for (const override of [{ alg: 'HS384', iss: 'pm25-api', aud: 'pm25-web' },
      { alg: 'HS256', iss: 'other', aud: 'pm25-web' }, { alg: 'HS256', iss: 'pm25-api', aud: 'other' }]) {
      const forged = await new SignJWT({}).setProtectedHeader({ alg: override.alg, typ: 'JWT' }).setSubject(publicUser.id)
        .setIssuer(override.iss).setAudience(override.aud).setIssuedAt(claims.iat).setExpirationTime(claims.exp!)
        .sign(new TextEncoder().encode(testSecret));
      expect(await tokens.verify(forged)).toBeNull();
    }
    expect(() => createTokens('short')).toThrow();
  });
  it('registers analyst without issuing a token and uses a generic 401 login failure', async () => {
    const users = createUserService(fakeRepository(), fakePasswords());
    const tokens = { issue: vi.fn().mockResolvedValue('signed-token'), verify: vi.fn() };
    const auth = createAuthService(users, tokens);
    expect(await auth.register({ username: 'AnalystOne', password: 'password' })).toEqual(publicUser);
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(await auth.login({ username: 'AnalystOne', password: 'password' })).toEqual({ accessToken: 'signed-token', tokenType: 'Bearer', user: publicUser });
    vi.spyOn(users, 'authenticate').mockResolvedValueOnce(null);
    await expect(auth.login({ username: 'missing', password: 'bad-password' })).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });
});
