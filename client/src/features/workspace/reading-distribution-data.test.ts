import { expect,it,vi } from 'vitest';
import c2 from '../../../../docs/fixtures/c2-online-examples.json';
import type { OnlineDataSource } from '../../shared/data-source/types';
import type { DatasetProfile,ReadingAggregation } from '../../shared/api/generated/wire';
import { loadDistribution } from './reading-distribution-data';
const day=86400_000,base=Date.UTC(2020,0,1),iso=(n:number)=>new Date(base+n).toISOString();
function source(stations=12,days=800){
 const profile=structuredClone(c2.profile.data) as DatasetProfile;
 profile.datasetId='d';Object.assign(profile.scoped,{readingCount:stations*days,sensorCount:stations,observedFrom:iso(0),observedTo:iso((days-1)*day)});
 const aggregate=vi.fn<OnlineDataSource['aggregates']['get']>(async q=>{
  const ids=q.sensorIds??Array.from({length:stations},(_,i)=>`s${i}`),result=structuredClone(c2.aggregates.data) as ReadingAggregation;
  Object.assign(result,{datasetId:'d',bucket:q.bucket,timeZone:q.timeZone,scope:{sensorIds:q.sensorIds??null,bbox:q.bbox??null,from:q.from,to:q.to}});
  result.series=ids.map(sensorId=>({sensorId,buckets:Array.from({length:days},(_,i)=>i).filter(i=>Date.parse(iso(i*day))>=Date.parse(q.from!)&&Date.parse(iso(i*day))<=Date.parse(q.to!)).map(i=>({...result.series[0].buckets[0],start:iso(i*day),end:iso((i+1)*day),count:1}))}));return result;
 });
 const sensors=vi.fn<OnlineDataSource['sensors']['list']>(async()=>({data:Array.from({length:stations},(_,i)=>({id:`s${i}`})) as never,page:{limit:100,nextCursor:null}}));
 const data={datasets:{profile:vi.fn().mockResolvedValue(profile)},aggregates:{get:aggregate},sensors:{list:sensors}} as unknown as OnlineDataSource;
 return {data,profile,aggregate,sensors};
}
it('counts the complete Workspace through disjoint API windows, without raw readings',async()=>{
 const s=source();const result=await loadDistribution(s.data,'d',{},'UTC','day',new AbortController().signal);
 expect(result.count).toBe(9600);expect(result.buckets).toHaveLength(800);expect(s.aggregate).toHaveBeenCalledTimes(3);
 const queries=s.aggregate.mock.calls.map(c=>c[0]);for(let i=1;i<queries.length;i++)expect(Date.parse(queries[i].from!)).toBe(Date.parse(queries[i-1].to!)+1);
});
it('partitions more than twenty stations without losing or double-counting series',async()=>{
 const s=source(25,2);expect((await loadDistribution(s.data,'d',{},'UTC','day',new AbortController().signal)).count).toBe(50);
 expect(s.sensors).toHaveBeenCalledOnce();expect(s.aggregate.mock.calls.map(c=>c[0].sensorIds?.length)).toEqual([20,5]);
});
it('rejects mismatched counts, metadata changes and later partition failures instead of partial charts',async()=>{
 const s=source();s.profile.scoped.readingCount++;
 await expect(loadDistribution(s.data,'d',{},'UTC','day',new AbortController().signal)).rejects.toThrow('khớp Profile');
 const changed=source();changed.profile.metadata.version=2;
 await expect(loadDistribution(changed.data,'d',{},'UTC','day',new AbortController().signal)).rejects.toThrow('đầy đủ phạm vi');
 const failed=source();failed.aggregate.mockRejectedValueOnce(new Error('unavailable'));
 await expect(loadDistribution(failed.data,'d',{},'UTC','day',new AbortController().signal)).rejects.toThrow('unavailable');
});
it('does not reuse profile counts for a different scope',async()=>{
 const s=source();await expect(loadDistribution(s.data,'d',{sensorId:'s0'},'UTC','day',new AbortController().signal)).rejects.toThrow('đúng phạm vi');expect(s.aggregate).not.toHaveBeenCalled();
});
