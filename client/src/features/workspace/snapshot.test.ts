import { expect,it,vi } from 'vitest';
import type { Reading } from '../../shared/api/generated/wire';
import { loadSnapshot,createSnapshot } from './snapshot';
const timestamp='2026-11-11T00:00:00.000Z', query={datasetId:'d',timestamp};
const row=(id:string,ts=timestamp):Reading=>({id,sensorId:id,datasetId:'d',ts,value:25,unit:'ug/m3',location:{type:'Point',coordinates:[105,21]}});
const page=(data:Reading[],nextCursor:string|null=null)=>({data,page:{limit:100,nextCursor}});
it('reads all pages at exactly one instant, independent of the time-series first page',async()=>{
 const load=vi.fn().mockResolvedValueOnce(page([row('A')],'next')).mockResolvedValueOnce(page([row('B')]));
 expect(await loadSnapshot(load,query,new AbortController().signal)).toEqual({rows:[row('A'),row('B')],hasMore:false});
 expect(load.mock.calls[0][0]).toMatchObject({datasetId:'d',from:timestamp,to:timestamp,limit:100});
 expect(load.mock.calls[1][0]).toMatchObject({from:timestamp,to:timestamp,cursor:'next'});
});
it('rejects wrong timestamp/dataset instead of showing mixed-time samples',async()=>{
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
it('caps snapshots at 2000 with an explicit remaining-page flag',async()=>{
 let count=0;const load=vi.fn().mockImplementation(()=>{const data=Array.from({length:100},()=>row(String(count++)));return Promise.resolve(page(data,String(count)));});
 const result=await loadSnapshot(load,query,new AbortController().signal);expect(result.rows).toHaveLength(2000);expect(result.hasMore).toBe(true);expect(load).toHaveBeenCalledTimes(20);
});
