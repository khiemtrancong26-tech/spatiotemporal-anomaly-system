import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadTestConfig } from './helpers.js';
import { createTokens } from '../src/modules/auth/tokens.js';
let mongo: MongoMemoryReplSet; const apps: FastifyInstance[] = [];
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } }); });
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
afterAll(async () => { await mongo?.stop(); });
const password = 'B7-test-only-password';
async function fixture() {
  const config = loadTestConfig({ MONGODB_URI: mongo.getUri('b7_' + randomUUID().replaceAll('-', '')), LOG_LEVEL: 'silent' });
  const app = buildApp({ config, logger: false, analysisWorkerEnabled: false, emailSender: { verification: async () => {}, reset: async () => {} } }); apps.push(app); await app.ready();
  const root = await app.users.createUser({ username: 'Root', password, role: 'admin' }), analyst = await app.users.createUser({ username: 'Analyst', password, role: 'analyst' });
  const tokens = createTokens(config.jwtSecret), adminToken = await tokens.issue(root.id), analystToken = await tokens.issue(analyst.id);
  const headers = (token: string) => ({ authorization: 'Bearer ' + token });
  const list = (query = '', token = adminToken) => app.inject({ url: '/api/v1/admin/users' + query, headers: headers(token) });
  const create = (username: string, key: string = randomUUID(), role: 'admin' | 'analyst' = 'analyst', token = adminToken) => app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: { ...headers(token), 'idempotency-key': key }, payload: { username, password, role } });
  const patch = (id: string, changes: object, token = adminToken) => app.inject({ method: 'PATCH', url: '/api/v1/admin/users/' + id, headers: headers(token), payload: changes });
  return { app, db: app.mongo.db, root, analyst, tokens, adminToken, analystToken, list, create, patch };
}
it('enforces JWT/Admin on all three operations, accepts admin create/update and keeps old tokens tied to DB role/active state', async () => {
  const f = await fixture();
  for (const method of ['GET', 'POST', 'PATCH'] as const) {
    const url = '/api/v1/admin/users' + (method === 'PATCH' ? '/' + f.analyst.id : '');
    const request = { method, url, ...(method === 'POST' ? { payload: { username: 'New', password, role: 'analyst' } } : method === 'PATCH' ? { payload: { role: 'admin' } } : {}) };
    for (const token of ['', 'bad']) expect((await f.app.inject({ ...request, headers: token ? { authorization: 'Bearer ' + token } : {} })).statusCode).toBe(401);
    expect((await f.app.inject({ ...request, headers: { authorization: 'Bearer ' + f.analystToken } })).statusCode).toBe(403);
  }
  expect((await f.create('New')).statusCode).toBe(201);
  expect((await f.patch(f.analyst.id, { role: 'admin' })).statusCode).toBe(200);
  expect((await f.list('', f.analystToken)).statusCode).toBe(200);
  expect((await f.patch(f.analyst.id, { role: 'analyst' })).statusCode).toBe(200);
  expect((await f.list('', f.analystToken)).statusCode).toBe(403);
  expect((await f.patch(f.analyst.id, { isActive: false })).statusCode).toBe(200);
  expect((await f.list('', f.analystToken)).statusCode).toBe(401);
});
it('creates with common scrypt/username rules and atomic 24h receipts; duplicate and same-key races do not duplicate effects', async () => {
  const f = await fixture(), key = randomUUID();
  const responses = await Promise.all([f.create('  NewAdmin  ', key, 'admin'), f.create('  NewAdmin  ', key, 'admin')]);
  expect(responses.map(r => r.statusCode)).toEqual([201, 201]); expect(responses[0]!.body).toBe(responses[1]!.body);
  expect(await f.db.collection('users').countDocuments({ usernameNormalized: 'newadmin' })).toBe(1);
  expect((await f.create('Changed', key)).statusCode).toBe(422);
  expect((await f.create('newADMIN')).statusCode).toBe(409);
  expect(responses[0]!.body).not.toMatch(/Hash|password|Normalized|authVersion|Fence|_id/);
  const saved = await f.db.collection('users').findOne({ usernameNormalized: 'newadmin' }); expect(saved?.passwordHash).toMatch(/^\$scrypt\$/);
  expect(saved?.emailVerificationRequired).toBeUndefined();
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/tokens', payload: { username: 'newadmin', password } }); expect(login.statusCode).toBe(200);
  expect((await f.patch(responses[0]!.json().data.id, { isActive: false })).statusCode).toBe(200);
  expect((await f.create('  NewAdmin  ', key, 'admin')).body).toBe(responses[0]!.body);
  await f.db.collection('idempotencyReceipts').updateOne({ key }, { $set: { expiresAt: new Date(0) } }); expect((await f.create('  NewAdmin  ', key, 'admin')).statusCode).toBe(409);
  const race = await Promise.all([f.create('Shared'), f.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'shared', email: 'shared@example.com', password } })]);
  // Gmail is deliberately not invoked: this test app injects a fake sender below.
  expect(race.map(r => r.statusCode).sort()).toEqual([201, 409]); expect(await f.db.collection('users').countDocuments({ usernameNormalized: 'shared' })).toBe(1);
}, 30000);
it('lists by normalized username in both directions with bound cursors and strict public responses', async () => {
  const f = await fixture(); await f.create('zeta'); await f.create('Bravo');
  for (const sort of ['username:asc', 'username:desc']) {
    let cursor: string | null = null; const names: string[] = [];
    do { const r = await f.list(`?sort=${sort}&limit=2${cursor ? '&cursor=' + cursor : ''}`); expect(r.statusCode, r.body).toBe(200);
      expect(r.body).not.toMatch(/password|Hash|Normalized|Fence|email|authVersion|_id/); names.push(...r.json().data.map((u: { username: string }) => u.username.toLowerCase())); cursor = r.json().page.nextCursor;
      if (cursor) expect((await f.list('?sort=' + (sort === 'username:asc' ? 'username:desc' : 'username:asc') + '&cursor=' + cursor)).statusCode).toBe(400);
    } while (cursor);
    expect(names).toEqual(sort === 'username:asc' ? ['analyst', 'bravo', 'root', 'zeta'] : ['zeta', 'root', 'bravo', 'analyst']);
  }
  for (const query of ['?limit=201', '?limit=1e2', '?sort=role:asc', '?search=x', '?cursor=bad']) expect((await f.list(query)).statusCode).toBe(400);
});
it('rejects invalid payloads/missing users and serializes two self-removals so one active admin always survives', async () => {
  const f = await fixture();
  for (const changes of [{}, { isActive: 'false' }, { role: 'viewer' }, { username: 'renamed' }, { password: 'reset-not-supported' }]) expect((await f.patch(f.root.id, changes)).statusCode).toBe(422);
  expect((await f.patch('opaque', { isActive: false })).statusCode).toBe(404);
  expect((await f.patch(String(new ObjectId()), { role: 'admin' })).statusCode).toBe(404);
  for (const changes of [{ isActive: false }, { role: 'analyst' }]) expect((await f.patch(f.root.id, changes)).json().error.code).toBe('LAST_ACTIVE_ADMIN');
  expect((await f.app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: { authorization: 'Bearer ' + f.adminToken }, payload: { username: 'NoKey', password, role: 'admin' } })).statusCode).toBe(400);
  const second = await f.create('Other', undefined, 'admin'); expect(second.statusCode).toBe(201); const id = second.json().data.id;
  const result = await Promise.all([f.patch(f.root.id, { role: 'analyst' }), f.patch(id, { isActive: false }, await f.tokens.issue(id))]);
  expect(result.map(r => r.statusCode).sort()).toEqual([200, 409]); expect(await f.db.collection('users').countDocuments({ role: 'admin', isActive: true })).toBe(1);
});
