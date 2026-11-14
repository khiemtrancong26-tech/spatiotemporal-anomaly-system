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

let mongo: MongoMemoryReplSet | undefined;
let backend: FastifyInstance | undefined;
let vite: ChildProcess | undefined;
let frontendUrl: string;
let backendUrl: string;
const password = 'B2-browser-test-password';
let storage: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const portProbe = createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = (portProbe.address() as AddressInfo).port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-b4-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b4_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_MAX: '1000',
  }), logger: false });
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
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-b4-browser-')) await rm(storage, { recursive: true, force: true });
});

test('real B3 import → B4 Workspace filters, UTC+07, both view choices, sensor references and empty result', async ({ page }) => {
  const errors: number[] = [];
  page.on('response', response => { if (/\/api\/v1\/(?:readings|sensors)\?/.test(response.url()) && response.status() !== 200) errors.push(response.status()); });
  await page.goto(`${frontendUrl}/login`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('BrowserAnalyst');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(`${frontendUrl}/datasets`);
  await page.goto(`${frontendUrl}/datasets/import`);
  await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'b4-boundaries.csv', mimeType: 'text/csv',
    buffer: await readFile(new URL('../tests/fixtures/b4-boundaries.csv', import.meta.url)) });
  await page.getByLabel('Tên dataset (tùy chọn)', { exact: true }).fill('B4 actual boundary import');
  const uploaded = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/datasets` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const datasetId = (await (await uploaded).json()).data.id;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mở workspace', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Mở workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'B4 actual boundary import', exact: true })).toBeVisible();
  await expect(page.getByText('Đã tải 8 readings', { exact: false })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.getByLabel('Vùng bbox', { exact: true }).fill('106,10,107,11');
  await page.getByLabel('Từ · UTC+07', { exact: true }).fill('2026-11-14T07:00:00');
  await page.getByLabel('Đến · UTC+07', { exact: true }).fill('2026-11-14T08:00:00');
  const filtered = page.waitForResponse(response => response.url().includes('/api/v1/readings?') && new URL(response.url()).searchParams.has('from'));
  await page.getByRole('button', { name: 'Áp dụng bộ lọc', exact: true }).click();
  const actualResponse = await filtered; expect(actualResponse.status()).toBe(200);
  expect(new URL(actualResponse.url()).searchParams.get('from')).toBe('2026-11-14T00:00:00.000Z');
  expect((await actualResponse.json()).data).toHaveLength(5);
  await expect(page.getByText('Đã tải 5 readings', { exact: false })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  const selectedId = (await actualResponse.json()).data[0].id;
  await page.getByRole('button', { name: `Chọn ${selectedId}`, exact: true }).click();
  await expect(page.getByText(`Reading: ${selectedId}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mapbox 3D', exact: true }).click();
  await expect(page.getByText('Chưa cấu hình Mapbox token.', { exact: false })).toBeVisible();
  await expect(page.getByText(`Reading: ${selectedId}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await expect(page.getByText(`Reading: ${selectedId}`, { exact: true })).toBeVisible();
  const sensor = await backend!.mongo.db.collection('sensors').findOne({ datasetId: new ObjectId(datasetId), externalId: 'C' });
  if (!sensor) throw new Error('Missing imported sensor');
  await page.getByText('Trạm trong dataset/vùng đã áp dụng', { exact: false }).click();
  await page.getByLabel('Chọn trạm đã tải').selectOption(sensor._id.toHexString());
  await expect(page.getByText('Đã tải 2 readings', { exact: false })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Thứ tự thời gian').selectOption('ts:desc');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Vùng bbox', { exact: true }).fill('0,0,1,1');
  await page.getByRole('button', { name: 'Áp dụng bộ lọc', exact: true }).click();
  await expect(page.getByText('Không có readings phù hợp.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  // Reload queries the ID from the URL; metadata recovery remains the FE's existing behavior.
  await page.reload();
  await expect(page.getByText('Đã tải 8 readings', { exact: false })).toBeVisible();
});
