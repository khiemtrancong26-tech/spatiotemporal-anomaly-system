import { randomUUID, createHash } from 'node:crypto';
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { buildApp } from '../../src/app.js';
import { loadTestConfig, testSecret } from '../helpers.js';
let mongo: MongoMemoryServer; const apps: FastifyInstance[] = [];
beforeAll(async () => { mongo = await MongoMemoryServer.create({ binary: { version: '8.2.6' } }); });
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
afterAll(async () => { await mongo?.stop(); });
async function fixture(uri = mongo.getUri('email_' + randomUUID().replaceAll('-', ''))) {
  const sent: { email: string; token: string; reset: boolean }[] = []; let fail = false;
  const app = buildApp({ config: loadTestConfig({ MONGODB_URI: uri, LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '1000' }), logger: false, analysisWorkerEnabled: false,
    emailSender: { verification: async (email, token) => { if (fail) throw Error('private provider secret'); sent.push({ email, token, reset: false }); }, reset: async (email, token) => { if (fail) throw Error(); sent.push({ email, token, reset: true }); } } });
  apps.push(app); await app.ready();
  const post = (path: string, payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/auth/' + path, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  const register = (username = 'A', email = 'a@example.com') => post('register', { username, email, password: 'initial-password' });
  const login = (password = 'initial-password') => post('tokens', { username: 'a', password });
  return { app, post, sent, register, login, db: app.mongo.db, fail: (value: boolean) => { fail = value; } };
}
it('requires valid email, normalizes it, rejects injected state and arbitrates duplicate email races', async () => {
  const f = await fixture();
  for (const extra of [{ email: undefined }, { email: 'bad' }, { role: 'admin' }, { isActive: false }, { emailVerifiedAt: new Date() }, { authVersion: 1 }])
    expect((await f.post('register', { username: 'A', email: 'a@example.com', password: 'initial-password', ...extra })).statusCode).toBe(422);
  const results = await Promise.all([f.register('A', ' Foo@Example.com '), f.register('B', 'foo@example.com')]);
  expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]); expect(await f.db.collection('users').countDocuments()).toBe(1);
  const user = await f.db.collection('users').findOne(); expect(user).toMatchObject({ emailNormalized: 'foo@example.com', emailVerificationRequired: true, emailVerifiedAt: null, isActive: true, role: 'analyst' });
  expect(user?.emailVerification.hash).toBe(createHash('sha256').update(f.sent[0]!.token).digest('hex'));
  expect(JSON.stringify(user)).not.toContain(f.sent[0]!.token); expect(f.sent[0]!.token.length).toBe(64);
  expect(new Date(user?.emailVerification.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
  const indexes = await f.db.collection('users').listIndexes().toArray(); expect(indexes.find(i => i.name === 'uq_users_email_normalized')).toMatchObject({ unique: true, partialFilterExpression: { emailNormalized: { $type: 'string' } } });
  expect(indexes.some(i => i.expireAfterSeconds !== undefined)).toBe(false);
});
it('pending login, explicit verification, expiry, resend cooldown/replacement and provider failure stay safe', async () => {
  const f = await fixture(); expect((await f.register()).statusCode).toBe(201);
  expect((await f.login()).json().error.code).toBe('EMAIL_NOT_VERIFIED'); expect((await f.login('incorrect')).statusCode).toBe(401);
  const first = f.sent[0]!.token;
  const response = await f.post('resend-verification', { email: 'a@example.com' }); expect(f.sent).toHaveLength(1);
  expect((await f.post('resend-verification', { email: 'unknown@example.com' })).body).toBe(response.body);
  await f.db.collection('users').updateOne({}, { $set: { 'emailVerification.cooldownUntil': new Date(0) } });
  await f.post('resend-verification', { email: 'a@example.com' }); const second = f.sent[1]!.token;
  expect((await f.post('verify-email', { token: first })).statusCode).toBe(422);
  await f.db.collection('users').updateOne({}, { $set: { 'emailVerification.expiresAt': new Date(0), 'emailVerification.cooldownUntil': new Date(0) } });
  expect((await f.post('verify-email', { token: second })).statusCode).toBe(422);
  f.fail(true); expect((await f.post('resend-verification', { email: 'a@example.com' })).body).toBe(response.body);
  expect((await f.login()).statusCode).toBe(403); f.fail(false); await f.post('resend-verification', { email: 'a@example.com' });
  const token = f.sent.at(-1)!.token;
  expect((await f.post('reset-password', { token, newPassword: 'changed-password' })).statusCode).toBe(422);
  expect((await f.post('verify-email', { token })).statusCode).toBe(200); expect((await f.post('verify-email', { token })).statusCode).toBe(422);
  expect((await f.login()).statusCode).toBe(200);
  f.fail(true); const created = await f.register('C', 'c@example.com'); expect(created.statusCode).toBe(503); expect(created.json().error.code).toBe('REGISTRATION_EMAIL_FAILED');
  expect(await f.db.collection('users').countDocuments()).toBe(2); expect(created.body).not.toMatch(/private|secret|token|Hash/);
  f.fail(false); await f.post('resend-verification', { email: 'c@example.com' }); expect(f.sent.at(-1)?.email).toBe('c@example.com');
});
it('forgot is generic; reset is atomic/single-use, changes password and revokes both current and legacy JWTs', async () => {
  const f = await fixture(); await f.register();
  const generic = await f.post('forgot-password', { email: 'a@example.com' });
  expect((await f.post('forgot-password', { email: 'unknown@example.com' })).body).toBe(generic.body); expect(f.sent).toHaveLength(1);
  await f.post('verify-email', { token: f.sent[0]!.token });
  const login = await f.login(), id = login.json().user.id;
  const legacy = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(id).setIssuer('pm25-api').setAudience('pm25-web').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(testSecret));
  const me = (token: string) => f.app.inject({ url: '/api/v1/users/me', headers: { authorization: 'Bearer ' + token } });
  expect((await me(legacy)).statusCode).toBe(200);
  expect((await f.post('forgot-password', { email: ' A@EXAMPLE.COM ' })).body).toBe(generic.body); const reset = f.sent.at(-1)!.token;
  expect((await f.post('verify-email', { token: reset })).statusCode).toBe(422);
  await f.post('forgot-password', { email: 'a@example.com' }); expect(f.sent).toHaveLength(2);
  await f.db.collection('users').updateOne({}, { $set: { 'passwordReset.expiresAt': new Date(0), 'passwordReset.cooldownUntil': new Date(0) } });
  expect((await f.post('reset-password', { token: reset, newPassword: 'changed-password' })).statusCode).toBe(422);
  await f.post('forgot-password', { email: 'a@example.com' }); const fresh = f.sent.at(-1)!.token;
  const hash = (await f.db.collection('users').findOne())?.passwordHash;
  expect((await f.post('reset-password', { token: 'invalid', newPassword: 'changed-password' })).statusCode).toBe(422);
  const responses = await Promise.all([1, 2].map(() => f.post('reset-password', { token: fresh, newPassword: 'changed-password' })));
  expect(responses.map(r => r.statusCode).sort()).toEqual([200, 422]);
  expect((await f.db.collection('users').findOne())?.passwordHash).not.toBe(hash);
  expect((await f.post('reset-password', { token: fresh, newPassword: 'changed-password' })).statusCode).toBe(422);
  expect((await me(login.json().accessToken)).statusCode).toBe(401); expect((await me(legacy)).statusCode).toBe(401);
  expect((await f.login()).statusCode).toBe(401); const next = await f.login('changed-password'); expect(next.statusCode).toBe(200); expect((await me(next.json().accessToken)).body).not.toMatch(/authVersion|Hash|Verification|emailNormalized/);
  await f.db.collection('users').updateOne({}, { $set: { isActive: false } });
  expect((await f.post('forgot-password', { email: 'a@example.com' })).body).toBe(generic.body); expect((await me(next.json().accessToken)).statusCode).toBe(401);
}, 30000);
it('supports the same atomic email flow on Replica Set without transactions', async () => {
  const repl = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  try { const f = await fixture(repl.getUri('email_repl')); await f.register(); await f.post('verify-email', { token: f.sent[0]!.token }); await f.post('forgot-password', { email: 'a@example.com' }); expect((await f.post('reset-password', { token: f.sent.at(-1)!.token, newPassword: 'changed-password' })).statusCode).toBe(200); expect((await f.login('changed-password')).statusCode).toBe(200); await f.app.close(); } finally { await repl.stop(); }
}, 30000);

it('rate limits each new email/token route before work', async () => {
  const app = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('email_rate'), LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '2' }), logger: false, analysisWorkerEnabled: false }); apps.push(app);
  for (const path of ['register', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password']) {
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'POST', url: '/api/v1/auth/' + path, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/' + path, payload: {} })).statusCode).toBe(429);
  }
});
