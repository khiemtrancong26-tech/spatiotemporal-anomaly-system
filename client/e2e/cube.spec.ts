import { test, expect, type Page } from '@playwright/test';
import examples from '../../docs/fixtures/frontend-online-examples.json' with { type: 'json' };
const fixture = (id: string) => structuredClone(examples.cases.find(item => item.id === id)!.response);
type RecordValue = Record<string, unknown>;
const first = (id: string) => (fixture(id) as { data: RecordValue[] }).data[0];
const beijing = (day: number, hour: number) => new Date(Date.UTC(2015, 2, day, hour - 8)).toISOString();
const stationNames = ['Nongzhanguan', 'Guanyuan', 'Dongsi', 'Wanliu', 'Tiantan', 'Aotizhongxin', 'Changping', 'Dingling', 'Gucheng', 'Huairou', 'Shunyi', 'Wanshouxigong'];
// HTTP-only synthetic QA dataset. The five Nongzhanguan samples follow the spec example.
const sensors = stationNames.map((name, i) => ({ ...first('sensors'), id: `qa-s${i}`, name, externalId: name, location: { type: 'Point', coordinates: [116.2 + i % 4 * .1, 39.7 + Math.floor(i / 4) * .15] } }));
const reading = (sensor: number, day: number, hour: number, value: number) => ({ ...first('readings'), id: `qa-r${sensor}-${day}-${hour}`, sensorId: sensors[sensor].id, ts: beijing(day, hour), value, location: sensors[sensor].location });
const peak = [69, 84, 84, 235, 369].map((value, i) => reading(0, 26, 17 + i, value));
const overview = Array.from({length:24},(_,hour)=>sensors.map((_,i)=>reading(i,16,hour,hour===19?315.5:Math.round(35+Math.sin(hour/24*Math.PI)*170+i*4)))).flat();
const context = sensors.slice(1).map((_, i) => reading(i + 1, 26, 21, 80));
const rows = [...overview, ...peak, ...context].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
const run = { ...first('analysis-list'), id: 'qa-run', datasetId: 'dataset-001', status: 'completed', family: 'statistical', method: 'zscore', config: { threshold: 3 }, scope: {}, createdAt: beijing(27, 0), completedAt: beijing(27, 1) };
const anomaly = { ...first('anomalies'), id: 'qa-anomaly', datasetId: 'dataset-001', analysisRunId: 'qa-run', readingId: peak[4].id, sensorId: sensors[0].id, ts: peak[4].ts, location: sensors[0].location, family: 'statistical', method: 'zscore', score: 3.42, severity: 'high', status: 'open', note: '', version: 1, updatedAt: beijing(27, 1) };

async function setup(page: Page, options: { partial?: boolean; noRuns?: boolean; fail?: boolean } = {}) {
  const errors: string[] = [], requests: URL[] = [], mutations: string[] = [];
  let failed = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    requests.push(url); if (request.method() !== 'GET') mutations.push(path);
    if (path.endsWith('/readings')) {
      if (options.fail && url.searchParams.has('from') && !failed) { failed = true; return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'QA read failure' } } }); }
      if (options.partial && url.searchParams.has('from')) {
        const start = Number(url.searchParams.get('cursor') ?? 0), limit = Number(url.searchParams.get('limit'));
        return route.fulfill({ json: { data: Array.from({ length: limit }, (_, i) => ({ ...reading(0, 16, 19, i), id: `budget-${start + i}` })), page: { limit, nextCursor: String(start + limit) } } });
      }
      const filtered = rows.filter(row => (!url.searchParams.has('from') || Date.parse(row.ts) >= Date.parse(url.searchParams.get('from')!)) && (!url.searchParams.has('to') || Date.parse(row.ts) <= Date.parse(url.searchParams.get('to')!)));
      const start = Number(url.searchParams.get('cursor') ?? 0), limit = Number(url.searchParams.get('limit') ?? 100);
      return route.fulfill({ json: { data: filtered.slice(start,start+limit), page: { limit, nextCursor: start+limit<filtered.length ? String(start+limit) : null } } });
    }
    if (path.endsWith('/sensors')) return route.fulfill({ json: { data: sensors, page: { limit: 100, nextCursor: null } } });
    if (path.endsWith('/analysis-runs')) return route.fulfill({ json: { data: options.noRuns ? [] : [run], page: { limit: 100, nextCursor: null } } });
    if (path.endsWith('/anomalies/qa-anomaly')) return route.fulfill({ json: { data: anomaly } });
    if (path.endsWith('/anomalies')) return route.fulfill({ json: { data: [anomaly], page: { limit: 100, nextCursor: null } } });
    if (path.endsWith('/datasets')) { const body = fixture('datasets') as { data: RecordValue[] }; body.data[0].name = 'Cube QA — dữ liệu mô phỏng'; Object.assign(body.data[0].importSummary as object, {totalRows:rows.length, importedRows:rows.length}); return route.fulfill({ json: body }); }
    return route.fulfill({ json: fixture(path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : 'health') });
  });
  await page.goto('/datasets');
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('link', { name: 'Mở dữ liệu', exact: true }).click();
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await expect(page.locator('.cube-renderer[data-ready=true]')).toBeVisible();
  if (!options.partial && !options.fail) { await expect(page.getByTestId('cube-coverage')).toContainText('288 readings'); await page.getByLabel('Lát thời gian Cube', {exact:true}).selectOption(beijing(16,19)); }
  return { errors, requests, mutations };
}

test('Cube shares one canvas/camera across modes, shows real timestamps and gaps, opens official review', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const qa = await setup(page);
  await expect(page.getByTestId('cube-slice-mean')).toContainText('315,5');
  const canvas = page.locator('.cube-canvas canvas'), camera = page.locator('.cube-canvas');
  await page.getByRole('button', { name: 'Phóng to Cube', exact: true }).click();
  const pose = await camera.getAttribute('data-camera');
  await canvas.evaluate(node => node.setAttribute('data-identity', 'same-canvas'));
  await page.getByRole('button', { name: '02 Theo trạm', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-identity', 'same-canvas'); await expect(camera).toHaveAttribute('data-camera', pose!);
  await page.getByLabel('Múi giờ Cube', { exact: true }).selectOption('8');
  await page.getByLabel('Từ Cube · UTC+08', { exact: true }).fill('2015-03-26T00:00');
  await page.getByRole('button', { name: 'Xem phạm vi', exact: true }).click();
  await expect(page.getByTestId('cube-coverage')).toContainText('16 readings');
  await page.getByLabel('Lát thời gian Cube', { exact: true }).selectOption(beijing(26, 21));
  await page.getByRole('region', { name: 'Chuỗi giờ của trạm', exact: true }).getByRole('button', { name: '21:00', exact: true }).click();
  await expect(page.locator('.cube-inspector')).toContainText('369');
  await expect(page.locator('.cube-panel')).toContainText('Trung vị 11 trạm khác tại lát: 80');
  await expect(page.getByRole('region', { name: 'Chuỗi giờ của trạm', exact: true }).getByRole('row').filter({ hasText: '22:00' })).toContainText('Thiếu mẫu');
  await expect(page.getByRole('region', { name: 'Chuỗi giờ của trạm', exact: true }).getByRole('row').filter({ hasText: '23:00' })).toContainText('Thiếu mẫu');
  await page.getByLabel('Múi giờ Cube', { exact: true }).selectOption('7');
  await expect(page.getByLabel('Lát thời gian Cube', { exact: true })).toHaveValue(beijing(26, 21));
  await expect(page.locator('.cube-inspector')).toContainText('20:00');
  await page.getByRole('button', { name: '03 Điều tra bất thường', exact: true }).click();
  await page.getByLabel('Analysis Run trong Cube', { exact: true }).selectOption('qa-run');
  await expect(page.getByTestId('cube-anomaly-count')).toContainText('1 anomalies');
  await page.locator('.cube-anomaly-item').click();
  await expect(page.locator('.cube-anomaly-detail')).toContainText('3.42');
  await expect(canvas).toHaveAttribute('data-identity', 'same-canvas'); await expect(camera).toHaveAttribute('data-camera', pose!);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.screenshot({path:'test-results/cube-official-1440.png',fullPage:true});
  await page.getByRole('button', { name: 'Mở review', exact: true }).click();
  await expect(page.getByLabel('Review status', { exact: true })).toHaveValue('open');
  expect(qa.mutations.filter(path => !path.endsWith('/auth/tokens'))).toEqual([]);
  expect(qa.errors).toEqual([]);
});

test('Cube stops at 2000, warns about partial scope and suppresses complete statistics/playback', async ({ page }) => {
  const qa = await setup(page, { partial: true });
  await expect(page.getByTestId('cube-coverage')).toContainText('2000 readings');
  await expect(page.getByText('Thu hẹp khoảng thời gian để xem đầy đủ.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('cube-slice-mean')).toContainText('Chưa đầy đủ');
  await expect(page.getByRole('button', { name: 'Phát Cube', exact: true })).toBeDisabled();
  expect(qa.requests.filter(url => url.pathname.endsWith('/readings') && url.searchParams.has('from'))).toHaveLength(20);
  expect(qa.requests.every(url => url.searchParams.get('cursor') !== '2000')).toBe(true);
  expect(qa.errors).toEqual([]);
});

test('Cube handles retry, empty scope and absence of runs without inventing anomalies', async ({ page }) => {
  const qa = await setup(page, { noRuns: true, fail: true });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByTestId('cube-coverage')).toContainText('288 readings');
  await page.getByLabel('Lát thời gian Cube', {exact:true}).selectOption(beijing(16,19));
  await expect(page.getByTestId('cube-slice-mean')).toContainText('315,5');
  await page.getByRole('button', { name: '03 Điều tra bất thường', exact: true }).click();
  await expect(page.getByText('Chưa có kết quả phát hiện bất thường được chọn.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mở review', exact: true })).toHaveCount(0);
  expect(qa.requests.some(url => url.pathname.endsWith('/anomalies'))).toBe(false);
  await page.getByLabel('Từ Cube · UTC+07', { exact: true }).fill('2015-03-20T00:00');
  await page.getByRole('button', { name: 'Xem phạm vi', exact: true }).click();
  await expect(page.getByText('Không có phép đo trong khoảng đã chọn.', { exact: true })).toBeVisible();
  expect(qa.errors).toEqual([]);
});

test('Cube responsive QA at 1440, 1024 and 390 pixels', async ({ page }) => {
  const qa = await setup(page);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const mode of ['01 Tổng quan', '02 Theo trạm', '03 Điều tra bất thường']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.locator('.cube-canvas canvas')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/cube-${mode.slice(0, 2)}-${width}.png`, fullPage: true });
    }
  }
  expect(qa.errors).toEqual([]);
});
