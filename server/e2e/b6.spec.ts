import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';

let mongo: MongoMemoryReplSet, backend: FastifyInstance, vite: ChildProcess;
let frontendUrl: string, backendUrl: string, storage: string;
const password = 'B6-browser-test-only-password';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-b6-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b6_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' }), logger: false });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'B6Admin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'B6Analyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false' });
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: fileURLToPath(new URL('../../client', import.meta.url)), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, VITE_DATA_MODE: 'online', VITE_API_BASE_URL: `${backendUrl}/api/v1`, VITE_MAPBOX_TOKEN: '' },
  });
  await expect.poll(async () => { try { return (await fetch(frontendUrl)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
});
test.afterAll(async () => {
  if (vite && vite.exitCode === null) { const exited = new Promise<void>(resolve => vite.once('exit', () => resolve())); vite.kill(); await exited; }
  await backend?.close(); await mongo?.stop();
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-b6-browser-')) await rm(storage, { recursive: true, force: true });
});

test('Beijing CSV → actual B5 results → B6 review conflict → explicit resolution → reload', async ({ page, request }) => {
  test.setTimeout(90000);
  const analysisErrors: number[] = [];
  page.on('response', response => { if (response.url().includes('/api/v1/analysis-runs') && response.status() >= 400) analysisErrors.push(response.status()); });
  await page.goto(`${frontendUrl}/login`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('B6Analyst');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(`${frontendUrl}/datasets`);
  await page.goto(`${frontendUrl}/datasets/import`);
  await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'beijing-12-stations-demo-2015-03.csv', mimeType: 'text/csv',
    buffer: await readFile(new URL('../tests/fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url)) });
  await page.getByLabel('Tên dataset (tùy chọn)', { exact: true }).fill('B6 Beijing 12 stations actual import');
  const upload = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/datasets` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const datasetId = (await (await upload).json()).data.id;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Mở workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByRole('checkbox').check();
  const accepted = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/analysis-runs` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Gửi analysis', exact: true }).click();
  const response = await accepted; expect(response.status()).toBe(202); const runId = (await response.json()).data.id;
  await expect(page.getByTestId('run-status')).toHaveText('Trạng thái Server: completed', { timeout: 25000 });
  const persisted = await backend.mongo.db.collection('anomalies').find({ analysisRunId: new ObjectId(runId) }).sort({ ts: 1, _id: 1 }).toArray();
  expect(persisted.length).toBeGreaterThan(0);
  const anomalyId = String(persisted[0]!._id);
  await page.getByRole('button', { name: 'Anomalies', exact: true }).click();
  await page.getByRole('button', { name: `Review ${anomalyId}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Chi tiết ${anomalyId}`, exact: true })).toBeVisible();
  await page.getByLabel('Review status', { exact: true }).selectOption('false_positive');
  await page.getByLabel('Ghi chú', { exact: true }).fill('Bản Analyst A giữ qua xung đột');
  // Independent HTTP client B commits first against the actual DB; no route interception.
  const login = await request.post(`${backendUrl}/api/v1/auth/tokens`, { data: { username: 'B6Admin', password } });
  expect(login.status()).toBe(200);
  const headers = { authorization: `Bearer ${(await login.json()).accessToken}` };
  const second = await request.patch(`${backendUrl}/api/v1/anomalies/${anomalyId}`, { headers, data: { baseVersion: 1, changes: { status: 'confirmed', note: 'Client B saved first' } } });
  expect(second.status()).toBe(200); expect((await second.json()).data.version).toBe(2);
  const stale = page.waitForResponse(r => r.url().endsWith(`/anomalies/${anomalyId}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Lưu review', exact: true }).click(); expect((await stale).status()).toBe(409);
  await expect(page.getByText('Xung đột phiên bản. Không tự ghi đè hoặc tự gửi lại.', { exact: true })).toBeVisible();
  await expect(page.getByText('Server v2: confirmed · Client B saved first', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Bản Analyst A giữ qua xung đột');
  await page.getByRole('button', { name: 'Giữ bản sửa trên version mới', exact: true }).click();
  await page.getByRole('button', { name: 'Lưu review', exact: true }).click();
  await expect(page.getByText('Server đã xác nhận lưu review.', { exact: true })).toBeVisible();
  const stored = await backend.mongo.db.collection('anomalies').findOne({ _id: new ObjectId(anomalyId) });
  expect(stored).toMatchObject({ status: 'false_positive', note: 'Bản Analyst A giữ qua xung đột', version: 3 });
  for (const key of ['score', 'severity', 'method', 'readingId']) expect(stored![key]).toEqual(persisted[0]![key]);
  await page.reload();
  await page.getByRole('button', { name: 'Anomalies', exact: true }).click();
  await page.getByRole('button', { name: `Review ${anomalyId}`, exact: true }).click();
  await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Bản Analyst A giữ qua xung đột');
  await expect(page.getByLabel('Review status', { exact: true })).toHaveValue('false_positive');
  await expect(page.getByText('Version 3', { exact: false })).toBeVisible();
  expect(analysisErrors).toEqual([]);
  expect(await backend.mongo.db.collection('readings').countDocuments({ datasetId: new ObjectId(datasetId) })).toBe(8782);
});
