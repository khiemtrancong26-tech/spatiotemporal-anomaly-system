import type { Reading } from '../../shared/api/generated/wire';
import type { OnlineDataSource, ReadingPage, ReadingsQuery } from '../../shared/data-source/types';
import { DataSourceError } from '../../shared/api/errors';
export const CUBE_DETAIL_LIMIT = 2000;
export const READINGS_PAGE_SIZE = 100;
export const READINGS_CACHE_LIMIT = 50_000;
type Load = OnlineDataSource['readings']['list'];
type Scope = Omit<ReadingsQuery,'cursor'|'limit'|'sort'>;
type Coverage = {scope:Scope;ids:string[]};
const key = (q:ReadingsQuery) => JSON.stringify([q.datasetId,q.sensorId??null,q.bbox??null,q.from??null,q.to??null,q.sort??'ts:asc',q.limit??100]);
const lo = (q:Scope) => q.from ? Date.parse(q.from) : -Infinity;
const hi = (q:Scope) => q.to ? Date.parse(q.to) : Infinity;
const fits = (r:Reading,q:Scope) => r.datasetId===q.datasetId && (!q.sensorId||q.sensorId===r.sensorId) && Date.parse(r.ts)>=lo(q)&&Date.parse(r.ts)<=hi(q)&&(!q.bbox||(r.location.coordinates[0]>=q.bbox[0]&&r.location.coordinates[0]<=q.bbox[2]&&r.location.coordinates[1]>=q.bbox[1]&&r.location.coordinates[1]<=q.bbox[3]));
const compatible = (b:Scope,q:Scope) => b.datasetId===q.datasetId&&(!b.sensorId||b.sensorId===q.sensorId)&&(!b.bbox||Boolean(q.bbox&&b.bbox[0]<=q.bbox[0]&&b.bbox[1]<=q.bbox[1]&&b.bbox[2]>=q.bbox[2]&&b.bbox[3]>=q.bbox[3]));
/** Session RAM only. Completeness is provenance from contiguous HTTP pages, never inferred from points. */
export function createReadingsCache(loader:Load, capacity=READINGS_CACHE_LIMIT, offline=()=>false) {
  if(!Number.isInteger(capacity)||capacity<1)throw new TypeError('Invalid readings cache capacity.');
  const records=new Map<string,Reading>(), pages=new Map<string,{ids:string[];page:ReadingPage['page']}>();
  const coverage:Coverage[]=[], chains=new Map<string,{scope:Scope;ids:string[];next?:string;discard:boolean}>();
  const pending=new Map<string,{controller:AbortController;promise:Promise<ReadingPage>;users:number}>();
  const listeners=new Set<()=>void>();let epoch=0;
  const id=(r:Reading)=>`${r.datasetId}/${r.id}`;
  function touch(k:string) {const r=records.get(k);if(r){records.delete(k);records.set(k,r);}return r;}
  function trim() {
    while(records.size>capacity) records.delete(records.keys().next().value!);
    while(pages.size>256)pages.delete(pages.keys().next().value!);
    while(chains.size>64)chains.delete(chains.keys().next().value!);
    while(coverage.length>64)coverage.shift();
    let refs=[...pages.values(),...chains.values(),...coverage].reduce((n,v)=>n+v.ids.length,0);
    while(refs>capacity*4&&(coverage.length||chains.size||pages.size)){
      if(coverage.length)refs-=coverage.shift()!.ids.length;
      else if(chains.size){const k=chains.keys().next().value!;refs-=chains.get(k)!.ids.length;chains.delete(k);}
      else{const k=pages.keys().next().value!;refs-=pages.get(k)!.ids.length;pages.delete(k);}
    }
  }
  function remember(q:ReadingsQuery,result:ReadingPage) {
    if(result.data.some(r=>!fits(r,q)))throw new DataSourceError('invalid-response','Readings differ from the requested scope.');
    if(q.cursor&&result.page.nextCursor===q.cursor)throw new DataSourceError('invalid-response','Repeated readings cursor.');
    const ids=result.data.map(r=>{const k=id(r);records.delete(k);records.set(k,r);return k;});
    const k=key(q);pages.set(`${k}/${q.cursor??''}`,{ids,page:result.page});
    if(!q.cursor)chains.set(k,{scope:{datasetId:q.datasetId,sensorId:q.sensorId,bbox:q.bbox,from:q.from,to:q.to},ids:[],discard:false});
    const c=chains.get(k);
    if(c&&c.next===q.cursor){
      if(!c.discard)c.ids.push(...ids);
      if(c.ids.length>capacity){c.ids=[];c.discard=true;}
      c.next=result.page.nextCursor??undefined;
      if(!result.page.nextCursor){if(!c.discard)coverage.push({scope:c.scope,ids:[...new Set(c.ids)]});chains.delete(k);}
    }
    trim();
  }
  const load:Load=async(q,options)=>{
    options?.signal?.throwIfAborted();
    const k=`${key(q)}/${q.cursor??''}`,cached=pages.get(k);
    if(!offline()&&cached&&cached.ids.every(v=>records.has(v))){pages.delete(k);pages.set(k,cached);return {data:cached.ids.map(v=>touch(v)!),page:{...cached.page}};}
    let job=pending.get(k);
    if(!job||job.controller.signal.aborted){
      const controller=new AbortController(),generation=epoch;
      const promise = Promise.resolve()
        .then(() => loader(q, { signal: controller.signal }))
        .then(result => {
          controller.signal.throwIfAborted();
          if (generation === epoch && !result.localCoverage) remember(q, result);
          return result;
        })
        .catch(error => {
          // When IndexedDB could not persist this page, the current tab can still show its RAM copy.
          if (generation === epoch && offline() && !controller.signal.aborted && error instanceof DataSourceError &&
              error.kind === 'offline' && cached?.ids.every(value => records.has(value))) {
            return { data: cached.ids.map(value => touch(value)!), page: { ...cached.page, nextCursor: null }, localCoverage: 'partial' as const };
          }
          throw error;
        });
      job={controller,promise,users:0};pending.set(k,job);const created=job;
      void promise.then(()=>{if(pending.get(k)===created)pending.delete(k);},()=>{if(pending.get(k)===created)pending.delete(k);});
    }
    const active=job;active.users++;
    return new Promise<ReadingPage>((resolve,reject)=>{
      let done=false;
      const finish=()=>{if(done)return false;done=true;options?.signal?.removeEventListener('abort',abort);active.users--;if(!active.users&&pending.get(k)===active){active.controller.abort();pending.delete(k);}return true;};
      const abort=()=>{if(finish())reject(new DOMException('Aborted','AbortError'));};
      options?.signal?.addEventListener('abort',abort,{once:true});
      active.promise.then(value=>{if(finish())resolve(value);},error=>{if(finish())reject(error);});
      if(options?.signal?.aborted)abort();
    });
  };
  function complete(q:ReadingsQuery):Reading[]|undefined {
    if(offline())return undefined;
    const candidates=coverage.filter(c=>compatible(c.scope,q)&&c.ids.every(k=>records.has(k))&&hi(c.scope)>=lo(q)&&lo(c.scope)<=hi(q)).sort((a,b)=>lo(a.scope)-lo(b.scope));
    let end=lo(q),started=false;const used:Coverage[]=[];
    for(const c of candidates){if(lo(c.scope)>(started?end+1:end))break;started=true;end=Math.max(end,hi(c.scope));used.push(c);if(end>=hi(q))break;}
    if(!started||end<hi(q))return undefined;
    const rows=[...new Set(used.flatMap(c=>c.ids))].map(k=>touch(k)!).filter(r=>fits(r,q));
    rows.sort((a,b)=>(Date.parse(a.ts)-Date.parse(b.ts)||(a.id<b.id?-1:a.id>b.id?1:0))*(q.sort==='ts:desc'?-1:1));return rows;
  }
  return {load,complete,getRevision:()=>epoch,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    clear(){epoch++;for(const job of pending.values())job.controller.abort();pending.clear();records.clear();pages.clear();chains.clear();coverage.length=0;listeners.forEach(fn=>fn());},
    stats:()=>({readings:records.size,pages:pages.size,coverage:coverage.length,pending:pending.size})};
}
export type ReadingsCache=ReturnType<typeof createReadingsCache>;
