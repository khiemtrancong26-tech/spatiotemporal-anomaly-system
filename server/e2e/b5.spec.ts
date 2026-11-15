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

let mongo: MongoMemoryReplSet, backend: FastifyInstance, vite: ChildProcess;
let frontendUrl: string, backendUrl: string, storage: string;
const password = 'B5-browser-test-only-password';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-b5-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b5_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' }), logger: false });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'B5Admin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'B5Analyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false' });
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
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-b5-browser-')) await rm(storage, { recursive: true, force: true });
});

test('actual B3 import → M5 statistical submission, polling, history and reload; B6 remains unavailable', async ({ page }) => {
  const analysisErrors: number[] = [];
  page.on('response', response => { if (response.url().includes('/api/v1/analysis-runs') && response.status() >= 400) analysisErrors.push(response.status()); });
  await page.goto(`${frontendUrl}/login`);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('B5Analyst');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(`${frontendUrl}/datasets`);
  await page.goto(`${frontendUrl}/datasets/import`);
  const values = [...Array.from({ length: 149 }, (_, i) => i % 3 + 1), 100];
  const csv = `sensorId,latitude,longitude,timestamp,value\n${values.map((value, i) => `A,10,106,${new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()},${value}`).join('\n')}\n`;
  await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'b5.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Tên dataset (tùy chọn)', { exact: true }).fill('B5 actual 150 readings');
  const upload = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/datasets` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const datasetId = (await (await upload).json()).data.id;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('link', { name: 'Mở workspace', exact: true }).click();
  await expect(page.getByText('Đã tải 100 readings', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByLabel('Phương pháp', { exact: true }).selectOption('zscore');
  await page.getByRole('checkbox').check();
  const accepted = page.waitForResponse(response => response.url() === `${backendUrl}/api/v1/analysis-runs` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Gửi analysis', exact: true }).click();
  const response = await accepted; expect(response.status()).toBe(202); const runId = (await response.json()).data.id;
  expect(response.request().postDataJSON()).toMatchObject({ datasetId, family: 'statistical', method: 'zscore', config: { threshold: 3 }, scope: {} });
  await expect(page.getByTestId('run-status')).toHaveText('Trạng thái Server: completed', { timeout: 20000 });
  await expect.poll(() => backend.mongo.db.collection('anomalies').countDocuments({ analysisRunId: new ObjectId(runId) })).toBe(1);
  await page.getByRole('button', { name: 'Làm mới lịch sử', exact: true }).click();
  await expect(page.getByRole('button', { name: `Xem run ${runId}`, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('run-status')).toHaveText('Trạng thái Server: completed');
  await expect(page.getByRole('button', { name: `Xem run ${runId}`, exact: true })).toBeVisible();
  expect(await backend.mongo.db.collection('analysisRuns').countDocuments()).toBe(1);
  expect(analysisErrors).toEqual([]);
  // No route interception/mock responses. Results call correctly sees B6's current 404,
  // so this test does not claim anomaly list/detail/review or FE ML enablement.
  await expect(page.getByText('Run hoàn tất, không phát hiện anomaly.', { exact: true })).not.toBeVisible();
});
