import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';

let mongo: MongoMemoryServer | undefined;
let backend: FastifyInstance | undefined;
let vite: ChildProcess | undefined;
let frontendUrl: string;
let backendUrl: string;
const password = 'B2-browser-test-password';
const seedName = '[SEED B2] Metadata demo — not a real import';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const portProbe = createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = (portProbe.address() as AddressInfo).port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryServer.create({ binary: { version: '8.2.6' } });
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b2_browser_test'),
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '1000',
  }), logger: false });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'BrowserAdmin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'BrowserAnalyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'true',
  });
  // Actual online Vite build pipeline + browser fetch/CORS, never page.route or mock transport.
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: fileURLToPath(new URL('../../client', import.meta.url)),
    env: { ...process.env, VITE_DATA_MODE: 'online', VITE_API_BASE_URL: `${backendUrl}/api/v1`, VITE_MAPBOX_TOKEN: '' },
    stdio: 'ignore', windowsHide: true,
  });
  await expect.poll(async () => {
    try { return (await fetch(frontendUrl)).status; } catch { return 0; }
  }, { timeout: 30_000 }).toBe(200);
});
test.afterAll(async () => {
  if (vite && vite.exitCode === null) {
    const exited = new Promise<void>(resolve => vite!.once('exit', () => resolve()));
    vite.kill(); await exited;
  }
  await backend?.close();
  await mongo?.stop();
});

test('Register → Login → reload/me → datasets/workspace → admin/401 uses the actual Backend and DB', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().startsWith(backendUrl)) requests.push(new URL(request.url()).pathname); });
  await page.goto(`${frontendUrl}/register`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BrowserNew');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  const registration = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/auth/register` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  expect((await registration).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.auth.online'))).toBeNull();
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BROWSERNEW');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('không đúng');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText(seedName, { exact: true })).toBeVisible();
  await expect(page.getByText('DỮ LIỆU MÔ PHỎNG', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Quản lý tài khoản' })).toHaveCount(0);
  const restored = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/users/me`);
  await page.reload();
  expect((await restored).status()).toBe(200);
  await expect(page.getByText(seedName, { exact: true })).toBeVisible();
  await page.getByLabel('Sắp xếp').selectOption('createdAt:asc');
  await expect(page.getByText(seedName, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Mở dữ liệu', exact: true }).click();
  await expect(page.getByRole('heading', { name: seedName, exact: true })).toBeVisible();
  // B4 now serves Query; this metadata-only B2 seed has no readings.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dataset Workspace', exact: true })).toBeVisible();
  await expect(page.getByText('Chưa có metadata dataset.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.auth.online'))).toBeNull();
  await page.goto(`${frontendUrl}/register`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('browsernew');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('đã tồn tại');
  await page.goto(`${frontendUrl}/login`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BrowserAdmin');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Quản lý tài khoản' })).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem('pm25.auth.online'));
  expect(token).toBeTruthy();
  const me = await (await fetch(`${backendUrl}/api/v1/users/me`, { headers: { authorization: `Bearer ${token}` } })).json() as { data: { id: string } };
  await backend!.mongo.db.collection('users').updateOne({ _id: new ObjectId(me.data.id) }, { $set: { isActive: false } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.auth.online'))).toBeNull();
  expect(requests).toEqual(expect.arrayContaining(['/api/v1/auth/register', '/api/v1/auth/tokens', '/api/v1/users/me', '/api/v1/datasets']));
});
