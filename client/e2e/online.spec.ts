import { test, expect } from '@playwright/test';
import examples from '../../docs/fixtures/frontend-online-examples.json';
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
