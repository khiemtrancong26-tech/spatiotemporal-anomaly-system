import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';

let mongo: MongoMemoryReplSet | undefined;
let backend: FastifyInstance | undefined;
let vite: ChildProcess | undefined;
let frontendUrl: string;
let backendUrl: string;
const password = 'B2-browser-test-password';
let storage: string;
let rejectNextBatch = false;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const portProbe = createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = (portProbe.address() as AddressInfo).port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-b3-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b3_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '1000',
  }), logger: false, importTestHooks: { afterBatch: async () => {
    if (rejectNextBatch) { rejectNextBatch = false; throw new Error('B3 browser fault after actual batch commit'); }
  } } });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'BrowserAdmin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'BrowserAnalyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false',
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
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-b3-browser-')) await rm(storage, { recursive: true, force: true });
});

test('Upload → validation → mapping → import → Datasets uses actual files/API/replica set', async ({ page }) => {
  await page.goto(`${frontendUrl}/login`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BrowserAnalyst');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(`${frontendUrl}/datasets`);
  await page.goto(`${frontendUrl}/datasets/import`);
  await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'browser.csv', mimeType: 'text/csv',
    buffer: Buffer.from('sensorId,latitude,longitude,timestamp,value\nA,10,106,2026-01-01T00:00:00Z,0\nA,10,106,2026-01-01T07:00:00+07:00,0\nA,10,106,2026-01-01T00:00:00Z,8\nB,11,107,2026-01-02T00:00:00Z,-1\n') });
  await page.getByLabel('Tên dataset (tùy chọn)', { exact: true }).fill('B3 browser actual import');
  const uploaded = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/datasets` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const uploadResponse = await uploaded; expect(uploadResponse.status()).toBe(201);
  const id = (await uploadResponse.json()).data.id;
  await expect(page.getByText('Tổng 4 dòng · Hợp lệ 4 · Không hợp lệ 0', { exact: true })).toBeVisible();
  await expect(page.getByText('Trước khi lưu mapping, số liệu chỉ phản ánh cấu trúc dòng.', { exact: false })).toBeVisible();
  await page.getByRole('checkbox').check();
  const saved = page.waitForResponse(response => response.url().endsWith(`/datasets/${id}/mapping`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Tổng 4 dòng · Hợp lệ 3 · Không hợp lệ 1', { exact: true })).toBeVisible();
  const imported = page.waitForResponse(response => response.url().endsWith(`/datasets/${id}/imports`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const response = await imported; expect(response.status()).toBe(200);
  expect((await response.json()).data.importSummary).toMatchObject({ totalRows: 4, importedRows: 1, duplicateRows: 1, conflictingRows: 1, invalidRows: 1 });
  await expect(page.getByText('Đã nhập: 1 · Trùng hoàn toàn: 1 · Xung đột: 1 · Không hợp lệ: 1', { exact: true })).toBeVisible();
  expect(await backend!.mongo.db.collection('readings').countDocuments({ datasetId: new ObjectId(id) })).toBe(1);
  await page.getByRole('link', { name: 'Về Datasets', exact: true }).click();
  await expect(page.getByText('B3 browser actual import', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('B3 browser actual import', { exact: true })).toBeVisible();
});

test('failed import requires status read and explicit new intent after actual cleanup', async ({ page }) => {
  const keys: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/imports')) keys.push(request.headers()['idempotency-key']!); });
  await page.goto(`${frontendUrl}/login`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BrowserAnalyst');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(`${frontendUrl}/datasets`);
  await page.goto(`${frontendUrl}/datasets/import`);
  await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'retry.csv', mimeType: 'text/csv',
    buffer: Buffer.from('sensorId,latitude,longitude,timestamp,value\nA,10,106,2026-01-01T00:00:00Z,0\n') });
  const uploaded = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/datasets` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const id = (await (await uploaded).json()).data.id;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  rejectNextBatch = true;
  const failed = page.waitForResponse(response => response.url().endsWith(`/datasets/${id}/imports`));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  expect((await failed).status()).toBe(503);
  await page.getByRole('button', { name: 'Đọc lại trạng thái / validation', exact: true }).click();
  await expect(page.getByText(`Dataset ID: ${id} · Trạng thái: failed`, { exact: true })).toBeVisible();
  expect(await backend!.mongo.db.collection('readings').countDocuments({ datasetId: new ObjectId(id) })).toBe(0);
  await page.getByRole('button', { name: 'Chuẩn bị lần nhập mới sau cleanup', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeEnabled();
  expect(keys).toHaveLength(1);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mở workspace', exact: true })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).not.toBe(keys[1]);
  expect(await backend!.mongo.db.collection('readings').countDocuments({ datasetId: new ObjectId(id) })).toBe(1);
});
