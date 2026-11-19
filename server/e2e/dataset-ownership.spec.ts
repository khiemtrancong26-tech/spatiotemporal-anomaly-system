import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';
let storage: string;
let mongo: MongoMemoryReplSet, backend: FastifyInstance, vite: ChildProcess, frontendUrl: string, backendUrl: string;
const password = 'Ownership-browser-test-only-password';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve())); frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(join(tmpdir(), 'pm25-private-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('private_browser'), IMPORT_STORAGE_DIR: storage, CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent' }), logger: false, analysisWorkerEnabled: false,
    emailSender: { verification: async () => {}, reset: async () => {} } });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'BrowserAdmin', SEED_ADMIN_PASSWORD: password, SEED_ANALYST_USERNAME: 'BrowserAnalyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false' });
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: fileURLToPath(new URL('../../client', import.meta.url)), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, VITE_DATA_MODE: 'online', VITE_API_BASE_URL: backendUrl + '/api/v1', VITE_MAPBOX_TOKEN: '' },
  });
  await expect.poll(async () => { try { return (await fetch(frontendUrl)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
});
test.afterAll(async () => {
  if (vite && vite.exitCode === null) { const exited = new Promise<void>(resolve => vite.once('exit', () => resolve())); vite.kill(); await exited; }
  await backend?.close(); await mongo?.stop();
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-private-browser-')) await rm(storage, { recursive: true, force: true });
});
test('Desktop A logout → B login uses private lists/cache and Admin sees both via real API', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await backend.users.createUser({ username: 'BrowserB', password, role: 'analyst' });
  const ids: string[] = [];
  for (const [username, filename] of [['BrowserAnalyst', 'PRIVATE-A'], ['BrowserB', 'PRIVATE-B']]) {
    const token = (await (await request.post(backendUrl + '/api/v1/auth/tokens', { data: { username, password } })).json()).accessToken;
    const headers = { authorization: 'Bearer ' + token };
    const csv = Buffer.from('sensorId,latitude,longitude,timestamp,value\nS,10,106,2026-01-01T00:00:00Z,1\nS,10,106,2026-01-01T01:00:00Z,2');
    const upload = await request.post(backendUrl + '/api/v1/datasets', { headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, multipart: { file: { name: filename + '.csv', mimeType: 'text/csv', buffer: csv } } }); expect(upload.status()).toBe(201);
    const id = (await upload.json()).data.id; ids.push(id);
    expect((await request.put(`${backendUrl}/api/v1/datasets/${id}/mapping`, { headers, data: { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3' } })).status()).toBe(200);
    expect((await request.post(`${backendUrl}/api/v1/datasets/${id}/imports`, { headers: { ...headers, 'idempotency-key': crypto.randomUUID() } })).status()).toBe(200);
  }
  async function login(username: string) { await page.goto(frontendUrl + '/login'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username); await page.getByLabel('Mật khẩu', { exact: true }).fill(password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(page).toHaveURL(frontendUrl + '/datasets'); }
  await login('BrowserAnalyst'); await expect(page.getByText('PRIVATE-A.csv', { exact: true }).first()).toBeVisible(); await expect(page.getByText('PRIVATE-B.csv', { exact: true })).toHaveCount(0);
  await page.goto(frontendUrl + '/workspace/' + ids[0]);
  const readings = page.waitForResponse(r => r.url().includes('/api/v1/readings?') && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Visualization', exact: true }).click(); await readings;
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await login('BrowserB');
  await expect(page.getByText('PRIVATE-B.csv', { exact: true }).first()).toBeVisible(); await expect(page.getByText('PRIVATE-A.csv', { exact: true })).toHaveCount(0);
  const denied = page.waitForResponse(r => r.url().includes(`/api/v1/datasets/${ids[0]}/profile`)); await page.goto(frontendUrl + '/workspace/' + ids[0]); expect((await denied).status()).toBe(422);
  await expect(page.getByText('PRIVATE-A.csv', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await login('BrowserAdmin');
  await expect(page.getByText('PRIVATE-A.csv', { exact: true }).first()).toBeVisible(); await expect(page.getByText('PRIVATE-B.csv', { exact: true }).first()).toBeVisible();
});
