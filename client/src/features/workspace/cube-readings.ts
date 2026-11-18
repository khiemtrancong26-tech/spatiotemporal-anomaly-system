import type { ReadingsQuery } from '../../shared/data-source/types';
import type { Reading } from '../../shared/api/generated/wire';
import { CUBE_DETAIL_LIMIT, type ReadingsCache } from './readings-cache';
interface State {status:'idle'|'loading'|'ready'|'error';data:Reading[];nextCursor:string|null;error?:unknown;scanned:number;queryKey?:string;partial?:boolean}
export function createCubeReadings(cache:ReadingsCache) {
 let state:State={status:'idle',data:[],nextCursor:null,scanned:0},generation=0,key='',last:ReadingsQuery|undefined,controller:AbortController|undefined;
 const listeners=new Set<()=>void>();const publish=(s:State)=>{state={...s,queryKey:JSON.stringify(last)};listeners.forEach(fn=>fn());};
 async function read(q:ReadingsQuery){
  const current=++generation;controller?.abort();const active=new AbortController();controller=active;last=q;
  publish({status:'loading',data:[],nextCursor:null,scanned:0});
  try{
   const hit=cache.complete(q);
   if(hit){publish({status:'ready',data:hit.length<=CUBE_DETAIL_LIMIT?hit:[],nextCursor:hit.length>CUBE_DETAIL_LIMIT?'over-limit':null,scanned:Math.min(hit.length,CUBE_DETAIL_LIMIT)});return;}
   const rows=new Map<string,Reading>(),seen=new Set<string>();let cursor:string|undefined,partial=false;
   do{
    const page=await cache.load({...q,cursor,limit:Math.min(100,CUBE_DETAIL_LIMIT-rows.size)},{signal:AbortSignal.any([active.signal,AbortSignal.timeout(20000)])});
    if(current!==generation||active.signal.aborted)return;
    const previousSize=rows.size;for(const r of page.data)rows.set(r.id,r);
    const next=page.page.nextCursor;
    partial ||= page.localCoverage==='partial';
    if(rows.size>CUBE_DETAIL_LIMIT)throw new Error('Server exceeded the Cube page budget.');
    if(next&&seen.has(next))throw new Error('Repeated Cube cursor.');
    if(next)seen.add(next);
    if(!next||rows.size>=CUBE_DETAIL_LIMIT){publish({status:'ready',data:next?[]:[...rows.values()],nextCursor:next,scanned:rows.size,partial});return;}
    if(rows.size===previousSize)throw new Error('Cube cursor made no progress.');
    publish({status:'loading',data:[],nextCursor:null,scanned:rows.size});cursor=next;
   }while(cursor);
  }catch(error){if(current===generation&&!active.signal.aborted)publish({status:'error',data:[],nextCursor:null,scanned:state.scanned,error});}
 }
 return {subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},getSnapshot:()=>state,
  setQuery(q:ReadingsQuery){const k=JSON.stringify(q);if(k===key)return Promise.resolve();key=k;return read(q);},retry:()=>last?read(last):Promise.resolve(),
  dispose(){generation++;controller?.abort();key='';}};
}
