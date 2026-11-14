import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { decodeJwt } from 'jose';
import { buildApp } from '../src/app.js';
import { loadTestConfig, testSecret } from './helpers.js';
import { createTokens } from '../src/modules/auth/tokens.js';
import { seedDemo } from '../src/dev/seed-demo.js';

let mongo: MongoMemoryServer;
let client: MongoClient;
const apps: FastifyInstance[] = [];
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '8.2.6' } });
  client = new MongoClient(mongo.getUri());
  await client.connect();
});
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
afterAll(async () => { await client?.close(); await mongo?.stop(); });
const password = 'B2-integration-password';
async function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const database = `b2_test_${randomUUID().replaceAll('-', '')}`;
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri(database), LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '1000', ...overrides });
  const app = buildApp({ config, logger: false });
  apps.push(app);
  await app.ready();
  return { app, config, db: client.db(database) };
}
function register(app: FastifyInstance, username: string, extra: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username, password, ...extra } });
}
function login(app: FastifyInstance, username: string, loginPassword = password) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/tokens', payload: { username, password: loginPassword } });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
function assertPublic(response: LightMyRequestResponse) {
  expect(response.body).not.toMatch(/password|Hash|usernameNormalized|"_id"|jwtSecret|cursorSecret/);
}

describe('B2 real HTTP handlers, actual scrypt/JWT and MongoDB', () => {
  it('registers analyst without token, logs in case-insensitively, restores current user and survives app restart', async () => {
    const { app, config, db } = await fixture();
    const created = await register(app, '  AnalystOne  ');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ data: { id: expect.any(String), username: 'AnalystOne', role: 'analyst', isActive: true } });
    assertPublic(created);
    expect(created.json()).not.toHaveProperty('accessToken');
    const saved = await db.collection('users').findOne({ usernameNormalized: 'analystone' });
    expect(saved?.passwordHash).toMatch(/^\$scrypt\$131072\$8\$1\$/);
    expect(saved?.passwordHash).not.toContain(password);
    const signedIn = await login(app, ' ANALYSTONE ');
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().user).toEqual(created.json().data);
    expect(signedIn.json().tokenType).toBe('Bearer');
    const token: string = signedIn.json().accessToken;
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(3600);
    const me = await app.inject({ url: '/api/v1/users/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200); expect(me.json()).toEqual(created.json()); assertPublic(me);
    await app.close();
    await mongo.stop({ doCleanup: false });
    await mongo.start(true);
    const restarted = buildApp({ config, logger: false }); apps.push(restarted);
    expect((await restarted.inject({ url: '/api/v1/users/me', headers: bearer(token) })).json()).toEqual(created.json());
    expect((await login(restarted, 'analystone')).statusCode).toBe(200);
    expect(await db.collection('users').countDocuments({})).toBe(1);
    expect((await db.collection('users').findOne({ _id: saved!._id }))?.passwordHash).toBe(saved?.passwordHash);
  });

  it('rejects schema violations and concurrent normalized usernames on a fresh DB before duplicates can be stored', async () => {
    const { app, db } = await fixture();
    for (const extra of [{ role: 'admin' }, { isActive: false }, { unknown: 'x' }, { password: 'short' }, { username: '  ' }, { username: 5 }]) {
      const invalid = await register(app, 'new-user', extra);
      expect(invalid.statusCode).toBe(422); assertPublic(invalid);
    }
    const malformed = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(malformed.statusCode).toBe(400);
    const wrongMedia = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { 'content-type': 'application/xml' }, payload: '<user/>' });
    expect(wrongMedia.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/tokens', payload: { username: { $ne: null }, password } })).statusCode).toBe(400);
    const results = await Promise.all(['Concurrent', ' concurrent ', 'CONCURRENT', 'Concurrent'].map(username => register(app, username)));
    expect(results.map(response => response.statusCode).sort()).toEqual([201, 409, 409, 409]);
    expect(await db.collection('users').countDocuments({ usernameNormalized: 'concurrent' })).toBe(1);
    expect((await db.collection('users').listIndexes().toArray()).find(index => index.name === 'uq_users_username_normalized')?.unique).toBe(true);
    for (const response of results) assertPublic(response);
    expect((await register(app, 'concurrent')).statusCode).toBe(409);
    const [registration, internalAdminCreate] = await Promise.allSettled([
      register(app, 'SharedCreation'),
      app.users.createUser({ username: ' SHAREDCREATION ', password, role: 'admin' }),
    ]);
    expect(registration.status).toBe('fulfilled');
    const registerWon = registration.status === 'fulfilled' && registration.value.statusCode === 201;
    expect(internalAdminCreate.status === 'fulfilled').toBe(!registerWon);
    if (internalAdminCreate.status === 'rejected') expect(internalAdminCreate.reason).toMatchObject({ statusCode: 409 });
    else if (registration.status === 'fulfilled') expect(registration.value.statusCode).toBe(409);
    expect(await db.collection('users').countDocuments({ usernameNormalized: 'sharedcreation' })).toBe(1);
  });

  it('uses the same 401 for wrong password, unknown/inactive users, and rejects missing/tampered/expired JWTs', async () => {
    const { app, db } = await fixture();
    const created = await register(app, 'Known');
    const wrong = await login(app, 'Known', 'wrong-password');
    const unknown = await login(app, 'Unknown', 'wrong-password');
    expect(wrong.statusCode).toBe(401); expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.headers['www-authenticate']).toContain('Bearer');
    const signedIn = await login(app, 'known');
    const valid: string = signedIn.json().accessToken;
    const expired = await createTokens(testSecret, () => new Date(Date.now() - 7200_000)).issue(created.json().data.id);
    for (const token of ['', 'invalid', `${valid}x`, expired]) {
      const result = await app.inject({ url: '/api/v1/users/me', headers: token ? bearer(token) : {} });
      expect(result.statusCode).toBe(401); expect(result.headers['www-authenticate']).toContain('Bearer'); assertPublic(result);
    }
    await db.collection('users').updateOne({ _id: new ObjectId(created.json().data.id) }, { $set: { isActive: false } });
    expect((await login(app, 'known')).json()).toEqual(wrong.json());
    expect((await app.inject({ url: '/api/v1/users/me', headers: bearer(valid) })).statusCode).toBe(401);
  });

  it('reads role/isActive from DB on every protected request and prevents stale-token role escalation', async () => {
    const { app, db } = await fixture();
    // Test-only route verifies Server RBAC before the B7 production endpoints exist.
    const config = loadTestConfig({ MONGODB_URI: mongo.getUri(db.databaseName), LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '1000' });
    const guarded = buildApp({ config, logger: false }); apps.push(guarded);
    guarded.register(async scope => { scope.get('/test-admin', { preHandler: scope.authorize(['admin']) }, async () => ({ ok: true })); });
    const created = await register(app, 'RoleUser');
    const token = (await login(app, 'roleuser')).json().accessToken;
    const id = new ObjectId(created.json().data.id);
    expect((await guarded.inject({ url: '/test-admin', headers: { ...bearer(token), 'x-role': 'admin' } })).statusCode).toBe(403);
    await db.collection('users').updateOne({ _id: id }, { $set: { role: 'admin' } });
    expect((await guarded.inject({ url: '/test-admin', headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/users/me', headers: bearer(token) })).json().data.role).toBe('admin');
    await db.collection('users').updateOne({ _id: id }, { $set: { role: 'analyst' } });
    expect((await guarded.inject({ url: '/test-admin', headers: bearer(token) })).statusCode).toBe(403);
    await db.collection('users').deleteOne({ _id: id });
    expect((await app.inject({ url: '/api/v1/datasets', headers: bearer(token) })).statusCode).toBe(401);
  });

  it('rate limits login per IP before password work, returns 429/Retry-After and ignores forged forwarding headers', async () => {
    const { app } = await fixture({ LOGIN_RATE_LIMIT_MAX: '2', LOGIN_RATE_LIMIT_WINDOW_MS: '60000' });
    expect((await login(app, 'missing')).statusCode).toBe(401);
    expect((await login(app, 'missing')).statusCode).toBe(401);
    const limited = await app.inject({ method: 'POST', url: '/api/v1/auth/tokens', headers: { 'x-forwarded-for': '198.51.100.40' }, payload: { username: 'missing', password } });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' } });
    assertPublic(limited);
    const other = await app.inject({ method: 'POST', url: '/api/v1/auth/tokens', remoteAddress: '198.51.100.41', payload: { username: 'missing', password } });
    expect(other.statusCode).toBe(401);
    expect((await app.inject('/api/v1/health')).statusCode).toBe(200);
  });

  it('paginates only imported datasets for both roles with tie-breaks, limits, empty pages and incompatible cursor rejection', async () => {
    const { app, db } = await fixture();
    const created = await register(app, 'DataUser');
    const id = new ObjectId(created.json().data.id);
    const token = (await login(app, 'datauser')).json().accessToken;
    expect((await app.inject({ url: '/api/v1/datasets', headers: bearer(token) })).json()).toEqual({ data: [], page: { limit: 100, nextCursor: null } });
    const datasets = await seedDatasetCases(db, id);
    for (const role of ['analyst', 'admin']) {
      await db.collection('users').updateOne({ _id: id }, { $set: { role } });
      for (const direction of ['asc', 'desc']) {
        let cursor: string | null = null;
        const ids: string[] = [];
        do {
          const response: LightMyRequestResponse = await app.inject({ url: `/api/v1/datasets?sort=createdAt:${direction}&limit=2${cursor ? `&cursor=${cursor}` : ''}`, headers: bearer(token) });
          expect(response.statusCode).toBe(200); assertPublic(response);
          const page: { data: { id: string; status: string }[]; page: { limit: number; nextCursor: string | null } } = response.json();
          expect(page.page.limit).toBe(2);
          expect(page.data.length).toBeLessThanOrEqual(2);
          expect(page.data.every((item: { status: string }) => item.status === 'imported')).toBe(true);
          ids.push(...page.data.map((item: { id: string }) => item.id));
          cursor = page.page.nextCursor;
        } while (cursor);
        const expected = datasets.map(item => item._id.toHexString());
        expect(ids).toEqual(direction === 'asc' ? expected : expected.reverse());
        expect(new Set(ids).size).toBe(datasets.length);
      }
    }
    const defaultPage = await app.inject({ url: '/api/v1/datasets', headers: bearer(token) });
    expect(defaultPage.body).not.toMatch(/storagePath|internal-path|fieldMapping|private/);
    expect(defaultPage.json().page.limit).toBe(100);
    expect(defaultPage.json().data[0].id).toBe(datasets.at(-1)!._id.toHexString());
    const firstPage = await app.inject({ url: '/api/v1/datasets?limit=1', headers: bearer(token) });
    const cursor = firstPage.json().page.nextCursor;
    for (const suffix of ['limit=0', 'limit=201', 'limit=1.5', 'sort=name:asc', 'cursor=bad', 'unknown=1', `sort=createdAt:asc&cursor=${cursor}`]) {
      expect((await app.inject({ url: `/api/v1/datasets?${suffix}`, headers: bearer(token) })).statusCode).toBe(400);
    }
    expect((await app.inject('/api/v1/datasets')).statusCode).toBe(401);
    const restarted = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri(db.databaseName), LOG_LEVEL: 'silent' }), logger: false }); apps.push(restarted);
    expect((await restarted.inject({ url: `/api/v1/datasets?limit=1&cursor=${cursor}`, headers: bearer(token) })).statusCode).toBe(200);
  });

  it('bootstraps analyst/admin through the common User service without default passwords or resetting existing users', async () => {
    const { app, db } = await fixture();
    await expect(seedDemo(db, {})).rejects.toThrow('required');
    await expect(seedDemo(db, { SEED_ADMIN_USERNAME: 'same', SEED_ADMIN_PASSWORD: password, SEED_ANALYST_USERNAME: 'SAME', SEED_ANALYST_PASSWORD: password })).rejects.toThrow('differ');
    const env = { SEED_ADMIN_USERNAME: 'AdminSeed', SEED_ADMIN_PASSWORD: password, SEED_ANALYST_USERNAME: 'AnalystSeed', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'true' };
    const seeded = await seedDemo(db, env);
    const snapshot = await db.collection('users').findOne({ usernameNormalized: 'adminseed' });
    const again = await seedDemo(db, { ...env, SEED_ADMIN_PASSWORD: 'different-password' });
    expect(again).toEqual(seeded);
    expect(await db.collection('users').countDocuments({})).toBe(2);
    expect((await db.collection('users').findOne({ usernameNormalized: 'adminseed' }))?.passwordHash).toBe(snapshot?.passwordHash);
    for (const [username, role] of [['AdminSeed', 'admin'], ['AnalystSeed', 'analyst']]) {
      const signedIn = await login(app, username!);
      expect(signedIn.statusCode).toBe(200); expect(signedIn.json().user.role).toBe(role);
      const response = await app.inject({ url: '/api/v1/datasets', headers: bearer(signedIn.json().accessToken) });
      expect(response.json().data[0].name).toContain('[SEED B2]');
      expect(response.json().data[0].sourceFilename).toContain('[seed-b2]');
    }
    await db.collection('users').updateOne({ _id: new ObjectId(seeded.admin.id) }, { $set: { isActive: false } });
    await expect(seedDemo(db, env)).rejects.toThrow('incompatible');
  });
});

async function seedDatasetCases(db: Db, createdBy: ObjectId) {
  const imported = Array.from({ length: 5 }, (_, index) => ({ _id: new ObjectId(), name: `[SEED B2 TEST] ${index}`, sourceFilename: '[seed] fixture.csv',
    createdBy, createdAt: new Date(index < 3 ? '2026-11-14T00:00:00Z' : '2026-11-14T01:00:00Z'), status: 'imported',
    storagePath: 'internal-path', fieldMapping: { secret: 'private' },
    importSummary: { totalRows: 0, importedRows: 0, duplicateRows: 0, conflictingRows: 0, invalidRows: 0, issues: [] },
  }));
  const others = ['uploaded', 'awaiting_mapping', 'importing', 'failed'].map(status => ({ ...imported[0]!, _id: new ObjectId(), status }));
  await db.collection('datasets').insertMany([...imported, ...others]);
  return imported;
}
