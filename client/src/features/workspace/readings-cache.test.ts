import { expect,it,vi } from 'vitest';
import type { Reading } from '../../shared/api/generated/wire';
import type { ReadingsQuery } from '../../shared/data-source/types';
import { createReadingsCache } from './readings-cache';
import { createCubeReadings } from './cube-readings';
import { loadSnapshot } from './snapshot';
import { linkedCubeScope } from './cube-data';
const ts=(n:number)=>new Date(Date.UTC(2026,0,1)+n).toISOString();
const row=(n:number,datasetId='d'):Reading=>({id:String(n),datasetId,sensorId:'s',ts:ts(n),value:n,unit:'ug/m3',location:{type:'Point',coordinates:[105,21]}});
const page=(data:Reading[],nextCursor:string|null=null)=>({data,page:{limit:100,nextCursor}});
it('cached and network snapshots use the same deterministic timestamp/ID tie-break',async()=>{
 const cache=createReadingsCache(vi.fn().mockResolvedValue(page([{...row(0),id:'Z'},{...row(0),id:'a'}])));
 await cache.load({datasetId:'d'});expect((await loadSnapshot(cache.load,{datasetId:'d',timestamp:ts(0)},new AbortController().signal,cache)).rows[0].id).toBe('a');
});
it('never treats a partial page as complete; reuses complete subranges and snapshots across views',async()=>{
 const load=vi.fn().mockResolvedValueOnce(page([row(0),row(1)],'p2')).mockResolvedValueOnce(page([row(2)]));
 const cache=createReadingsCache(load),q={datasetId:'d',from:ts(0),to:ts(2)};
 await cache.load(q);expect(cache.complete(q)).toBeUndefined();await cache.load({...q,cursor:'p2'});
 expect(cache.complete({...q,from:ts(1)})?.map(r=>r.id)).toEqual(['1','2']);
 const cube=createCubeReadings(cache);await cube.setQuery({...q,from:ts(1)});expect(cube.getSnapshot().data).toHaveLength(2);
 expect((await loadSnapshot(cache.load,{datasetId:'d',timestamp:ts(2),maxAgeMs:1},new AbortController().signal,cache)).rows[0].id).toBe('2');
 expect(load).toHaveBeenCalledTimes(2);expect(cache.stats().readings).toBe(3);cube.dispose();
});
it('merges only gap-free compatible completed intervals and isolates dataset/sensor/bbox',async()=>{
 const cache=createReadingsCache(vi.fn().mockImplementation((q:ReadingsQuery)=>Promise.resolve(page([row(Date.parse(q.from!)-Date.UTC(2026,0,1))]))));
 await cache.load({datasetId:'d',from:ts(0),to:ts(10)});await cache.load({datasetId:'d',from:ts(11),to:ts(20)});
 expect(cache.complete({datasetId:'d',from:ts(0),to:ts(20)})).toHaveLength(2);
 expect(cache.complete({datasetId:'other',from:ts(0),to:ts(20)})).toBeUndefined();
 expect(cache.complete({datasetId:'d',from:ts(0),to:ts(21)})).toBeUndefined();
 const narrow=createReadingsCache(vi.fn().mockResolvedValue(page([row(0)])));
 await narrow.load({datasetId:'d',sensorId:'s',bbox:[104,20,106,22]});
 expect(narrow.complete({datasetId:'d'})).toBeUndefined();
 expect(narrow.complete({datasetId:'d',sensorId:'s',bbox:[104.5,20.5,105.5,21.5]})).toHaveLength(1);
});
it('LRU invalidates coverage when any required record has been evicted',async()=>{
 const cache=createReadingsCache(vi.fn().mockImplementation((q:ReadingsQuery)=>Promise.resolve(page(q.datasetId==='d'?[row(0),row(1)]:[row(2,'other')]))),2);
 await cache.load({datasetId:'d'});await cache.load({datasetId:'other'});
 expect(cache.stats().readings).toBe(2);expect(cache.complete({datasetId:'d'})).toBeUndefined();expect(cache.complete({datasetId:'other'})).toHaveLength(1);
});
it('shares concurrent transport, cancels each consumer independently and fences clear',async()=>{
 let finish:(value:ReturnType<typeof page>)=>void=()=>{};const load=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const cache=createReadingsCache(load),a=new AbortController(),b=new AbortController();
 const first=cache.load({datasetId:'d'},{signal:a.signal}),second=cache.load({datasetId:'d'},{signal:b.signal});
 const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();a.abort();await rejected;
 expect(load.mock.calls[0][1].signal.aborted).toBe(false);finish(page([row(0)]));expect((await second).data).toHaveLength(1);expect(load).toHaveBeenCalledTimes(1);
 const third=cache.load({datasetId:'other'});const old=expect(third).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();cache.clear();finish(page([row(0,'other')]));await old;
 expect(cache.stats().readings).toBe(0);expect(cache.complete({datasetId:'d'})).toBeUndefined();
});
it.each([1999,2000,2001])('Cube publishes only a complete scope of at most 2000 (%i readings)',async count=>{
 const load=vi.fn().mockImplementation((q:ReadingsQuery)=>{const offset=Number(q.cursor??0);const rows=Array.from({length:Math.min(q.limit??100,count-offset)},(_,i)=>row(i+offset));return Promise.resolve(page(rows,offset+rows.length<count?String(offset+rows.length):null));});
 const cache=createReadingsCache(load),cube=createCubeReadings(cache);await cube.setQuery({datasetId:'d'});
 expect(cube.getSnapshot().data).toHaveLength(count>2000?0:count);expect(Boolean(cube.getSnapshot().nextCursor)).toBe(count>2000);expect(load.mock.calls.length).toBe(20);cube.dispose();
});
it('Cube refuses a failed later page and never publishes a truncated frame/statistics',async()=>{
 const cube=createCubeReadings(createReadingsCache(vi.fn().mockResolvedValueOnce(page([row(0)],'next')).mockRejectedValueOnce(new Error('offline'))));
 await cube.setQuery({datasetId:'d'});expect(cube.getSnapshot()).toMatchObject({status:'error',data:[]});cube.dispose();
});
it('late pages from an abandoned Cube scope cannot replace the new complete scope or refill cache',async()=>{
 let finish:(value:ReturnType<typeof page>)=>void=()=>{};
 const cache=createReadingsCache(vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(page([row(2)]))),cube=createCubeReadings(cache);
 const old=cube.setQuery({datasetId:'d',from:ts(0),to:ts(1)});await Promise.resolve();
 await cube.setQuery({datasetId:'d',from:ts(2),to:ts(2)});finish(page([row(0)]));await old;await Promise.resolve();
 expect(cube.getSnapshot()).toMatchObject({status:'ready',data:[row(2)]});expect(cache.complete({datasetId:'d',from:ts(0),to:ts(1)})).toBeUndefined();cube.dispose();
});
it('browses 500000 synthetic readings with bounded cache and opaque server cursors',async()=>{
 let calls=0;const cache=createReadingsCache(async q=>{calls++;const offset=Number(q.cursor??0);const data=Array.from({length:100},(_,i)=>row(offset+i));return page(data,offset+100<500000?String(offset+100):null);});
 let cursor:string|undefined,last:Reading|undefined;
 do{const result=await cache.load({datasetId:'d',cursor,limit:100});last=result.data.at(-1);cursor=result.page.nextCursor??undefined;}while(cursor);
 expect(last?.id).toBe('499999');expect(calls).toBe(5000);expect(cache.stats().readings).toBeLessThanOrEqual(50000);expect(cache.stats().pages).toBeLessThanOrEqual(256);
 expect(cache.complete({datasetId:'d'})).toBeUndefined();
},30000);
it('links Cube windows around T, keeps user windows and restores nominal duration after clipping',()=>{
 const t=ts(24*3600_000),scope=linkedCubeScope(t,{});
 expect(Date.parse(scope.to)-Date.parse(scope.from)+1).toBe(24*3600_000);expect(Date.parse(scope.from)).toBe(Date.parse(t)-12*3600_000);
 expect(linkedCubeScope(t,{},scope)).toBe(scope);
 const clipped=linkedCubeScope(ts(0),{from:ts(0)},undefined,24*3600_000);
 expect(linkedCubeScope(ts(48*3600_000),{from:ts(0)},clipped,24*3600_000)).toEqual(linkedCubeScope(ts(48*3600_000),{from:ts(0)}));
});
