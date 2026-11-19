import { expect,it,vi } from 'vitest';
import type { Reading } from '../../../src/shared/api/generated/wire';
import { loadSnapshot,createSnapshot } from '../../../src/features/workspace/snapshot';
const timestamp='2026-11-11T00:00:00.000Z', query={datasetId:'d',timestamp};
const row=(id:string,ts=timestamp):Reading=>({id,sensorId:id,datasetId:'d',ts,value:25,unit:'ug/m3',location:{type:'Point',coordinates:[105,21]}});
const page=(data:Reading[],nextCursor:string|null=null)=>({data,page:{limit:100,nextCursor}});
it('reads a bounded lookback window across all pages, independent of the time-series first page',async()=>{
 const load=vi.fn().mockResolvedValueOnce(page([row('A')],'next')).mockResolvedValueOnce(page([row('B')]));
 expect(await loadSnapshot(load,query,new AbortController().signal)).toEqual({rows:[row('A'),row('B')],hasMore:false});
 expect(load.mock.calls[0][0]).toMatchObject({datasetId:'d',from:'2026-11-10T22:00:00.000Z',to:timestamp,limit:100});
 expect(load.mock.calls[1][0]).toMatchObject({from:'2026-11-10T22:00:00.000Z',to:timestamp,cursor:'next'});
});
it('rejects future/out-of-window and wrong-dataset samples',async()=>{
 await expect(loadSnapshot(vi.fn().mockResolvedValue(page([row('A','2026-11-12T00:00:00Z')])),query,new AbortController().signal)).rejects.toMatchObject({kind:'invalid-response'});
 await expect(loadSnapshot(vi.fn().mockResolvedValue(page([{...row('A'),datasetId:'other'}])),query,new AbortController().signal)).rejects.toMatchObject({kind:'invalid-response'});
});
it('does not publish a partial frame when a later page fails',async()=>{
 const load=vi.fn().mockResolvedValueOnce(page([row('A')],'next')).mockRejectedValueOnce(new Error('offline'));
 const resource=createSnapshot(load);await resource.read(query);
 expect(resource.getSnapshot()).toMatchObject({status:'error',rows:[]});resource.dispose();
});
it('ignores responses from an old time and stops repeat cursors',async()=>{
 let oldResolve:(value:ReturnType<typeof page>)=>void=()=>{};
 const load=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{oldResolve=resolve;})).mockResolvedValue(page([row('B')]));
 const resource=createSnapshot(load);const old=resource.read(query);await resource.read(query);oldResolve(page([row('A')]));await old;
 expect(resource.getSnapshot().rows.map(r=>r.id)).toEqual(['B']);resource.dispose();
 const repeated=vi.fn().mockResolvedValueOnce(page([row('A')],'same')).mockResolvedValueOnce(page([row('B')],'same'));
 await expect(loadSnapshot(repeated,query,new AbortController().signal)).rejects.toMatchObject({kind:'invalid-response'});
});
it('scans beyond 2000 raw readings without truncating or retaining a raw window',async()=>{
 let count=0;const load=vi.fn().mockImplementation(()=>{const data=Array.from({length:100},()=>({...row(String(count++)),sensorId:'A'}));return Promise.resolve(page(data,count<2500?String(count):null));});
 const result=await loadSnapshot(load,query,new AbortController().signal);expect(result.rows).toHaveLength(1);expect(result.hasMore).toBe(false);expect(load).toHaveBeenCalledTimes(25);
});

it('selects the newest sample per station, retains age boundary, omits stale samples via bounded query',async()=>{
 const older={...row('a-old','2026-11-10T22:00:00.000Z'),sensorId:'A'};
 const newest={...row('a-new','2026-11-10T23:30:00.000Z'),sensorId:'A'};
 const boundary={...row('b','2026-11-10T22:00:00.000Z'),sensorId:'B'};
 const load=vi.fn().mockResolvedValueOnce(page([newest,boundary],'p2')).mockResolvedValueOnce(page([older]));
 expect((await loadSnapshot(load,query,new AbortController().signal)).rows).toEqual([newest,boundary]);
 expect(load.mock.calls[0][0]).toMatchObject({sort:'ts:desc',from:'2026-11-10T22:00:00.000Z',to:timestamp});
 await expect(loadSnapshot(vi.fn().mockResolvedValue(page([row('stale','2026-11-10T21:59:59.999Z')])),query,new AbortController().signal)).rejects.toMatchObject({kind:'invalid-response'});
});
it('supports configurable maxAge, deterministic ties and the workspace lower time bound',async()=>{
 const load=vi.fn().mockResolvedValue(page([{...row('a'),sensorId:'S'},{...row('b'),sensorId:'S'}]));
 expect((await loadSnapshot(load,{...query,maxAgeMs:3600_000,from:'2026-11-10T23:30:00.000Z'},new AbortController().signal)).rows.map(r=>r.id)).toEqual(['b']);
 expect(load.mock.calls[0][0].from).toBe('2026-11-10T23:30:00.000Z');
});
it('keeps the last confirmed frame while loading or failing instead of flashing an empty map',async()=>{
 let reject:(reason:Error)=>void=()=>{};
 const resource=createSnapshot(vi.fn().mockResolvedValueOnce(page([row('A')])).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;})));
 await resource.read(query);
 const pending=resource.read({...query,timestamp:'2026-11-11T01:00:00Z'});
 expect(resource.getSnapshot()).toMatchObject({status:'loading',timestamp,rows:[row('A')]});
 reject(new Error('offline'));await pending;
 expect(resource.getSnapshot()).toMatchObject({status:'error',timestamp,rows:[row('A')]});resource.dispose();
});
