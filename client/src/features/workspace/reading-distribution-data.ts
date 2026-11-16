import type { OnlineDataSource } from '../../shared/data-source/types';
import type { WorkspaceFilters } from './state';
import { explorationOffset,type ExplorationTimeZone } from '@pm25/shared-core';
export interface CountBucket {start:string;end:string;count:number}
const sameTime=(a:string|null|undefined,b:string|null|undefined)=>!a&&!b||Boolean(a&&b&&Date.parse(a)===Date.parse(b));
/** Complete server counts over disjoint station/time partitions; never counts raw cached points. */
export async function loadDistribution(data:OnlineDataSource,datasetId:string,filters:WorkspaceFilters,zone:ExplorationTimeZone,bucket:'hour'|'day',signal:AbortSignal) {
 const profile=await data.datasets.profile(datasetId,{sensorIds:filters.sensorId?[filters.sensorId]:undefined,bbox:filters.bbox,from:filters.from,to:filters.to}, {signal});
 if(!profile.complete||profile.datasetId!==datasetId||JSON.stringify(profile.scope.bbox)!==JSON.stringify(filters.bbox??null)||JSON.stringify(profile.scope.sensorIds)!==JSON.stringify(filters.sensorId?[filters.sensorId]:null)||!sameTime(profile.scope.from,filters.from)||!sameTime(profile.scope.to,filters.to))throw new Error('Profile chưa xác nhận đúng phạm vi Workspace.');
 const from=filters.from??profile.scoped.observedFrom,to=filters.to??profile.scoped.observedTo;
 if(!from||!to)return {buckets:[] as CountBucket[],count:0,from,to};
 const size=bucket==='hour'?3600_000:86400_000;
 const offset=explorationOffset(zone)*3600_000;
 if(Math.floor((Date.parse(to)+offset)/size)-Math.floor((Date.parse(from)+offset)/size)+1>4000)throw new Error('Biểu đồ vượt 4.000 cột. Chọn theo ngày hoặc thu hẹp phạm vi Workspace.');
 let groups:(string[]|undefined)[]=[filters.sensorId?[filters.sensorId]:undefined];
 if(!filters.sensorId&&profile.scoped.sensorCount>20){
  const ids:string[]=[],seen=new Set<string>();let cursor:string|undefined;
  do{const page=await data.sensors.list({datasetId,bbox:filters.bbox,sort:'externalId:asc',limit:100,cursor},{signal});signal.throwIfAborted();ids.push(...page.data.map(s=>s.id));const next=page.page.nextCursor;if(next&&(!page.data.length||seen.has(next)))throw new Error('Cursor trạm không tiến triển.');if(next)seen.add(next);cursor=next??undefined;}while(cursor);
  if(new Set(ids).size!==ids.length||ids.length!==profile.scoped.sensorCount)throw new Error('Danh sách trạm thay đổi; làm mới để xác nhận phạm vi đầy đủ.');
  groups=Array.from({length:Math.ceil(ids.length/20)},(_,i)=>ids.slice(i*20,i*20+20));
 }
 const bins=new Map<string,CountBucket>(),chunkMs=(bucket==='hour'?30:365)*86400_000;
 for(let start=Date.parse(from);start<=Date.parse(to);start+=chunkMs){
  const end=Math.min(Date.parse(to),start+chunkMs-1);
  for(const sensorIds of groups){
   signal.throwIfAborted();
   const result=await data.aggregates.get({datasetId,sensorIds,bbox:filters.bbox,from:new Date(start).toISOString(),to:new Date(end).toISOString(),timeZone:zone,bucket},{signal});
   if(!result.complete||result.datasetId!==datasetId||Date.parse(result.scope.from!)!==start||Date.parse(result.scope.to!)!==end||result.bucket!==bucket||result.timeZone!==zone||result.metadataVersion!==profile.metadata.version||JSON.stringify(result.scope.bbox)!==JSON.stringify(filters.bbox??null)||JSON.stringify(result.scope.sensorIds?[...result.scope.sensorIds].sort():null)!==JSON.stringify(sensorIds?[...sensorIds].sort():null))throw new Error('Server chưa xác nhận đầy đủ phạm vi phân bố.');
   const expected=sensorIds??(profile.scoped.sensorCount<=20?undefined:[]);
   if(new Set(result.series.map(s=>s.sensorId)).size!==result.series.length)throw new Error('Series trạm bị trùng.');
   if(expected?(result.series.length!==expected.length||result.series.some(s=>!expected.includes(s.sensorId))):result.series.length!==profile.scoped.sensorCount)throw new Error('Thiếu series trạm trong phân bố.');
   for(const series of result.series)for(const b of series.buckets){const prior=bins.get(b.start);bins.set(b.start,{start:b.start,end:b.end,count:(prior?.count??0)+b.count});}
  }
 }
 const buckets=[...bins.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const count=buckets.reduce((n,b)=>n+b.count,0);
 if(count!==profile.scoped.readingCount)throw new Error('Số đếm không còn khớp Profile; dữ liệu có thể đã thay đổi, hãy làm mới.');
 return {buckets,count,from,to};
}
