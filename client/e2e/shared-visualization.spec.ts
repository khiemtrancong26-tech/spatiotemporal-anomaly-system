import { test,expect,type Page } from '@playwright/test';
import examples from '../../docs/fixtures/frontend-online-examples.json' with {type:'json'};
import c2 from '../../docs/fixtures/c2-online-examples.json' with {type:'json'};
import type { ReadingAggregation } from '../src/shared/api/generated/wire';
const fixture=(id:string)=>structuredClone(examples.cases.find(c=>c.id===id)!.response);
const first=(id:string)=>(fixture(id) as {data:Record<string,unknown>[]}).data[0];
const base=Date.UTC(2015,0,1),H=3600_000,total=500000,datasetId='dataset-001';
const iso=(hour:number)=>new Date(base+hour*H).toISOString();
const local=(hour:number)=>new Date(base+(hour+7)*H).toISOString().slice(0,16);
const sensors=Array.from({length:12},(_,i)=>({...first('sensors'),id:`s${i}`,name:`Trạm QA ${i}`,externalId:`station-${i}`,location:{type:'Point',coordinates:[116.2+i%4*.1,39.7+Math.floor(i/4)*.15]}}));
// Virtual dataset: only requested HTTP pages are materialized; never added to online application code.
const reading=(i:number)=>({...first('readings'),datasetId,id:`r${i}`,sensorId:`s${i%12}`,ts:iso(Math.floor(i/12)),value:20+i%180,location:sensors[i%12].location});
const bounds=(p:URLSearchParams)=>({lo:Math.max(0,Math.ceil((Date.parse(p.get('from')??iso(0))-base)/H)*12),hi:Math.min(total-1,(Math.floor((Date.parse(p.get('to')??iso(Math.floor((total-1)/12)))-base)/H)+1)*12-1)});
const countStation=(lo:number,hi:number,s:number)=>Math.max(0,Math.floor((hi-s)/12)-Math.ceil((lo-s)/12)+1);
async function setup(page:Page,options:{failCubePage?:boolean}={}){
 const calls:URL[]=[],errors:string[]=[];let failed=false;
 page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:900});
 await page.route('http://localhost:3001/api/v1/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname,p=url.searchParams;calls.push(url);
  const {lo,hi}=bounds(p),ids=p.getAll('sensorIds'),scope={sensorIds:ids.length?ids:null,bbox:null,from:p.get('from'),to:p.get('to')};
  if(path.endsWith('/profile')){
   const profile=structuredClone(c2.profile.data);Object.assign(profile,{datasetId,scope});
   Object.assign(profile.scoped,{readingCount:Math.max(0,hi-lo+1),sensorCount:12,sensorsWithReadings:12,observedFrom:iso(Math.floor(lo/12)),observedTo:iso(Math.floor(hi/12))});
   Object.assign(profile.dataset,profile.scoped);return route.fulfill({json:{data:profile}});
  }
  if(path.endsWith('/reading-aggregates')){
   const result=structuredClone(c2.aggregates.data) as ReadingAggregation,size=p.get('bucket')==='hour'?H:24*H,offset=p.get('timeZone')==='UTC'?0:Number(p.get('timeZone')?.slice(0,3))*H;
   Object.assign(result,{datasetId,scope,bucket:p.get('bucket'),timeZone:p.get('timeZone')});
   const firstBucket=Math.floor((Date.parse(p.get('from')!)+offset)/size)*size-offset,lastBucket=Math.floor((Date.parse(p.get('to')!)+offset)/size)*size-offset,template=result.series[0].buckets[0];
   result.series=(ids.length?ids:sensors.map(s=>s.id)).map(sensorId=>({sensorId,buckets:Array.from({length:(lastBucket-firstBucket)/size+1},(_,b)=>{
    const start=firstBucket+b*size,end=start+size,a=Math.max(lo,Math.ceil((start-base)/H)*12),z=Math.min(hi,Math.ceil((end-base)/H)*12-1),count=countStation(a,z,Number(sensorId.slice(1)));
    return {...template,start:new Date(start).toISOString(),end:new Date(end).toISOString(),count,min:count?20:null,max:count?199:null,mean:count?100:null};
   })}));return route.fulfill({json:{data:result}});
  }
  if(path.endsWith('/readings')){
   if(options.failCubePage&&!failed&&p.get('sort')==='ts:asc'&&p.has('from')&&p.has('cursor')){failed=true;return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'QA failure'}}});}
   const limit=Number(p.get('limit')??100),cursor=Number(p.get('cursor')??0),descending=p.get('sort')==='ts:desc',sensor=p.get('sensorId');
   const data:ReturnType<typeof reading>[]=[];let skipped=0,more=false;
   for(let i=descending?hi:lo;descending?i>=lo:i<=hi;descending?i--:i++){
    if(sensor&&`s${i%12}`!==sensor)continue;if(skipped++<cursor)continue;
    if(data.length===limit){more=true;break;}data.push(reading(i));
   }
   return route.fulfill({json:{data,page:{limit,nextCursor:more?String(cursor+data.length):null}}});
  }
  if(path.endsWith('/sensors'))return route.fulfill({json:{data:sensors,page:{limit:100,nextCursor:null}}});
  if(path.endsWith('/analysis-runs')||path.endsWith('/anomalies'))return route.fulfill({json:{data:[],page:{limit:100,nextCursor:null}}});
  if(path.endsWith('/datasets')){const body=fixture('datasets') as {data:Record<string,unknown>[]};body.data[0].name='Shared visualization · 500k synthetic QA';Object.assign(body.data[0].importSummary as object,{totalRows:total,importedRows:total});return route.fulfill({json:body});}
  return route.fulfill({json:fixture(path.endsWith('/auth/tokens')?'login':path.endsWith('/users/me')?'me':'health')});
 });
 await page.goto('/datasets');await page.getByLabel('Tên đăng nhập',{exact:true}).fill('analyst01');await page.getByLabel('Mật khẩu',{exact:true}).fill('demo-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('link',{name:'Mở dữ liệu',exact:true}).click();
 if(!options.failCubePage)await expect(page.getByTestId('cube-coverage')).toContainText('144 readings');await expect(page.getByTestId('distribution-count')).toContainText('500.000 readings');
 return {calls,errors,raw:()=>calls.filter(u=>u.pathname.endsWith('/readings'))};
}
async function mapTime(page:Page,hour:number){
 await page.getByLabel('Chọn ngày giờ khác',{exact:true}).click();await page.getByLabel('Thời điểm bản đồ · UTC+07:00',{exact:true}).fill(local(hour));await page.getByRole('button',{name:'Hiển thị các trạm',exact:true}).click();await expect(page.getByTestId('snapshot-status')).toContainText('12 trạm có mẫu');
}
test('deep snapshot links selection/T/focus to a complete Cube and reuses coverage on return',async({page})=>{
 const qa=await setup(page);await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();await mapTime(page,30000);
 await page.getByRole('button',{name:'Chi tiết & lớp',exact:true}).click();await page.getByLabel('Xem chi tiết trạm tại thời điểm này',{exact:true}).selectOption('r360000');
 await page.getByRole('button',{name:'Cube',exact:true}).click();await expect(page.getByTestId('cube-coverage')).toContainText('288 readings');await expect(page.locator('.cube-inspector')).toContainText('r360000');await expect(page.getByLabel('Trạm trong Cube',{exact:true})).toHaveValue('s0');
 await expect(page.getByLabel('Từ Cube · UTC+07',{exact:true})).toHaveValue(local(29988));
 const canvas=page.locator('.cube-canvas canvas');await canvas.evaluate(el=>el.setAttribute('data-identity','preserved'));
 await page.getByRole('button',{name:'01 Tổng quan',exact:true}).click();await page.getByRole('button',{name:'02 Theo trạm',exact:true}).click();await expect(canvas).toHaveAttribute('data-identity','preserved');
 await page.getByLabel('Lát thời gian Cube',{exact:true}).selectOption(iso(30002));await expect(canvas).toHaveAttribute('data-identity','preserved');const before=qa.raw().length;
 await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();await expect(page.getByLabel('Thời điểm đã tải',{exact:true})).toHaveValue(iso(30002));await expect(page.getByTestId('snapshot-status')).toContainText('12 trạm có mẫu');expect(qa.raw()).toHaveLength(before);
 await expect(page.locator('.explorer-inspector')).toContainText('r360000');await page.getByRole('button',{name:'Cube',exact:true}).click();await expect(page.getByLabel('Từ Cube · UTC+07',{exact:true})).toHaveValue(local(29988));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/shared-cube-1440.png',fullPage:true});expect(qa.errors).toEqual([]);
});
test('over-budget Cube has no truncated renderer/stats; full-scope histogram narrows it',async({page})=>{
 const qa=await setup(page);await page.getByLabel('Từ Cube · UTC+07',{exact:true}).fill(local(0));await page.getByLabel('Cửa sổ Cube',{exact:true}).selectOption('168');await page.getByRole('button',{name:'Xem phạm vi',exact:true}).click();
 await expect(page.getByText('Phạm vi vượt giới hạn Cube chi tiết',{exact:false})).toBeVisible();await expect(page.locator('.cube-canvas')).toHaveCount(0);await expect(page.getByTestId('cube-slice-mean')).toHaveCount(0);await expect(page.getByTestId('distribution-count')).toContainText('500.000 readings');
 await page.locator('.distribution-bars button').nth(2).click();await expect(page.locator('.cube-renderer[data-ready=true]')).toBeVisible();await expect(page.getByTestId('cube-coverage')).toContainText('288 readings');await expect(page.getByLabel('Từ Cube · UTC+07',{exact:true})).toHaveValue('2015-01-03T00:00');
 await page.setViewportSize({width:1366,height:768});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/shared-cube-1366.png',fullPage:true});expect(qa.errors).toEqual([]);
});
test('manual Mapbox pages pass 2000, replace rows, keep T and reset cursor on sort/refresh',async({page})=>{
 const qa=await setup(page);await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();
 for(let i=0;i<22;i++){await page.locator('.explorer-status-actions').getByRole('button',{name:'Trang readings tiếp theo',exact:true}).click();await expect(page.locator('.explorer-status')).toContainText(`Trang ${i+2} · 100 readings`);}
 expect(qa.raw().some(u=>u.searchParams.get('cursor')==='2100'&&!u.searchParams.has('from'))).toBe(true);await expect(page.getByLabel('Thời điểm đã tải',{exact:true})).toHaveValue(iso(0));
 await page.getByRole('button',{name:'Xem bảng dữ liệu',exact:true}).click();await expect(page.locator('.records-scroll tbody tr')).toHaveCount(100);
 await page.getByLabel('Thứ tự thời gian',{exact:true}).selectOption('ts:desc');await expect(page.locator('.explorer-status')).toContainText('Trang 1 · 100 readings');await expect(page.getByRole('button',{name:'Trang readings trước',exact:true})).toBeDisabled();
 const before=qa.raw().length;await page.getByRole('button',{name:'Làm mới dữ liệu',exact:true}).click();await expect.poll(()=>qa.raw().length).toBeGreaterThan(before);await expect(page.locator('.records-scroll tbody tr')).toHaveCount(100);expect(qa.errors).toEqual([]);
});
test('later Cube page failure hides all detail until a successful retry',async({page})=>{
 const qa=await setup(page,{failCubePage:true});await expect(page.locator('.cube-explorer .state--error')).toBeVisible();await expect(page.locator('.cube-canvas')).toHaveCount(0);await expect(page.getByTestId('cube-slice-mean')).toHaveCount(0);
 await page.locator('.cube-explorer .state--error').getByRole('button').click();await expect(page.locator('.cube-renderer[data-ready=true]')).toBeVisible();await expect(page.getByTestId('cube-coverage')).toContainText('144 readings');expect(qa.errors).toEqual([]);
});
test('user 48-hour window is retained while T stays inside, then translated without filtering focus',async({page})=>{
 const qa=await setup(page);await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();await mapTime(page,30000);await page.getByRole('button',{name:'Cube',exact:true}).click();
 await page.getByLabel('Cửa sổ Cube',{exact:true}).selectOption('48');await page.getByLabel('Từ Cube · UTC+07',{exact:true}).fill(local(29976));await page.getByRole('button',{name:'Xem phạm vi',exact:true}).click();await expect(page.getByTestId('cube-coverage')).toContainText('576 readings');
 await page.getByLabel('Trạm trong Cube',{exact:true}).selectOption('s3');await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();await mapTime(page,30010);await page.getByRole('button',{name:'Cube',exact:true}).click();await expect(page.getByLabel('Từ Cube · UTC+07',{exact:true})).toHaveValue(local(29976));
 await page.getByRole('button',{name:'Mapbox 3D',exact:true}).click();await mapTime(page,30100);await page.getByRole('button',{name:'Cube',exact:true}).click();await expect(page.getByLabel('Từ Cube · UTC+07',{exact:true})).toHaveValue(local(30076));await expect(page.getByTestId('cube-coverage')).toContainText('576 readings');await expect(page.getByLabel('Trạm trong Cube',{exact:true})).toHaveValue('s3');
 expect(qa.raw().filter(u=>u.searchParams.has('from')).every(u=>!u.searchParams.has('sensorId'))).toBe(true);expect(qa.errors).toEqual([]);
});
