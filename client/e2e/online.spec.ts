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
