import { test, expect } from '@playwright/test';

test('creates the offline IndexedDB schema before login, even when the Backend is unavailable', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();

  await expect.poll(async () => page.evaluate(async () => {
    if (typeof indexedDB.databases !== 'function') return [];
    const databases = await indexedDB.databases();
    return databases.map((database) => database.name);
  })).toContain('PM25ExplorerOffline');

  const stores = await page.evaluate(async () => {
    const request = indexedDB.open('PM25ExplorerOffline');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = Array.from(database.objectStoreNames);
    database.close();
    return names;
  });

  expect(stores).toEqual(expect.arrayContaining([
    'datasets',
    'sensors',
    'readings',
    'analysisRuns',
    'anomalies',
    'coverage',
    'outbox',
    'workspace',
    'meta',
  ]));
});
