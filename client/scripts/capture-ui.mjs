import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const directory = process.argv[2] ?? 'test-results/ui-redesign';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:5173';
async function shot(name) {
  for (const width of [1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const filter = page.locator('details.workspace-control-panel');
    if (await filter.count()) {
      const open = await filter.getAttribute('open') !== null;
      if (open) await filter.locator('summary').click();
    }
    await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.screenshot({ path: `${directory}/${name}-${width}.png`, fullPage: true });
    if (name === 'workspace' && width === 1440) await page.screenshot({path:`${directory}/workspace-overview-1440.png`});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`${name} overflows at ${width}px`);
  }
}
await page.goto(`${base}/login`);
await shot('login');
await page.getByRole('link', {name:'Chưa có tài khoản? Đăng ký'}).click();
await shot('register');
await page.goto(`${base}/datasets`);
await page.getByLabel('Tên đăng nhập', {exact:true}).fill('admin01');
await page.getByLabel('Mật khẩu', {exact:true}).fill('demo-password');
await page.getByRole('button', {name:'Đăng nhập',exact:true}).click();
await page.getByRole('link', {name:'Mở dữ liệu',exact:true}).waitFor();
await shot('datasets');
await page.getByRole('link', {name:'Mở dữ liệu',exact:true}).click();
await page.getByRole('button', {name:'Chọn reading-001',exact:true}).waitFor();
await page.locator('canvas').first().waitFor();
await shot('workspace');
if (process.argv.includes('--map')) {
  await page.getByRole('button', {name:'Mapbox 3D',exact:true}).click();
  await page.getByLabel('Heatmap không gian',{exact:true}).check();
  await page.locator('.mapboxgl-canvas').waitFor({timeout:15000});
  await page.locator('.renderer-surface[data-ready=true]').waitFor({timeout:30000});
  await shot('map-heatmap');
  await page.getByRole('button', {name:'Cube',exact:true}).click();
}
await page.getByRole('button', {name:'Analysis',exact:true}).click();
await page.getByRole('heading', {name:'Analysis online',exact:true}).waitFor();
await page.getByRole('button', {name:'Xem run run-001',exact:true}).waitFor();
await shot('analysis');
await page.getByRole('button', {name:'Anomalies',exact:true}).click();
await page.getByRole('button', {name:'Review anomaly-001',exact:true}).waitFor();
await shot('anomalies');
await page.getByRole('button', {name:'Review anomaly-001',exact:true}).click();
await page.getByLabel('Ghi chú', {exact:true}).waitFor();
await shot('review');
await page.goto(`${base}/datasets/import`);
await page.getByRole('button', {name:'Upload',exact:true}).waitFor();
await shot('import');
await page.goto(`${base}/admin/users`);
await page.getByRole('button', {name:'Sửa admin01',exact:true}).waitFor();
await shot('admin');
await browser.close();
console.log(`Captured ${process.argv.includes('--map') ? 10 : 9} screens on desktop in ${directory}`);
