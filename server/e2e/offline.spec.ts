import { expect, test, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';

const password = 'Offline-test-only-password';
async function login(page: Page, username: string) {
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}
async function clickHeader(page: Page, name: string) {
  await page.mouse.move(700, 3);
  await page.getByRole('button', { name, exact: true }).click({ timeout: 6000 });
}
async function review(page: Page, id: ObjectId) {
  const back = page.getByRole('button', { name: 'Về danh sách anomalies', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: `Review ${id}`, exact: true }).click();
  await page.getByRole('button', { name: 'Đánh giá phát hiện', exact: true }).click();
}

test('Desktop offline shell, partial readings and durable review through MongoDB replay and conflict', async ({ page, context, request }) => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), 'pm25-offline-e2e-'));
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const frontend = `http://127.0.0.1:${port}`;
  let mongo: MongoMemoryReplSet | undefined, backend: ReturnType<typeof buildApp> | undefined, preview: ChildProcess | undefined;
  try {
    mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
    backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('offline_e2e'), IMPORT_STORAGE_DIR: directory, CORS_ORIGINS: frontend }),
      logger: false, analysisWorkerEnabled: false });
    let unavailable = false, analysisPosts = 0, lostResponse = false;
    let firstMutation: Record<string, unknown> | undefined;
    const outcomes: string[] = [];
    backend.addHook('onRequest', async (req, reply) => {
      if (req.method === 'POST' && req.url.endsWith('/analysis-runs')) analysisPosts++;
      if (unavailable) {
        reply.hijack();
        reply.raw.destroy();
      }
    });
    backend.addHook('onSend', async (req, reply, payload) => {
      if (req.method === 'POST' && req.url.endsWith('/review-mutation-batches') && reply.statusCode === 200) {
        const { results: [{ outcome }] } = JSON.parse(String(payload));
        outcomes.push(outcome);
        if (!lostResponse && outcome === 'applied') {
          firstMutation = (req.body as { mutations: Record<string, unknown>[] }).mutations[0];
          lostResponse = true;
          reply.hijack();
          reply.raw.destroy();
        }
      }
      return payload;
    });
    const api = `${await backend.listen({ host: '127.0.0.1', port: 0 })}/api/v1`;
    const db = backend.mongo.db;
    const { analyst } = await seedDemo(db, { SEED_ANALYST_USERNAME: 'OfflineAnalyst', SEED_ANALYST_PASSWORD: password,
      SEED_ADMIN_USERNAME: 'OfflineAdmin', SEED_ADMIN_PASSWORD: password });
    const datasetId = new ObjectId(), sensorId = new ObjectId(), analysisRunId = new ObjectId();
    const ts = new Date('2026-11-16T00:00:00Z'), location = { type: 'Point', coordinates: [106, 10] };
    await db.collection('datasets').insertOne({ _id: datasetId, name: 'Offline private dataset', sourceFilename: 'offline.csv',
      status: 'imported', createdBy: new ObjectId(analyst.id), createdAt: ts });
    await db.collection('sensors').insertOne({ _id: sensorId, datasetId, externalId: 'offline-station', name: 'Offline station', location, type: 'pm25', unit: 'ug/m3' });
    const readings = Array.from({ length: 101 }, (_, index) => ({ _id: new ObjectId(), datasetId, sensorId,
      ts: new Date(+ts + index * 3600000), location, value: index + 1, unit: 'ug/m3' }));
    await db.collection('readings').insertMany(readings);
    await db.collection('analysisRuns').insertOne({ _id: analysisRunId, datasetId, status: 'completed', family: 'statistical',
      method: 'zscore', config: { threshold: 3 }, scope: {}, createdAt: ts, completedAt: ts });
    const [first, second] = [new ObjectId(), new ObjectId()];
    await db.collection('anomalies').insertMany([first, second].map((_id, index) => ({
      _id, datasetId, sensorId, analysisRunId, readingId: readings[index]!._id, ts: readings[index]!.ts, location,
      family: 'statistical', method: 'zscore', score: 4, severity: 'low', status: 'open', note: '', version: 1, updatedAt: ts,
    })));
    const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
    const cwd = fileURLToPath(new URL('../../client', import.meta.url)), outDir = join(directory, 'dist');
    const env = { ...process.env, VITE_DATA_MODE: 'online', VITE_API_BASE_URL: api, VITE_MAPBOX_TOKEN: '' };
    await promisify(execFile)(process.execPath, [vite, 'build', '--outDir', outDir], { cwd, env, windowsHide: true });
    preview = spawn(process.execPath, [vite, 'preview', '--outDir', outDir, '--port', String(port)], { cwd, env, stdio: 'ignore', windowsHide: true });
    await expect.poll(async () => { try { return (await fetch(frontend)).status; } catch { return 0; } }).toBe(200);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${frontend}/login`);
    await login(page, 'OfflineAnalyst');
    await page.getByRole('link', { name: 'Mở dữ liệu', exact: true }).click();
    const workspaceUrl = `${frontend}/workspace/${datasetId}`;
    await expect(page.getByTestId('offline-coverage')).toContainText('100 readings đã lưu');
    await expect(page.getByTestId('offline-coverage')).toContainText('Phạm vi chưa đủ dữ liệu');
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByLabel('Múi giờ workspace').selectOption('UTC');
    await clickHeader(page, 'Analysis');
    await expect(page.getByRole('button', { name: `Xem run ${analysisRunId}` })).toBeVisible();
    await clickHeader(page, 'Anomalies');
    await review(page, first);
    await review(page, second);
    await review(page, first);

    unavailable = true;
    await page.getByLabel('Review status').selectOption('confirmed');
    await page.getByLabel('Ghi chú').fill('Đánh giá offline đã lưu');
    await page.getByRole('button', { name: 'Lưu review' }).click();
    await expect(page.getByText('Đã lưu trên thiết bị — chờ đồng bộ', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByText('Offline · dữ liệu cục bộ', { exact: true })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByLabel('Múi giờ workspace')).toHaveValue('UTC');
    await expect(page.getByRole('heading', { name: 'Offline private dataset' })).toBeVisible();
    await expect(page.getByText(/Chưa cài được bộ nhớ ứng dụng/)).toHaveCount(0);
    await review(page, first);
    await expect(page.getByText(/Bản của bạn · confirmed · Đánh giá offline đã lưu/)).toBeVisible();
    await review(page, second);
    await page.getByLabel('Ghi chú').fill('Bản nháp xung đột');
    await page.getByRole('button', { name: 'Lưu review' }).click();
    await expect(page.getByText('Đã lưu trên thiết bị — chờ đồng bộ', { exact: true })).toBeVisible();
    await clickHeader(page, 'Analysis');
    await expect(page.getByText(/Cần kết nối Backend để chạy phân tích mới/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chạy phát hiện bất thường' })).toBeDisabled();
    await page.getByRole('button', { name: `Xem run ${analysisRunId}` }).click();
    await expect(page.getByTestId('run-status')).toHaveText('completed');
    expect(analysisPosts).toBe(0);
    await clickHeader(page, 'Visualization');
    await expect(page.locator('.cube-canvas')).toHaveAttribute('data-points', '12');
    const reopened = await context.newPage();
    await reopened.setViewportSize({ width: 1440, height: 900 });
    await reopened.goto(page.url());
    await expect(reopened.locator('.cube-canvas')).toHaveAttribute('data-points', '12');
    await reopened.close();

    await page.getByRole('button', { name: 'Mapbox 3D', exact: true }).click();
    await expect(page.getByText(/Nền Mapbox có thể thiếu khi offline/)).toBeVisible();
    await page.getByRole('button', { name: 'Cube', exact: true }).click();
    await page.mouse.move(700, 3);
    await page.locator('.workspace-control-panel summary').click({ timeout: 6000 });
    await page.getByLabel('Trạm (Sensor ID)', { exact: true }).fill(String(sensorId));
    await page.getByLabel('Từ · UTC', { exact: true }).fill('2026-11-16T00:00:00');
    await page.getByLabel('Đến · UTC', { exact: true }).fill('2026-11-16T01:00:00');
    await page.getByRole('button', { name: 'Áp dụng bộ lọc' }).click();
    await expect(page.locator('.cube-canvas')).toHaveAttribute('data-points', '2');
    await expect(page.getByTestId('offline-coverage')).toContainText('2 readings đã lưu');

    const blocked = await context.newPage();
    await blocked.addInitScript(() => Object.defineProperty(window, 'indexedDB', {
      get() { throw new DOMException('IndexedDB is blocked', 'SecurityError'); },
    }));
    await blocked.goto(workspaceUrl);
    await expect(blocked.getByText(/IndexedDB không đọc hoặc lưu được/)).toBeVisible();
    await expect(blocked.getByTestId('offline-coverage')).toHaveCount(0);
    await blocked.close();

    unavailable = false;
    const signIn = await request.post(`${api}/auth/tokens`, { data: { username: 'OfflineAdmin', password } });
    const headers = { authorization: `Bearer ${(await signIn.json()).accessToken}` };
    const other = await request.patch(`${api}/anomalies/${second}`, { headers, data: { baseVersion: 1, changes: { status: 'false_positive', note: 'Bản Server' } } });
    expect(other.status()).toBe(200);
    await context.setOffline(false);
    await expect(page.getByText('Xung đột (1).', { exact: true })).toBeVisible({ timeout: 35000 });
    expect(outcomes).toEqual(['applied', 'duplicate', 'conflict']);
    expect(firstMutation).toMatchObject({ anomalyId: String(first), baseVersion: 1, changes: { status: 'confirmed', note: 'Đánh giá offline đã lưu' } });
    expect(await db.collection('anomalies').findOne({ _id: first })).toMatchObject({ status: 'confirmed', note: 'Đánh giá offline đã lưu', version: 2 });
    expect(await db.collection('anomalies').findOne({ _id: second })).toMatchObject({ status: 'false_positive', note: 'Bản Server', version: 2 });
    await clickHeader(page, 'Anomalies');
    await review(page, second);
    await expect(page.getByText(/Bản của bạn · open · Bản nháp xung đột/)).toBeVisible();
    await expect(page.getByText(/Server v2 · false_positive · Bản Server/)).toBeVisible();
    await review(page, first);
    await expect(page.getByText('Server đã xác nhận lưu review.', { exact: true })).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await clickHeader(page, 'Đăng xuất');
    await page.goto(`${frontend}/login`);
    await login(page, 'OfflineAdmin');
    await expect(page.getByRole('heading', { name: 'Dữ liệu của bạn' })).toBeVisible();
    await expect(page.getByText('Xung đột (1).', { exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await page.goto(workspaceUrl);
    await expect(page.getByText('Chưa có dữ liệu được lưu để sử dụng offline.', { exact: true }).first()).toBeVisible();
    expect(outcomes).toEqual(['applied', 'duplicate', 'conflict']);
  } finally {
    if (preview && preview.exitCode === null) {
      const exited = new Promise<void>(resolve => preview!.once('exit', () => resolve()));
      preview.kill();
      await exited;
    }
    await backend?.close();
    await mongo?.stop();
    const target = resolve(directory);
    if (dirname(target) === resolve(tmpdir()) && basename(target).startsWith('pm25-offline-e2e-'))
      await rm(target, { recursive: true, force: true });
  }
});
