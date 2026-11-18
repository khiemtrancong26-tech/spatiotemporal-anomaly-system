import { configureExplorationMetadata } from '../src/modules/exploration/exploration.metadata.js';
import metadata from '../tests/fixtures/beijing-exploration-metadata.json' with { type: 'json' };
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
const password = 'C2-browser-test-only-password';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-c2-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('c2_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: frontendUrl, LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' }), logger: false });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'C2Admin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'C2Analyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false' });
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
  if (storage?.startsWith(resolve(tmpdir()) + sep) && storage.includes('pm25-c2-browser-')) await rm(storage, { recursive: true, force: true });
});

test('C2 actual Beijing import → authoritative profile → full-scope comparison → timezone/filter → reload', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && (path.endsWith('/profile') || path.endsWith('/reading-aggregates'))) {
      errors.push(`${response.status()} ${path}`);
    }
  });
  await page.goto(frontendUrl + '/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('C2Analyst');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(frontendUrl + '/datasets');
  await page.goto(frontendUrl + '/datasets/import');
  await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'beijing-c2.csv', mimeType: 'text/csv', buffer: await readFile(new URL('../tests/fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url)) });
  const uploaded = page.waitForResponse(r => r.url() === backendUrl + '/api/v1/datasets' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload', exact: true }).click(); const id = (await (await uploaded).json()).data.id;
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  const imported = page.waitForResponse(r => r.url().endsWith('/imports') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Import', exact: true }).click(); expect((await imported).status()).toBe(200);
  // The same explicit metadata function used by the CLI; no endpoint or filename inference.
  await configureExplorationMetadata(backend.mongo.db, id, metadata);
  await page.getByRole('link', { name: 'Mở workspace', exact: true }).click();
  await expect(page.getByLabel('Múi giờ workspace')).toHaveValue('+08:00');
  const distribution = page.locator('.reading-distribution');
  await expect(distribution).not.toHaveAttribute('open');
  await distribution.locator('summary').click();
  await expect(page.getByTestId('distribution-count')).toContainText('8.782 readings');
  await distribution.locator('summary').click();
  const aggregated = page.waitForResponse(r => {
    const url = new URL(r.url());
    return url.pathname.endsWith('/reading-aggregates') && url.searchParams.getAll('sensorIds').length === 3 && r.status() === 200;
  });
  await page.getByRole('button', { name: 'Data Exploration', exact: true }).press('Enter');
  await expect(page.getByTestId('exploration-profile')).toContainText('8.782'); await expect(page.getByTestId('exploration-coverage')).toContainText('thiếu 146');
  const all = (await (await aggregated).json()).data; expect(all.series).toHaveLength(3); expect(all.series[0].buckets).toHaveLength(31);
  await expect(page.getByTestId('exploration-aggregates')).toContainText('3 series × 31 buckets', { timeout: 20000 });
  const hourly = page.waitForResponse(r => r.url().includes('/reading-aggregates?') && new URL(r.url()).searchParams.get('bucket') === 'hour' && r.status() === 200);
  await page.getByLabel('Bucket tổng hợp').selectOption('hour'); expect((await (await hourly).json()).data.series[0].buckets).toHaveLength(744);
  const utc = page.waitForResponse(r => r.url().includes('/reading-aggregates?') && new URL(r.url()).searchParams.get('timeZone') === 'UTC' && r.status() === 200);
  await page.getByLabel('Múi giờ workspace').selectOption('UTC'); const shifted = (await (await utc).json()).data;
  expect(shifted.scope.from).toBe(all.scope.from); expect(shifted.scope.to).toBe(all.scope.to);
  const daily = page.waitForResponse(r => r.url().includes('/reading-aggregates?') && new URL(r.url()).searchParams.get('bucket') === 'day' && r.status() === 200);
  await page.getByLabel('Bucket tổng hợp').selectOption('day'); const days = (await (await daily).json()).data;
  expect(days.series[0].buckets).toHaveLength(32); expect(days.series[0].buckets[0].start).toBe('2015-02-28T00:00:00.000Z');
  await page.getByLabel('Múi giờ workspace').selectOption('+08:00');
  await page.locator('summary.filter-heading').press('Enter');
  await page.getByLabel('Từ · UTC+08:00', { exact: true }).fill('2015-03-16T19:00');
  await page.getByLabel('Đến · UTC+08:00', { exact: true }).fill('2015-03-16T19:00');
  await page.getByRole('button', { name: 'Áp dụng bộ lọc', exact: true }).click();
  await expect(page.getByTestId('server-profile-summary')).toContainText('Scope Server: 12 readings');
  await expect(page.getByTestId('exploration-profile')).toContainText('315,5');
  await expect(page.getByTestId('applied-filter')).toContainText('19:00:00');
  await expect(page.getByTestId('applied-filter')).toContainText('UTC+08:00');
  await page.reload(); await expect(page.getByLabel('Múi giờ workspace')).toHaveValue('+08:00');
  await page.getByRole('button', { name: 'Data Exploration', exact: true }).press('Enter');
  await expect(page.getByTestId('server-profile-summary')).toContainText('Scope Server: 12 readings');
  await expect(page.getByTestId('exploration-coverage')).toContainText('12/12 slots · thiếu 0');
  await expect(page.getByTestId('exploration-aggregates')).toContainText('3 series × 1 buckets', { timeout: 20000 });
  expect(errors).toEqual([]);
  await page.screenshot({ path: fileURLToPath(new URL('../../.local/c2-exploration.png', import.meta.url)) });
});
