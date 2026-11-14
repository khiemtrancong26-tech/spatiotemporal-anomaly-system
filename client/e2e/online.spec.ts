import { test, expect } from '@playwright/test';
import examples from '../../docs/fixtures/frontend-online-examples.json' with { type: 'json' };
const fixture = (id: string) => examples.cases.find((item) => item.id === id)!.response;
test('online build validates stored session and revokes it on protected 401', async ({ page }) => {
  let expired = false;
  let meCalls = 0;
  await page.route('http://localhost:3001/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/users/me')) meCalls++;
    if (expired) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'EXPIRED', message: 'Expired' } }) });
    const id = path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : path.endsWith('/datasets') ? 'datasets' : 'health';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(id)) });
  });
  await page.goto('/datasets');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mở dữ liệu' })).toBeVisible();
  await expect(page.getByText('DỮ LIỆU MÔ PHỎNG', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Mở dữ liệu' })).toBeVisible();
  expect(meCalls).toBeGreaterThan(0);
  expired = true;
  await page.getByLabel('Sắp xếp').selectOption('createdAt:asc');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.auth.online'))).toBeNull();
});

test('dataset pagination preserves rows on failure, retries cursor, and handles empty/403', async ({ page }) => {
  let failedOnce = false;
  let listMode = 'paged';
  const first = (fixture('datasets') as { data: Record<string, unknown>[] }).data[0];
  await page.route('http://localhost:3001/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/datasets')) {
      if (listMode === 'forbidden') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Denied' } }) });
      const next = url.searchParams.get('cursor');
      if (next && !failedOnce) { failedOnce = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Try later' } }) }); }
      const data = listMode === 'empty' ? [] : [{ ...first, id: next ? 'dataset-002' : 'dataset-001', name: next ? 'Dataset second' : 'Dataset first' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, page: { limit: 100, nextCursor: listMode === 'paged' && !next ? 'next-page' : null } }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(url.pathname.endsWith('/auth/tokens') ? 'login' : 'me')) });
  });
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText('Dataset first', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Dataset first', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Dataset second', { exact: true })).toBeVisible();
  await expect(page.getByText('Dataset first', { exact: true })).toBeVisible();
  listMode = 'empty';
  await page.getByLabel('Sắp xếp').selectOption('createdAt:asc');
  await expect(page.getByRole('heading', { name: 'Chưa có dataset imported' })).toBeVisible();
  await expect(page.getByText('Dataset first', { exact: true })).toHaveCount(0);
  listMode = 'forbidden';
  await page.getByLabel('Sắp xếp').selectOption('createdAt:desc');
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
});

test('import wizard preserves mutation keys, reconfirms mapping after reload and opens only completed data', async ({ page }) => {
  const uploadKeys: string[] = [];
  const importKeys: string[] = [];
  let mappings = 0;
  await page.route('http://localhost:3001/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const id = path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : path.endsWith('/validation') ? 'validation' : path.endsWith('/mapping') ? 'mapping' : path.endsWith('/imports') ? 'import' : path.endsWith('/datasets') && request.method() === 'POST' ? 'upload' : 'datasets';
    if (id === 'upload') { uploadKeys.push(request.headers()['idempotency-key']); if (uploadKeys.length === 1) return route.abort(); }
    if (id === 'mapping') { mappings++; expect(request.postDataJSON()).toEqual({ fieldMap: { sensorId: 'station_id', latitude: 'lat', longitude: 'lon', timestamp: 'observed_at', value: 'pm25' }, unit: 'ug/m3' }); }
    if (id === 'import') { importKeys.push(request.headers()['idempotency-key']); if (importKeys.length === 1) return route.abort(); }
    await route.fulfill({ status: id === 'upload' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(fixture(id)) });
  });
  await page.goto('/datasets/import');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByLabel('File nguồn').setInputFiles({ name: 'input.csv', mimeType: 'text/csv', buffer: Buffer.from('station_id,lat,lon,observed_at,pm25\ns1,21,105,2026-01-01T00:00:00Z,25') });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa xác định');
  await page.getByRole('button', { name: 'Thử lại upload cùng thao tác' }).click();
  await expect(page.getByRole('heading', { name: '3. Xác nhận mapping' })).toBeVisible();
  expect(uploadKeys[0]).toBe(uploadKeys[1]);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping' }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  expect(importKeys).toHaveLength(0);
  expect(uploadKeys).toHaveLength(2);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu mapping' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa xác định');
  await expect(page.getByRole('link', { name: 'Mở workspace', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Thử lại import cùng key' })).toBeEnabled();
  expect(importKeys).toHaveLength(1);
  await page.getByRole('button', { name: 'Thử lại import cùng key' }).click();
  await expect(page.getByRole('link', { name: 'Mở workspace', exact: true })).toBeVisible();
  expect(importKeys[0]).toBe(importKeys[1]);
  expect(mappings).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.import.online'))).toBeNull();
  await page.screenshot({ path: 'test-results/m3-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/m3-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Mở workspace', exact: true }).click();
  await expect(page).toHaveURL(/workspace\/dataset-001/);
});

test('upload reports definitive errors, unlocks correction and never replays unknown upload after reload', async ({ page }) => {
  let failure = 413;
  let uploads = 0;
  await page.route('http://localhost:3001/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/datasets') && route.request().method() === 'POST') {
      uploads++;
      if (!failure) return route.abort();
      return route.fulfill({ status: failure, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID', message: 'Rejected' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(path.endsWith('/auth/tokens') ? 'login' : 'me')) });
  });
  await page.goto('/datasets/import');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  for (const [status, message] of [[413, 'vượt giới hạn'], [415, 'không hỗ trợ'], [422, 'không hợp lệ']] as const) {
    failure = status;
    await page.getByLabel('File nguồn').setInputFiles({ name: 'input.json', mimeType: 'application/json', buffer: Buffer.from('[]') });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByLabel('File nguồn')).toBeEnabled();
  }
  failure = 0;
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa xác định');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Upload trước chưa có ID');
  await expect(page.getByRole('button', { name: 'Thử lại upload cùng thao tác' })).toBeDisabled();
  expect(uploads).toBe(4);
});

test('restored validation controls importing, failed and imported states without automatic mutations', async ({ page }) => {
  let status = 'importing';
  let mutations = 0;
  await page.route('http://localhost:3001/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET' && !path.endsWith('/auth/tokens')) mutations++;
    const body = path.endsWith('/validation') ? { ...fixture('validation'), status } : fixture(path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : 'datasets');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mở dữ liệu' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('pm25.import.online', JSON.stringify({ id: 'dataset-001' })));
  await page.goto('/datasets/import');
  await expect(page.getByText('Dataset ID: dataset-001')).toContainText('importing');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  status = 'failed';
  await page.getByRole('button', { name: 'Đọc lại trạng thái / validation' }).click();
  await expect(page.getByRole('alert')).toContainText('cleanup');
  await expect(page.getByRole('link', { name: 'Mở workspace', exact: true })).toHaveCount(0);
  status = 'imported';
  await page.getByRole('button', { name: 'Đọc lại trạng thái / validation' }).click();
  await expect(page.getByText('Server báo dataset đã imported.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đã import', exact: true })).toBeDisabled();
  expect(mutations).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.import.online'))).toBeNull();
});

test('M4 shares selection across views, paginates and applies UTC filters with fallback', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const url = new URL(route.request().url()); requests.push(url);
    const id = url.pathname.endsWith('/auth/tokens') ? 'login' : url.pathname.endsWith('/users/me') ? 'me' : url.pathname.endsWith('/sensors') ? 'sensors' : 'readings';
    let body = fixture(id);
    if (id === 'readings') {
      const original = fixture('readings') as { data: Record<string, unknown>[] };
      body = { data: url.searchParams.has('sensorId') ? [] : url.searchParams.has('cursor') ? [{ ...original.data[0], id: 'reading-next' }] : original.data, page: { limit: 100, nextCursor: url.searchParams.has('cursor') || url.searchParams.has('sensorId') ? null : 'next' } } as typeof body;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/workspace/dataset-001');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Chọn reading-001', exact: true }).click();
  await expect(page.getByText('Reading: reading-001', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mapbox 3D', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Mapbox token');
  await expect(page.getByText('Reading: reading-001', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tải thêm readings' }).click();
  await expect(page.getByRole('button', { name: 'Chọn reading-next', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await expect(page.getByText('Reading: reading-001', { exact: true })).toBeVisible();
  await expect(page.locator('.visualization-canvas canvas')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/m4-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/m4-mobile.png', fullPage: true });
  await page.getByLabel('Trạm (Sensor ID)').fill('no-data');
  await page.getByLabel('Từ · UTC+07', { exact: true }).fill('2026-01-01T07:00:00');
  await page.getByRole('button', { name: 'Áp dụng bộ lọc' }).click();
  await expect(page.getByText('Không có readings phù hợp.')).toBeVisible();
  await expect(page.getByText('Reading: reading-001', { exact: true })).toHaveCount(0);
  const last = requests.filter(url => url.pathname.endsWith('/readings')).at(-1)!;
  expect(last.searchParams.get('from')).toBe('2026-01-01T00:00:00.000Z');
  expect(last.searchParams.has('cursor')).toBe(false);
  expect(requests.filter(url => url.pathname.endsWith('/readings') && url.searchParams.has('cursor'))).toHaveLength(1);
  expect(requests.filter(url => url.pathname.endsWith('/readings')).every(url => url.searchParams.get('limit') === '100')).toBe(true);
});

test('M5 restores run, distinguishes tracking failure and loads results only after completed', async ({ page }) => {
  let status = 'queued', disconnected = false, detailCalls = 0, resultCalls = 0, posts = 0;
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && !url.pathname.endsWith('/auth/tokens')) posts++;
    let response = fixture(url.pathname.endsWith('/auth/tokens') ? 'login' : url.pathname.endsWith('/users/me') ? 'me' : url.pathname.endsWith('/analysis-runs') ? 'analysis-list' : url.pathname.endsWith('/sensors') ? 'sensors' : 'readings');
    if (url.pathname.endsWith('/analysis-runs/run-001')) {
      detailCalls++;
      if (disconnected) return route.abort();
      response = fixture(status === 'completed' ? 'analysis-detail' : `analysis-detail-${status}`);
    }
    if (url.pathname.endsWith('/anomalies')) { resultCalls++; expect(status).toBe('completed'); response = fixture('anomalies'); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/workspace/dataset-001?runId=run-001');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // Login whitelist may retain only the workspace path; explicit URL also verifies authenticated deep-link recovery.
  await page.goto('/workspace/dataset-001?runId=run-001');
  await expect(page.getByTestId('run-status')).toContainText('queued'); expect(resultCalls).toBe(0);
  await page.getByLabel('Phương pháp', { exact: true }).selectOption('ml');
  await expect(page.getByRole('button', { name: 'Gửi analysis', exact: true })).toBeDisabled();
  await page.getByLabel('Phương pháp', { exact: true }).selectOption('zscore');
  status = 'running'; await page.getByRole('button', { name: 'Đọc lại run' }).click(); await expect(page.getByTestId('run-status')).toContainText('running');
  disconnected = true; await page.getByRole('button', { name: 'Đọc lại run' }).click(); await expect(page.getByRole('alert')).toContainText('Chưa cập nhật'); await expect(page.getByTestId('run-status')).toContainText('running');
  disconnected = false; await page.reload(); await expect(page.getByTestId('run-status')).toContainText('running'); expect(posts).toBe(0);
  status = 'completed'; await page.getByRole('button', { name: 'Đọc lại run' }).click(); await expect(page.getByRole('button', { name: 'Xem reading-002', exact: true })).toBeVisible();
  const terminalCalls = detailCalls; await page.waitForTimeout(3200); expect(detailCalls).toBe(terminalCalls);
  await page.screenshot({ path: 'test-results/m5-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: 'test-results/m5-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Xem reading-002', exact: true }).click(); await expect(page.getByText('Reading: reading-002', { exact: true })).toBeVisible();
});

test('M5 failed run never requests results and completed empty results are explicit', async ({ page }) => {
  let failed = true, results = 0;
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let response = fixture(path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : 'analysis-list');
    if (path.endsWith('/analysis-runs/run-001')) response = fixture(failed ? 'analysis-detail-failed' : 'analysis-detail');
    if (path.endsWith('/anomalies')) { results++; response = { data: [], page: { limit: 100, nextCursor: null } } as typeof response; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/workspace/dataset-001?runId=run-001');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByTestId('run-status')).toContainText('failed');
  await expect(page.getByRole('alert')).toContainText('INFERENCE_FAILED'); expect(results).toBe(0);
  failed = false; await page.reload();
  await expect(page.getByText('Run hoàn tất, không phát hiện anomaly.')).toBeVisible(); expect(results).toBe(1);
});

test('M5 sends fixed statistical payloads and never retries unknown online acceptance after reload', async ({ page }) => {
  const sent: { key?: string; body: Record<string, unknown> }[] = [];
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/analysis-runs') && route.request().method() === 'POST') {
      sent.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
      if (sent.length > 1) return route.abort();
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(fixture('analysis-create')) });
    }
    const id = path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : path.endsWith('/analysis-runs/run-001') ? 'analysis-detail' : path.endsWith('/anomalies') ? 'anomalies' : path.endsWith('/analysis-runs') ? 'analysis-list' : path.endsWith('/sensors') ? 'sensors' : 'readings';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(id)) });
  });
  await page.goto('/workspace/dataset-001');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01'); await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Gửi analysis', exact: true }).click();
  await expect(page.getByTestId('run-status')).toContainText('completed');
  expect(sent[0].body).toEqual({ datasetId: 'dataset-001', family: 'statistical', method: 'zscore', config: { threshold: 3 }, scope: {} }); expect(sent[0].key).toBeTruthy();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Chuẩn bị lần chạy mới' }).click();
  await page.getByLabel('Phương pháp', { exact: true }).selectOption('iqr'); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Gửi analysis', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thử lại cùng key', exact: true })).toBeDisabled();
  expect(sent[1].body.config).toEqual({ multiplier: 1.5 }); expect(sent[1].key).not.toBe(sent[0].key);
  await page.reload(); await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thử lại cùng key', exact: true })).toBeDisabled(); expect(sent).toHaveLength(2);
});

test('M6 preserves draft on 409, rebases explicitly and saves only review fields', async ({ page }) => {
  const original = (fixture('anomaly-detail') as { data: Record<string, unknown> }).data;
  let server = { ...original }, conflict = true;
  const writes: Record<string, unknown>[] = [];
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = fixture(path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : path.endsWith('/sensors') ? 'sensors' : 'readings');
    if (path.endsWith('/anomalies/anomaly-001')) {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON(); writes.push(payload);
        if (conflict) { conflict = false; server = { ...server, version: Number(original.version) + 1, note: 'Server note' }; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Changed' } }) }); }
        expect(payload.baseVersion).toBe(server.version); expect(Object.keys(payload).sort()).toEqual(['baseVersion', 'changes']); expect(Object.keys(payload.changes).sort()).toEqual(['note', 'status']);
        server = { ...server, ...payload.changes, version: Number(server.version) + 1 };
      }
      body = { data: server };
    } else if (path.endsWith('/anomalies')) body = { data: [server], page: { limit: 100, nextCursor: null } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/workspace/dataset-001'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01'); await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Anomalies', exact: true }).click(); await page.getByRole('button', { name: 'Review anomaly-001', exact: true }).click();
  await page.getByLabel('Ghi chú', { exact: true }).fill('My note'); await page.getByLabel('Review status', { exact: true }).selectOption('confirmed'); await page.getByRole('button', { name: 'Lưu review', exact: true }).click();
  await expect(page.getByText(/Server v.*Server note/)).toBeVisible(); await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('My note'); expect(writes).toHaveLength(1); await expect(page.getByRole('button', { name: 'Lưu review', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Giữ bản sửa trên version mới' }).click(); expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Lưu review', exact: true }).click(); await expect(page.getByText('Server đã xác nhận lưu review.')).toBeVisible(); expect(writes).toHaveLength(2);
  await page.screenshot({ path: 'test-results/m6-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('M6 keeps draft through network/409 and allows explicit discard without another PATCH', async ({ page }) => {
  const base = (fixture('anomaly-detail') as { data: Record<string, unknown> }).data;
  let patches = 0;
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = fixture(path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : path.endsWith('/sensors') ? 'sensors' : 'readings');
    if (path.endsWith('/anomalies/anomaly-001')) {
      if (route.request().method() === 'PATCH') { patches++; if (patches === 1) return route.abort(); return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Changed' } }) }); }
      body = { data: patches > 1 ? { ...base, note: 'Server wins', version: Number(base.version) + 1 } : base };
    } else if (path.endsWith('/anomalies')) body = { data: [base], page: { limit: 100, nextCursor: null } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/workspace/dataset-001'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01'); await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Anomalies', exact: true }).click(); await page.getByRole('button', { name: 'Review anomaly-001', exact: true }).click();
  await page.getByLabel('Ghi chú', { exact: true }).fill('Keep me'); await page.getByRole('button', { name: 'Lưu review', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Bản sửa vẫn được giữ'); await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Keep me');
  await expect(page.getByText('Server đã xác nhận lưu review.')).toHaveCount(0); expect(patches).toBe(1);
  page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Visualization', exact: true }).click(); await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Keep me');
  await page.getByRole('button', { name: 'Lưu review', exact: true }).click(); await page.getByRole('button', { name: 'Bỏ bản sửa, dùng Server' }).click();
  await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Server wins'); expect(patches).toBe(2); await expect(page.getByRole('button', { name: 'Lưu review', exact: true })).toBeDisabled();
});

test('M7 online validates create, locks uncertain retry and pages users', async ({ page }) => {
  let posts = 0;
  let createStatus = 422;
  const admin = { id: 'admin-self', username: 'admin01', role: 'admin', isActive: true };
  const queries: string[] = [];
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/auth/tokens')) return route.fulfill({ json: { ...fixture('login'), user: admin } });
    if (url.pathname.endsWith('/users/me')) return route.fulfill({ json: { data: admin } });
    if (request.method() === 'POST') {
      posts++;
      expect(request.headers()['idempotency-key']).toBeTruthy();
      expect(request.postDataJSON()).toEqual({ username: 'newadmin', password: 'secret-password', role: 'analyst' });
      if (!createStatus) return route.abort('failed');
      return route.fulfill({ status: createStatus, json: { error: { code: createStatus === 409 ? 'USERNAME_CONFLICT' : 'VALIDATION_ERROR', message: 'Invalid' } } });
    }
    queries.push(url.search);
    const next = url.searchParams.has('cursor');
    return route.fulfill({ json: { data: [next ? { ...admin, id: 'second', username: 'second' } : admin], page: { limit: 100, nextCursor: next ? null : 'page2' } } });
  });
  await page.goto('/admin/users');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('admin01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Tải thêm users' }).click();
  await expect(page.getByRole('button', { name: 'Sửa second', exact: true })).toBeVisible();
  await page.getByLabel('Sắp xếp user').selectOption('username:desc');
  await expect(page.getByRole('button', { name: 'Sửa second', exact: true })).toHaveCount(0);
  expect(queries.some(q => q.includes('cursor=page2'))).toBe(true);
  expect(queries.at(-1)).not.toContain('cursor');
  await page.getByLabel('Username mới').fill('newadmin');
  await page.getByLabel('Mật khẩu mới').fill('secret-password');
  await page.getByRole('button', { name: 'Tạo user', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('chưa hợp lệ');
  await expect(page.getByLabel('Username mới')).toBeEnabled();
  createStatus = 409;
  await page.getByLabel('Mật khẩu mới').fill('secret-password');
  await page.getByRole('button', { name: 'Tạo user', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Username đã tồn tại');
  await expect(page.getByLabel('Username mới')).toBeEnabled();
  createStatus = 0;
  await page.getByLabel('Mật khẩu mới').fill('secret-password');
  await page.getByRole('button', { name: 'Tạo user', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thử lại tạo cùng key' })).toBeDisabled();
  await expect(page.getByLabel('Mật khẩu mới')).toHaveValue('');
  expect(posts).toBe(3);
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('secret-password');
});

test('M7 online keeps rejected PATCH draft and logs out a disabled current admin', async ({ page }) => {
  const admin = { id: 'self', username: 'admin01', role: 'admin', isActive: true };
  let rejected = true;
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/tokens')) return route.fulfill({ json: { ...fixture('login'), user: admin } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { data: admin } });
    if (request.method() === 'PATCH') {
      expect(request.postDataJSON()).toEqual({ isActive: false });
      if (rejected) return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Denied' } } });
      return route.fulfill({ json: { data: { ...admin, isActive: false } } });
    }
    return route.fulfill({ json: { data: [admin], page: { limit: 100, nextCursor: null } } });
  });
  await page.goto('/admin/users');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('admin01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('button', { name: 'Sửa admin01', exact: true }).click();
  await page.getByLabel('Đang hoạt động').uncheck();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Lưu tài khoản' }).click();
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  await expect(page.getByLabel('Đang hoạt động')).not.toBeChecked();
  rejected = false;
  await page.getByRole('button', { name: 'Lưu tài khoản' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pm25.auth.online'))).toBeNull();
});
