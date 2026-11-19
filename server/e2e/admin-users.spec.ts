import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';
let mongo: MongoMemoryReplSet, backend: FastifyInstance, vite: ChildProcess, frontendUrl: string, backendUrl: string;
const password = 'B7-browser-test-only-password';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve())); frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b7_browser'), CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent' }), logger: false, analysisWorkerEnabled: false,
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
});
test('Desktop Admin real list → create → edit → reload persists without mocked API responses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(frontendUrl + '/login'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BrowserAdmin'); await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(page).toHaveURL(frontendUrl + '/datasets');
  await page.goto(frontendUrl + '/admin/users'); await expect(page.getByRole('button', { name: 'Sửa BrowserAdmin', exact: true })).toBeVisible();
  await page.getByLabel('Username mới', { exact: true }).fill('CreatedInBrowser'); await page.getByLabel('Mật khẩu mới', { exact: true }).fill(password);
  const created = page.waitForResponse(r => r.url() === backendUrl + '/api/v1/admin/users' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Tạo user', exact: true }).click(); const response = await created; expect(response.status()).toBe(201); expect(response.request().headers()['idempotency-key']).toBeTruthy();
  await page.getByRole('button', { name: 'Sửa CreatedInBrowser', exact: true }).click(); await page.getByLabel('Role', { exact: true }).selectOption('admin');
  const updated = page.waitForResponse(r => r.url().includes('/api/v1/admin/users/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Lưu tài khoản', exact: true }).click(); expect((await updated).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('Server đã xác nhận'); await page.reload();
  await page.getByRole('button', { name: 'Sửa CreatedInBrowser', exact: true }).click(); await expect(page.getByLabel('Role', { exact: true })).toHaveValue('admin');
  await page.getByLabel('Đang hoạt động', { exact: true }).uncheck(); await page.getByRole('button', { name: 'Lưu tài khoản', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Server đã xác nhận'); await page.reload();
  await page.getByRole('button', { name: 'Sửa CreatedInBrowser', exact: true }).click(); await expect(page.getByLabel('Đang hoạt động', { exact: true })).not.toBeChecked();
  const user = await backend.mongo.db.collection('users').findOne({ usernameNormalized: 'createdinbrowser' }); expect(user).toMatchObject({ role: 'admin', isActive: false });
});
