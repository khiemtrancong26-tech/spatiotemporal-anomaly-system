import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';

let mongo: MongoMemoryReplSet, backend: FastifyInstance, vite: ChildProcess;
let frontendUrl: string, backendUrl: string, storage: string;
const password = 'C3-browser-test-only-password';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-c3-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('c3_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20',  }), logger: false });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'C3Admin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'C3Analyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false' });
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
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-c3-browser-')) await rm(storage, { recursive: true, force: true });
});

test('Desktop single-model API/DB/native inference → strict parser → scoring coverage → reload', async ({ page, request }) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1440, height: 900 });
  const login = await request.post(backendUrl + '/api/v1/auth/tokens', { data: { username: 'C3Analyst', password } }); expect(login.status()).toBe(200);
  const headers = { authorization: 'Bearer ' + (await login.json()).accessToken };
  const upload = await request.post(backendUrl + '/api/v1/datasets', { headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, multipart: { file: { name: 'beijing.csv', mimeType: 'text/csv', buffer: await readFile(new URL('../tests/fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url)) } } }); expect(upload.status()).toBe(201);
  const id = (await upload.json()).data.id;
  const mapping = await request.put(backendUrl + '/api/v1/datasets/' + id + '/mapping', { headers, data: { fieldMap: { sensorId: 'sensorId', latitude: 'latitude', longitude: 'longitude', timestamp: 'timestamp', value: 'value' }, unit: 'ug/m3' } }); expect(mapping.status()).toBe(200);
  const imported = await request.post(backendUrl + '/api/v1/datasets/' + id + '/imports', { headers: { ...headers, 'idempotency-key': crypto.randomUUID() } }); expect(imported.status()).toBe(200);
  await page.goto(frontendUrl + '/login'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill('C3Analyst'); await page.getByLabel('Mật khẩu', { exact: true }).fill(password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(frontendUrl + '/datasets'); await page.goto(frontendUrl + '/workspace/' + id);
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.locator('input[name="detector-method"][value="isolation_forest"]').check();
  await expect(page.getByLabel('Phiên bản Isolation Forest', { exact: true })).toHaveCount(0);
  await page.getByLabel('Tôi đã kiểm tra phạm vi và phương pháp phân tích.', { exact: true }).check();
  const accepted = page.waitForResponse(r => r.url() === backendUrl + '/api/v1/analysis-runs' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Chạy phát hiện bất thường', exact: true }).click();
  const response = await accepted; expect(response.status()).toBe(202); expect(response.request().postDataJSON().config).toEqual({});
  const run = (await response.json()).data; expect(run.scoringSummary).toBeUndefined();
  await expect(page.getByTestId('run-status')).toHaveText('completed', { timeout: 30000 });
  await expect(page.getByTestId('scoring-summary')).toContainText('8722/8782'); await expect(page.getByTestId('scoring-summary')).toContainText('chưa chấm 60');
  await page.reload(); await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(page.getByTestId('scoring-summary')).toContainText('8722/8782');
  const stored = await backend.mongo.db.collection('analysisRuns').findOne({ modelVersion: 'pm25-iforest-uci501-v2' }); expect(stored?.scoringSummary).toMatchObject({ targetCount: 8782, scoredCount: 8722, unscorableCount: 60 });
});
