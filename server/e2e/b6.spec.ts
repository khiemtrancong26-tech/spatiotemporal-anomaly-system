import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { buildApp } from '../src/app.js';
import { seedDemo } from '../src/dev/seed-demo.js';
import { loadTestConfig } from '../tests/helpers.js';

let mongo: MongoMemoryReplSet, backend: FastifyInstance, vite: ChildProcess;
let frontendUrl: string, backendUrl: string, storage: string;
let baselineVite: ChildProcess | undefined, baselineUrl: string | undefined;
const password = 'B6-browser-test-only-password';
let dropNextAnalysisReceipt = false, droppedReceipts = 0;
test.beforeAll(async () => {
  test.setTimeout(120000);
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  frontendUrl = `http://127.0.0.1:${port}`;
  if (process.env.PM25_UX_BASELINE_ROOT) {
    const baselineProbe = createServer(); await new Promise<void>(resolve => baselineProbe.listen(0, '127.0.0.1', resolve));
    baselineUrl = `http://127.0.0.1:${(baselineProbe.address() as AddressInfo).port}`; await new Promise<void>(resolve => baselineProbe.close(() => resolve()));
  }
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  storage = await mkdtemp(resolve(tmpdir(), 'pm25-b6-browser-'));
  backend = buildApp({ config: loadTestConfig({ MONGODB_URI: mongo.getUri('b6_browser_test'), IMPORT_STORAGE_DIR: storage,
    CORS_ORIGINS: [frontendUrl, baselineUrl].filter(Boolean).join(','), LOG_LEVEL: 'silent', ANALYSIS_POLL_MS: '20' }), logger: false });
  backend.addHook('onSend', async (req, reply, payload) => { if (dropNextAnalysisReceipt && req.method === 'POST' && req.url.endsWith('/analysis-runs') && reply.statusCode === 202) { droppedReceipts++; reply.hijack(); reply.raw.destroy(); } return payload; });
  backendUrl = await backend.listen({ host: '127.0.0.1', port: 0 });
  await seedDemo(backend.mongo.db, { SEED_ADMIN_USERNAME: 'B6Admin', SEED_ADMIN_PASSWORD: password,
    SEED_ANALYST_USERNAME: 'B6Analyst', SEED_ANALYST_PASSWORD: password, SEED_DEMO_DATA: 'false' });
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: fileURLToPath(new URL('../../client', import.meta.url)), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, VITE_DATA_MODE: 'online', VITE_API_BASE_URL: `${backendUrl}/api/v1`, VITE_MAPBOX_TOKEN: '' },
  });
  await expect.poll(async () => { try { return (await fetch(frontendUrl)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
  if (baselineUrl && process.env.PM25_UX_BASELINE_ROOT) {
    baselineVite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', new URL(baselineUrl).port, '--strictPort'], {
      cwd: resolve(process.env.PM25_UX_BASELINE_ROOT, 'client'), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, VITE_DATA_MODE: 'online', VITE_API_BASE_URL: `${backendUrl}/api/v1`, VITE_MAPBOX_TOKEN: '' },
    });
    await expect.poll(async () => { try { return (await fetch(baselineUrl!)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
  }

});
test.afterAll(async () => {
  if (vite && vite.exitCode === null) { const exited = new Promise<void>(resolve => vite.once('exit', () => resolve())); vite.kill(); await exited; }
  if (baselineVite && baselineVite.exitCode === null) { const exited = new Promise<void>(resolve => baselineVite!.once('exit', () => resolve())); baselineVite.kill(); await exited; }
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
  await page.getByRole('button', { name: 'Chạy phát hiện bất thường', exact: true }).click();
  const response = await accepted; expect(response.status()).toBe(202); const runId = (await response.json()).data.id;
  await expect(page.getByTestId('run-status')).toHaveText('completed', { timeout: 25000 });
  const persisted = await backend.mongo.db.collection('anomalies').find({ analysisRunId: new ObjectId(runId) }).sort({ ts: 1, _id: 1 }).toArray();
  expect(persisted.length).toBeGreaterThan(0);
  const anomalyId = String(persisted[0]!._id);
  await page.getByRole('button', { name: 'Anomalies', exact: true }).click();
  await page.getByRole('button', { name: `Review ${anomalyId}`, exact: true }).click();
  await page.getByRole('button', {name:'Đánh giá phát hiện',exact:true}).click();
  await expect(page.getByRole('heading', { name: 'Đánh giá của Analyst', exact: true })).toBeVisible();
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
  await expect(page.getByText('Đối soát đánh giá trên Server', {exact:true})).toBeVisible();
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
  await page.getByRole('button', {name:'Đánh giá phát hiện',exact:true}).click();
  await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Bản Analyst A giữ qua xung đột');
  await expect(page.getByLabel('Review status', { exact: true })).toHaveValue('false_positive');
  await expect(page.locator('.ux-review-form .badge')).toHaveText('v3');
  expect(analysisErrors).toEqual([]);
  expect(await backend.mongo.db.collection('readings').countDocuments({ datasetId: new ObjectId(datasetId) })).toBe(8782);
});

test('Analyst journey: real CSV/Profile/Aggregates → lost POST receipt replay → exact Cube/Mapbox handoff → review', async ({ page }) => {
  test.setTimeout(120000);
  const qaDir = fileURLToPath(new URL('../../docs/frontend/analyst-ux/after', import.meta.url)); await mkdir(qaDir, { recursive: true });
  const errors: string[] = [], posts: { key: string | undefined; body: unknown }[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && r.url() === backendUrl + '/api/v1/analysis-runs') posts.push({ key: r.headers()['idempotency-key'], body: r.postDataJSON() }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(frontendUrl + '/login'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill('B6Analyst'); await page.getByLabel('Mật khẩu', { exact: true }).fill(password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(page).toHaveURL(frontendUrl + '/datasets');
  await page.goto(frontendUrl + '/datasets/import'); await page.getByLabel('File nguồn', { exact: true }).setInputFiles({ name: 'analyst-ux-beijing.csv', mimeType: 'text/csv', buffer: await readFile(new URL('../tests/fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url)) });
  await page.getByLabel('Tên dataset (tùy chọn)', { exact: true }).fill('Beijing 03/2015 · Kiểm chứng API thật');
  const uploaded = page.waitForResponse(r => r.url() === backendUrl + '/api/v1/datasets' && r.request().method() === 'POST'); await page.getByRole('button', { name: 'Upload', exact: true }).click(); const datasetId = (await (await uploaded).json()).data.id;
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Lưu mapping', exact: true }).click(); await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.getByRole('link', { name: 'Mở workspace', exact: true }).click();
  await page.getByLabel('Múi giờ workspace', { exact: true }).selectOption('+08:00'); await page.getByRole('button', { name: 'Data Exploration', exact: true }).click();
  await expect(page.getByTestId('exploration-profile')).toContainText('8.782'); await expect(page.getByTestId('exploration-coverage')).toContainText('Chưa xác định'); await expect(page.getByTestId('exploration-aggregates')).toContainText('3 series × 31 buckets');
  const capture = async (name: string) => { for (const width of [1600, 1024, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.evaluate(() => { if(document.activeElement instanceof HTMLElement)document.activeElement.blur(); window.scrollTo(0,0); }); await page.screenshot({ path: resolve(qaDir, `${name}-${width}.png`), fullPage: true }); } await page.setViewportSize({ width: 1600, height: 1000 }); };
  await capture('01-exploration');
  const beforePage = baselineUrl ? await page.context().newPage() : undefined;
  const captureBefore = async (name: string) => {
    if (!beforePage) return;
    const beforeDir = resolve(qaDir, '..', 'before'); await mkdir(beforeDir, { recursive: true });
    for (const width of [1600, 390]) { await beforePage.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await beforePage.evaluate(() => { if(document.activeElement instanceof HTMLElement)document.activeElement.blur(); window.scrollTo(0,0); }); await beforePage.screenshot({ path: resolve(beforeDir, `${name}-${width}.png`), fullPage: true }); }
    await beforePage.setViewportSize({width:1600,height:1000});
  };
  if (beforePage) {
    await beforePage.goto(baselineUrl + '/login'); await beforePage.getByLabel('Tên đăng nhập',{exact:true}).fill('B6Analyst'); await beforePage.getByLabel('Mật khẩu',{exact:true}).fill(password); await beforePage.getByRole('button',{name:'Đăng nhập',exact:true}).click(); await expect(beforePage).toHaveURL(baselineUrl + '/datasets');
    await beforePage.goto(baselineUrl + '/workspace/' + datasetId); await beforePage.getByLabel('Múi giờ workspace',{exact:true}).selectOption('+08:00'); await beforePage.getByRole('button',{name:'Data Exploration',exact:true}).click(); await expect(beforePage.getByTestId('exploration-aggregates')).toContainText('12 series'); await captureBefore('01-exploration');
    await beforePage.getByRole('button',{name:'Analysis',exact:true}).click(); await captureBefore('02-analysis-setup');
  }

  await page.getByRole('button', { name: 'Phân tích phạm vi này', exact: true }).first().click(); await page.getByRole('button', { name: 'Toàn bộ scope workspace', exact: true }).click(); expect(posts).toEqual([]);
  await expect(page.locator('.ux-scope-summary')).toContainText('Tất cả trạm · Toàn bộ thời gian của dataset'); await expect(page.locator('.ux-limit')).toContainText('8.782'); await capture('02-analysis-setup');
  dropNextAnalysisReceipt = true;
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra phạm vi và phương pháp phân tích.', exact: true }).check(); await page.getByRole('button', { name: 'Chạy phát hiện bất thường', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thử lại cùng key', exact: true })).toBeEnabled(); expect(droppedReceipts).toBeGreaterThan(0); const beforeReplay = posts.length; expect(beforeReplay).toBeGreaterThan(0); expect(await backend.mongo.db.collection('analysisRuns').countDocuments({ datasetId: new ObjectId(datasetId) })).toBe(1);
  await page.reload(); await page.getByRole('button', { name: 'Analysis', exact: true }).click(); expect(posts).toHaveLength(beforeReplay); dropNextAnalysisReceipt = false; await page.getByRole('button', { name: 'Thử lại cùng key', exact: true }).click();
  await expect(page.getByTestId('run-status')).toHaveText('completed', { timeout: 30000 }); expect(posts).toHaveLength(beforeReplay + 1); expect(posts.every(p => JSON.stringify(p) === JSON.stringify(posts[0]))).toBe(true); expect(posts[0]!.body).toMatchObject({ datasetId, family: 'statistical', method: 'zscore', config: { threshold: 3 }, scope: {} });
  const run = await backend.mongo.db.collection('analysisRuns').findOne({ datasetId: new ObjectId(datasetId) }); const runId = String(run!._id);
  expect(await backend.mongo.db.collection('analysisRuns').countDocuments({ datasetId: new ObjectId(datasetId) })).toBe(1);
  await expect(page.getByRole('button', { name: 'Mở Anomalies', exact: true })).toBeVisible(); await capture('03-analysis-completed');
  if (beforePage) { await beforePage.goto(baselineUrl + '/workspace/' + datasetId + '?runId=' + runId); await expect(beforePage.getByTestId('run-status')).toContainText('completed'); await captureBefore('03-analysis-completed'); }
  const reading = await backend.mongo.db.collection('readings').findOne({ datasetId: new ObjectId(datasetId), ts: new Date('2015-03-26T13:00:00.000Z'), value: 369 }); expect(reading).not.toBeNull();
  const item = await backend.mongo.db.collection('anomalies').findOne({ datasetId: new ObjectId(datasetId), analysisRunId: new ObjectId(runId), readingId: reading!._id }); expect(item).not.toBeNull(); const anomalyId = String(item!._id);
  await page.getByRole('button', { name: 'Mở Anomalies', exact: true }).click(); await page.getByRole('button', { name: `Review ${anomalyId}`, exact: true }).click(); await expect(page.locator('.ux-reading')).toContainText('369'); await capture('04-anomalies-inspector');
  if (beforePage) { await beforePage.getByRole('button',{name:'Anomalies',exact:true}).click(); await beforePage.getByRole('button',{name:`Review ${anomalyId}`,exact:true}).click(); await expect(beforePage.getByLabel('Review status',{exact:true})).toBeVisible(); await captureBefore('04-anomalies-review'); await beforePage.close(); }
  await page.getByRole('region', { name: 'Bảng anomalies', exact: true }).evaluate(node => node.setAttribute('data-return-context', 'kept'));
  await page.getByRole('button', { name: 'Điều tra trên Cube', exact: true }).click(); await expect(page.getByRole('region', { name: 'Điều tra reading', exact: true })).toContainText('Đã xác minh đúng ID'); await expect(page.locator('.cube-inspector')).toContainText(String(reading!._id)); await expect(page.locator('.cube-canvas')).toHaveAttribute('data-points', '1'); await capture('05-investigation-cube');
  await page.getByRole('button', { name: 'Quay lại Anomalies', exact: true }).click(); await expect(page.getByRole('region', { name: 'Bảng anomalies', exact: true })).toHaveAttribute('data-return-context', 'kept'); await expect(page.getByLabel('Analysis run ID', { exact: true })).toHaveValue(runId);
  await page.getByRole('button', { name: 'Xem trên Mapbox', exact: true }).click(); await expect(page.getByLabel('Thời điểm đã tải', { exact: true })).toHaveValue('2015-03-26T13:00:00.000Z'); await expect(page.getByTestId('snapshot-status')).toContainText('1 trạm có mẫu'); await expect(page.getByText(`Reading: ${String(reading!._id)}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại Anomalies', exact: true }).click(); await page.getByRole('button', { name: 'Đánh giá phát hiện', exact: true }).click();
  await page.getByLabel('Ghi chú', { exact: true }).fill('Quan sát đỉnh 369; chưa xác minh nguyên nhân.'); await page.getByLabel('Review status', { exact: true }).selectOption('confirmed'); await capture('06-review');
  page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Data Exploration', exact: true }).click(); await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Quan sát đỉnh 369; chưa xác minh nguyên nhân.');
  await page.getByRole('button', { name: 'Lưu review', exact: true }).click(); await expect(page.getByText('Server đã xác nhận lưu review.', { exact: true })).toBeVisible();
  const saved = await backend.mongo.db.collection('anomalies').findOne({ _id: item!._id }); expect(saved).toMatchObject({ version: 2, status: 'confirmed', note: 'Quan sát đỉnh 369; chưa xác minh nguyên nhân.' }); expect(saved!.score).toBe(item!.score); expect(saved!.method).toBe(item!.method); expect(errors).toEqual([]);
});
