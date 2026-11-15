import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import examples from '../../docs/fixtures/frontend-online-examples.json' with { type: 'json' };

// Read-only CSV verification through intercepted HTTP. Never writes to the server.
const csvPath = process.argv[2] ?? '../.local/demo-datasets/beijing-12-stations-demo-2015-03.csv';
const output = process.argv[3] ?? '../docs/frontend/cube/qa';
const baseUrl = process.env.UI_BASE_URL ?? 'http://127.0.0.1:4276';
const fixture = id => structuredClone(examples.cases.find(item => item.id === id).response);
const lines = (await readFile(csvPath, 'utf8')).trim().split(/\r?\n/);
const headers = lines.shift().split(',');
const readings = lines.map((line, i) => {
  const r = Object.fromEntries(line.split(',').map((value, j) => [headers[j], value]));
  return { id: `qa-csv-${i + 1}`, datasetId: 'dataset-001', sensorId: r.sensorId, ts: new Date(r.timestamp).toISOString(), value: Number(r.value), unit: 'ug/m3', location: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] } };
});
const sensors = [...new Map(readings.map(r => [r.sensorId, { id: r.sensorId, datasetId: r.datasetId, externalId: r.sensorId, name: r.sensorId, location: r.location, type: 'pm25', unit: 'ug/m3' }])).values()];
const t = (day, hour) => new Date(Date.UTC(2015, 2, day, hour - 8)).toISOString();
const mean = values => values.reduce((a,b) => a+b,0)/values.length;
const a = readings.filter(r => r.ts === t(16,19)), b = readings.filter(r => r.sensorId === 'Nongzhanguan' && r.ts >= t(26,17) && r.ts <= t(26,23));
const other = readings.filter(r => r.ts === t(26,21) && r.sensorId !== 'Nongzhanguan').map(r => r.value).sort((a,b)=>a-b);
let candidates = 0;
for (const sensor of sensors) {
  const rows = readings.filter(r => r.sensorId === sensor.id), m = mean(rows.map(r=>r.value)), std = Math.sqrt(mean(rows.map(r=>(r.value-m)**2)));
  candidates += rows.filter(r => std > 0 && (r.value-m)/std > 3).length;
}
const report = { source: csvPath, csvRows: readings.length, stations: sensors.length, distinctTimestamps: new Set(readings.map(r=>r.ts)).size, missingStationHours: 12*31*24-readings.length, duplicates: readings.length-new Set(readings.map(r=>`${r.sensorId}|${r.ts}`)).size, min: Math.min(...readings.map(r=>r.value)), max: Math.max(...readings.map(r=>r.value)), eventA: { readings:a.length, mean:mean(a.map(r=>r.value)) }, eventB: { values:b.map(r=>r.value), otherStations:other.length, otherMedian:other[Math.floor(other.length/2)] }, positiveZscoreCandidatesFullCsv: candidates, ddof: 0, uiUsesOfficialAnomaliesOnly: true, transport: 'HTTP interception; CSV values preserved, QA IDs; no database writes', screenshots: [] };
expect(report).toMatchObject({ csvRows:8782, stations:12, distinctTimestamps:739, missingStationHours:146, duplicates:0, min:3, max:369, eventA:{readings:12,mean:315.5}, eventB:{values:[69,84,84,235,369],otherStations:11,otherMedian:80}, positiveZscoreCandidatesFullCsv:100 });
await mkdir(output,{recursive:true});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost:3001/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (route.request().method() !== 'GET' && !path.endsWith('/auth/tokens')) throw new Error('Unexpected write in CSV QA');
    if (path.endsWith('/readings')) {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to'), sensor = url.searchParams.get('sensorId');
      const data = readings.filter(r=>(!from||Date.parse(r.ts)>=Date.parse(from))&&(!to||Date.parse(r.ts)<=Date.parse(to))&&(!sensor||r.sensorId===sensor)).sort((a,b)=>(Date.parse(a.ts)-Date.parse(b.ts))*(url.searchParams.get('sort')==='ts:desc'?-1:1)||a.id.localeCompare(b.id));
      const start=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??100);
      return route.fulfill({json:{data:data.slice(start,start+limit),page:{limit,nextCursor:start+limit<data.length?String(start+limit):null}}});
    }
    if(path.endsWith('/sensors')) return route.fulfill({json:{data:sensors,page:{limit:100,nextCursor:null}}});
    if(path.endsWith('/datasets')) { const body=fixture('datasets'); body.data[0].name='Beijing 03/2015 · CSV thật · QA HTTP';Object.assign(body.data[0].importSummary,{totalRows:readings.length,importedRows:readings.length});return route.fulfill({json:body}); }
    if(path.endsWith('/analysis-runs')||path.endsWith('/anomalies')) return route.fulfill({json:{data:[],page:{limit:100,nextCursor:null}}});
    return route.fulfill({json:fixture(path.endsWith('/auth/tokens')?'login':path.endsWith('/users/me')?'me':'health')});
  });
  await page.goto(`${baseUrl}/datasets`);await page.getByLabel('Tên đăng nhập',{exact:true}).fill('analyst01');await page.getByLabel('Mật khẩu',{exact:true}).fill('demo-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('link',{name:'Mở dữ liệu',exact:true}).click();await page.getByRole('button',{name:'Cube',exact:true}).click();await expect(page.locator('.cube-renderer[data-ready=true]')).toBeVisible();
  await page.getByLabel('Múi giờ Cube',{exact:true}).selectOption('8');
  const changeDay=async day=>{await page.getByLabel('Từ Cube · UTC+08',{exact:true}).fill(`2015-03-${day}T00:00`);await page.getByRole('button',{name:'Xem phạm vi',exact:true}).click();const count=readings.filter(r=>r.ts>=t(day,0)&&r.ts<t(day+1,0)).length;await expect(page.getByTestId('cube-coverage')).toContainText(`${count} readings`);};
  const capture=async name=>{const file=`${name}.png`;await page.screenshot({path:`${output}/${file}`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);report.screenshots.push(file);};
  await changeDay(16);await page.getByLabel('Lát thời gian Cube',{exact:true}).selectOption(t(16,19));await expect(page.getByTestId('cube-slice-mean')).toContainText('315,5');await capture('overview-1440');
  const camera=await page.locator('.cube-canvas').getAttribute('data-camera');
  await page.getByRole('button',{name:'02 Theo trạm',exact:true}).click();await page.getByLabel('Trạm trong Cube',{exact:true}).selectOption('Nongzhanguan');await changeDay(26);await page.getByLabel('Lát thời gian Cube',{exact:true}).selectOption(t(26,21));await page.getByRole('region',{name:'Chuỗi giờ của trạm',exact:true}).getByRole('button',{name:'21:00',exact:true}).click();await expect(page.locator('.cube-inspector')).toContainText('369');await expect(page.locator('.cube-panel')).toContainText('Trung vị 11 trạm khác tại lát: 80');
  for(const hour of ['22:00','23:00'])await expect(page.getByRole('region',{name:'Chuỗi giờ của trạm',exact:true}).getByRole('row').filter({hasText:hour})).toContainText('Thiếu mẫu');
  await expect(page.locator('.cube-canvas')).toHaveAttribute('data-camera',camera);
  for(const width of [1440,1024,390]){await page.setViewportSize({width,height:width===390?844:900});await capture(`station-${width}`);}
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'03 Điều tra bất thường',exact:true}).click();await expect(page.getByText('Chưa có kết quả phát hiện bất thường được chọn.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Mở review',exact:true})).toHaveCount(0);await capture('anomaly-empty-1440');
  expect(errors).toEqual([]);report.pageErrors=errors;
  await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
