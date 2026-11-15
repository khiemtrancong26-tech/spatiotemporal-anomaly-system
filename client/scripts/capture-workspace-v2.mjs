import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import examples from '../../docs/fixtures/frontend-online-examples.json' with {type:'json'};
const fixture=id=>structuredClone(examples.cases.find(item=>item.id===id).response);
const dir=process.argv[2]??'docs/frontend/workspace-v2';await mkdir(dir,{recursive:true});
const base=process.env.UI_BASE_URL??'http://127.0.0.1:4177';
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
const t0='2026-11-11T01:00:00.000Z',t1='2026-11-11T02:00:00.000Z';
const stations=[['A',116.47,39.95],['B',116.44,39.97],['C',116.51,39.93]];
const readings=[t0,t1].flatMap((ts,i)=>stations.map(([id,lon,lat],j)=>({...fixture('readings').data[0],id:`qa-${id}-${i}`,sensorId:`qa-${id}`,ts,value:[30,65,120][j]+i*5,location:{type:'Point',coordinates:[lon,lat]}})));
await page.route('http://localhost:3001/api/v1/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 let response;
 if(path.endsWith('/datasets') && route.request().method()==='POST') return route.fulfill({status:201,json:fixture('upload')});
 if(path.endsWith('/validation')) return route.fulfill({json:fixture('validation')});
 if(path.endsWith('/readings'))response={data:url.searchParams.get('from')?readings.filter(r=>r.ts===url.searchParams.get('from')):readings,page:{limit:100,nextCursor:null}};
 else if(path.endsWith('/sensors'))response={data:stations.map(([id,lon,lat])=>({...fixture('sensors').data[0],id:`qa-${id}`,externalId:id,name:`Trạm ${id} (QA)`,location:{type:'Point',coordinates:[lon,lat]}})),page:{limit:100,nextCursor:null}};
 else if(path.endsWith('/datasets')){response=fixture('datasets');response.data[0].name='Workspace QA — 3 trạm mô phỏng';Object.assign(response.data[0].importSummary,{totalRows:6,importedRows:6,duplicateRows:0,conflictingRows:0,invalidRows:0,issues:[]});}
 else response=fixture(path.endsWith('/auth/tokens')?'login':path.endsWith('/users/me')?'me':'health');
 await route.fulfill({json:response});
});
await page.goto(`${base}/datasets`);await page.getByLabel('Tên đăng nhập',{exact:true}).fill('analyst01');await page.getByLabel('Mật khẩu',{exact:true}).fill('demo-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('link',{name:'Mở dữ liệu',exact:true}).click();
await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();await page.getByTestId('snapshot-status').filter({hasText:'3 trạm có mẫu'}).waitFor();
let mapReady=true;try{await page.locator('.renderer-surface[data-ready=true]').waitFor({timeout:40000});}catch{mapReady=false;}
for(const width of [1440,390]){
 await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:`${dir}/${mapReady?'map':'map-unavailable'}-${width}.png`,fullPage:true});
 if(mapReady)await page.locator('.explorer-stage').screenshot({path:`${dir}/map-stage-${width}.png`});
 if(width===1440)await page.screenshot({path:`${dir}/overview-1440.png`});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Viewport overflow');
}
await page.getByRole('button',{name:'Cube',exact:true}).click();await page.locator('.renderer-surface[data-ready=true]').waitFor();
await page.getByRole('button',{name:'Heatmap thời gian',exact:true}).click();
for(const width of [1440,390]){await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${dir}/cube-heatmap-${width}.png`,fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Viewport overflow');}
await page.goto(`${base}/datasets/import`);
await page.getByLabel('Tên dataset (tùy chọn)',{exact:true}).fill('Kiểm thử UI — không ghi vào Backend');
await page.getByLabel('File nguồn',{exact:true}).setInputFiles({name:'ui-qa.csv',mimeType:'text/csv',buffer:Buffer.from('station_id,lat,lon,observed_at,pm25\nA,10,106,2026-01-01T00:00:00Z,25\n')});
await page.getByRole('button',{name:'Upload',exact:true}).click();await page.getByRole('heading',{name:'3. Xác nhận mapping',exact:true}).waitFor();
for(const width of [1440,390]){await page.setViewportSize({width,height:width===1440?1000:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${dir}/import-mapping-${width}.png`,fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Import overflow');}
await browser.close();console.log(JSON.stringify({mapReady,stationsAtSameTime:3,fixtureOnly:true,directory:dir}));
