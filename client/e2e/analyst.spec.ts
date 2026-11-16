import type { Reading, ReadingAggregation } from '../src/shared/api/generated/wire';
import { test, expect, type Page } from '@playwright/test';
import examples from '../../docs/fixtures/frontend-online-examples.json' with { type: 'json' };
import c2 from '../../docs/fixtures/c2-online-examples.json' with { type: 'json' };
const fixture = (id: string) => structuredClone(examples.cases.find(c => c.id === id)!.response);
const first = (id: string) => (fixture(id) as { data: Record<string, unknown>[] }).data[0];
const ts = '2015-03-26T13:00:00.000Z', earlier = '2015-03-01T00:00:00.000Z';
const sensor = (i: number) => ({ ...first('sensors'), id: `s${i}`, name: ['Nongzhanguan', 'Guanyuan', 'Tiantan'][i], externalId: `qa-${i}` });
const target = { ...first('readings'), datasetId: 'dataset-001', id: 'target-outside-first-page', sensorId: 's0', ts, value: 369 } as Reading;
const anomaly = { ...first('anomalies'), datasetId: 'dataset-001', id: 'qa-flag', readingId: target.id, sensorId: 's0', analysisRunId: 'run-001', ts, location: target.location, method: 'zscore', family: 'statistical', score: 3.52, status: 'open', note: '', version: 1 };

async function setup(page: Page, options: { count?: number; missing?: boolean; losePost?: boolean } = {}) {
  const calls: URL[] = [], posts: { key?: string; body: unknown }[] = [], errors: string[] = [];
  let status = 'queued', state = { ...anomaly };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname; calls.push(url);
    if (path.endsWith('/profile')) {
      const p = structuredClone(c2.profile.data); p.datasetId = 'dataset-001';
      Object.assign(p.scope, { sensorIds: url.searchParams.getAll('sensorIds').length ? url.searchParams.getAll('sensorIds') : null, from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      Object.assign(p.dataset, { readingCount: options.count ?? 8782, sensorCount: 3, sensorsWithReadings: 3, observedFrom: earlier, observedTo: ts });
      Object.assign(p.scoped, p.dataset); return route.fulfill({ json: { data: p } });
    }
    if (path.endsWith('/reading-aggregates')) {
      const aggregate = structuredClone(c2.aggregates.data) as ReadingAggregation, ids = url.searchParams.getAll('sensorIds');
      Object.assign(aggregate, { datasetId: 'dataset-001', bucket: url.searchParams.get('bucket'), timeZone: url.searchParams.get('timeZone') });
      Object.assign(aggregate.scope, { sensorIds: ids, from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      const template = aggregate.series[0].buckets[0];
      aggregate.series = ids.map((id, i) => ({ sensorId: id, buckets: [0, 1, 2].map((n) => ({ ...template, start: new Date(Date.parse(earlier) + n * 86400_000).toISOString(), end: new Date(Date.parse(earlier) + (n + 1) * 86400_000).toISOString(), mean: n === 1 ? null : 50 + i * 10 + n * 20, min: n === 1 ? null : 50, max: n === 1 ? null : 100, count: n === 1 ? 0 : 10 })) }));
      return route.fulfill({ json: { data: aggregate } });
    }
    if (path.endsWith('/sensors')) return route.fulfill({ json: { data: [0, 1, 2].map(sensor), page: { limit: 100, nextCursor: null } } });
    if (path.endsWith('/readings')) {
      const exact = url.searchParams.get('from') === ts && url.searchParams.get('to') === ts;
      return route.fulfill({ json: { data: exact ? options.missing ? [{ ...target, id: 'nearby' }] : [target] : [{ ...target, id: 'first-page-reading', ts: earlier, value: 40 }], page: { limit: 100, nextCursor: null } } });
    }
    const run = { ...(fixture('analysis-detail') as { data: Record<string, unknown> }).data, id: 'run-001', datasetId: 'dataset-001', method: 'zscore', family: 'statistical', config: { threshold: 3 }, scope: {}, status, completedAt: status === 'completed' ? '2026-11-16T00:00:00.000Z' : undefined };
    if (path.endsWith('/analysis-runs') && request.method() === 'POST') {
      posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      if (options.losePost && posts.length === 1) return route.abort();
      return route.fulfill({ status: 202, json: { data: run } });
    }
    if (path.endsWith('/analysis-runs/run-001')) return route.fulfill({ json: { data: run } });
    if (path.endsWith('/analysis-runs')) return route.fulfill({ json: { data: [{ ...run, status: 'completed', completedAt: '2026-11-16T00:00:00.000Z' }], page: { limit: 100, nextCursor: null } } });
    if (path.endsWith('/anomalies/qa-flag')) {
      if (request.method() === 'PATCH') { const body = request.postDataJSON(); state = { ...state, ...body.changes, version: state.version + 1 }; }
      return route.fulfill({ json: { data: state } });
    }
    if (path.endsWith('/anomalies')) return route.fulfill({ json: { data: [state], page: { limit: 100, nextCursor: null } } });
    if (path.endsWith('/datasets')) { const body = fixture('datasets') as { data: Record<string, unknown>[] }; body.data[0].name = 'Analyst UX · dữ liệu QA mô phỏng'; return route.fulfill({ json: body }); }
    return route.fulfill({ json: fixture(path.endsWith('/auth/tokens') ? 'login' : path.endsWith('/users/me') ? 'me' : 'health') });
  });
  await page.goto('/datasets'); await page.getByLabel('Tên đăng nhập', { exact: true }).fill('analyst01'); await page.getByLabel('Mật khẩu', { exact: true }).fill('demo-password'); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await page.getByRole('link', { name: 'Mở dữ liệu', exact: true }).click();
  return { calls, posts, errors, complete: () => { status = 'completed'; } };
}

test('Exploration uses Profile/aggregates, keeps gaps and explicitly hands comparison scope to Analysis without POST', async ({ page }) => {
  const qa = await setup(page); await page.getByRole('button', { name: 'Data Exploration', exact: true }).click();
  await expect(page.getByTestId('exploration-profile')).toContainText('8.782'); await expect(page.getByTestId('exploration-coverage')).toContainText('Chưa xác định');
  await expect(page.getByTestId('exploration-aggregates')).toContainText('3 series × 3 buckets');
  const path = await page.locator('.ux-chart svg path').first().getAttribute('d'); expect(path?.match(/M/g)).toHaveLength(2);
  await page.getByRole('button', { name: 'Phân tích phạm vi này', exact: true }).first().click(); await page.getByRole('button', { name: 'Các trạm đang so sánh (3)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tạo một lần phân tích', exact: true })).toBeVisible(); expect(qa.posts).toEqual([]);
  await expect(page.locator('.ux-scope-summary')).toContainText('Nongzhanguan, Guanyuan, Tiantan'); await expect(page.locator('.ux-scope-summary')).toContainText('Toàn bộ thời gian');
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra phạm vi và phương pháp phân tích.', exact: true }).check(); await page.getByRole('radio', { name: /IQR/ }).check(); await expect(page.getByRole('checkbox', { name: 'Tôi đã kiểm tra phạm vi và phương pháp phân tích.', exact: true })).not.toBeChecked();
  expect(qa.errors).toEqual([]);
});

test('Analysis refuses known >50k scope, preserves same-key replay after lost response and reload', async ({ page }) => {
  const qa = await setup(page, { losePost: true }); await page.getByRole('button', { name: 'Analysis', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra phạm vi và phương pháp phân tích.', exact: true }).check(); await page.getByRole('button', { name: 'Chạy phát hiện bất thường', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thử lại cùng key', exact: true })).toBeEnabled(); expect(qa.posts).toHaveLength(1);
  await page.reload(); await page.getByRole('button', { name: 'Analysis', exact: true }).click(); expect(qa.posts).toHaveLength(1); await page.getByRole('button', { name: 'Thử lại cùng key', exact: true }).click();
  await expect(page.getByTestId('run-status')).toContainText('queued'); expect(qa.posts).toHaveLength(2); expect(qa.posts[0]).toEqual(qa.posts[1]);
  expect(qa.errors).toEqual([]);
});

test('Analysis blocks known over-limit Profile', async ({ page }) => {
  await setup(page, { count: 50001 }); await page.getByRole('button', { name: 'Analysis', exact: true }).click(); await expect(page.getByText('Phạm vi có nhiều hơn 50.000 readings.', { exact: false })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra phạm vi và phương pháp phân tích.', exact: true }).check(); await expect(page.getByRole('button', { name: 'Chạy phát hiện bất thường', exact: true })).toBeDisabled();
});

test('exact investigation outside first page restores the list/run and protects dirty review', async ({ page }) => {
  const qa = await setup(page); await page.getByRole('button', { name: 'Anomalies', exact: true }).click(); await page.getByRole('button', { name: 'Review qa-flag', exact: true }).click(); await expect(page.locator('.ux-reading')).toContainText('369');
  await page.getByRole('region', { name: 'Bảng anomalies', exact: true }).evaluate(node => node.setAttribute('data-list-kept', 'yes'));
  await page.getByRole('button', { name: 'Điều tra trên Cube', exact: true }).click(); await expect(page.getByRole('region', { name: 'Điều tra reading', exact: true })).toContainText('Đã xác minh đúng ID'); await expect(page.locator('.cube-inspector')).toContainText('Reading: target-outside-first-page');
  await expect(page.locator('.cube-canvas')).toHaveAttribute('data-points', '1');
  await page.getByRole('button', { name: 'Quay lại Anomalies', exact: true }).click(); await expect(page.getByRole('region', { name: 'Bảng anomalies', exact: true })).toHaveAttribute('data-list-kept', 'yes');
  await page.getByRole('button', { name: 'Đánh giá phát hiện', exact: true }).click(); await page.getByLabel('Ghi chú', { exact: true }).fill('Giữ ghi chú chưa lưu'); page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Visualization', exact: true }).click(); await expect(page.getByLabel('Ghi chú', { exact: true })).toHaveValue('Giữ ghi chú chưa lưu');
  expect(qa.calls.filter(u => u.pathname.endsWith('/anomalies')).every(u => !u.searchParams.has('sensorId') && !u.searchParams.has('bbox'))).toBe(true); expect(qa.posts).toEqual([]); expect(qa.errors).toEqual([]);
});

test('unresolved exact reading is reported and never replaced with a nearby point', async ({ page }) => {
  const qa = await setup(page, { missing: true }); await page.getByRole('button', { name: 'Anomalies', exact: true }).click(); await page.getByRole('button', { name: 'Review qa-flag', exact: true }).click(); await expect(page.locator('.ux-reading')).toContainText('Không tìm thấy reading tương ứng');
  await page.getByRole('button', { name: 'Điều tra trên Cube', exact: true }).click(); await expect(page.getByRole('region', { name: 'Điều tra reading', exact: true })).toContainText('Không tìm thấy reading tương ứng'); await expect(page.locator('.cube-canvas')).toHaveCount(0); expect(qa.errors).toEqual([]);
});

test('Analyst responsive desktop/tablet/mobile has visible list/review actions and no page overflow', async ({ page }) => {
  const qa = await setup(page);
  for (const width of [1600, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const tab of ['Data Exploration', 'Analysis', 'Anomalies']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      if (tab === 'Anomalies') { if (await page.getByRole('button', {name:'Về danh sách phát hiện',exact:true}).isVisible()) await page.getByRole('button', {name:'Về danh sách phát hiện',exact:true}).click(); await page.getByRole('button', { name: 'Review qa-flag', exact: true }).click(); await expect(page.getByRole('button', { name: 'Đánh giá phát hiện', exact: true })).toBeVisible(); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/analyst-${tab.replaceAll(' ', '-')}-${width}.png`, fullPage: true });
    }
  }
  expect(qa.errors).toEqual([]);
});
