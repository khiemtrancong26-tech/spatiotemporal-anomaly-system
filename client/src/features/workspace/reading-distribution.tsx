import { useEffect,useState,useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { Button,LoadingState } from '../../shared/ui/primitives';
import { loadDistribution } from './reading-distribution-data';
import type { WorkspaceFilters } from './state';
import type { CubeScope } from './cube-data';
import { formatWorkspaceTime } from './time';
export function ReadingDistribution({datasetId,filters,onScope}:{datasetId:string;filters:WorkspaceFilters;onScope:(scope:CubeScope)=>void}){
 const {data,workspace,readingsCache}=useServices(),zone=useStore(workspace,s=>s.timeZone);
 const revision=useSyncExternalStore(readingsCache.subscribe,readingsCache.getRevision);
 const [bucket,setBucket]=useState<'day'|'hour'>('day'),[result,setResult]=useState<Awaited<ReturnType<typeof loadDistribution>>>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[retry,refresh]=useState(0);
 const [begin,setBegin]=useState(0),[end,setEnd]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setPending(true);setError('');setResult(undefined);
  void loadDistribution(data,datasetId,filters,zone,bucket,controller.signal).then(r=>{if(!controller.signal.aborted){setResult(r);setBegin(0);setEnd(Math.max(0,r.buckets.length-1));}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Không tải được phân bố.');}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return()=>controller.abort();
 },[data,datasetId,filters,zone,bucket,retry,revision]);
 const max=Math.max(1,...(result?.buckets.map(b=>b.count)??[]));
 function open(a=begin,b=end){if(!result?.from||!result.to||!result.buckets[a]||!result.buckets[b]||a>b)return;onScope({from:new Date(Math.max(Date.parse(result.from),Date.parse(result.buckets[a].start))).toISOString(),to:new Date(Math.min(Date.parse(result.to),Date.parse(result.buckets[b].end)-1)).toISOString()});}
 return <details className="reading-distribution"><summary>Phân bố số readings · Toàn bộ phạm vi Workspace</summary><div className="distribution-controls"><label className="field">Độ phân giải<select aria-label="Độ phân giải phân bố" value={bucket} onChange={e=>setBucket(e.target.value as typeof bucket)}><option value="day">Theo ngày</option><option value="hour">Theo giờ</option></select></label><p>Số đếm từ Server, không phải readings đã tải vào Cube. Nhiều mẫu không có nghĩa PM2.5 cao.</p><Button variant="secondary" onClick={()=>refresh(n=>n+1)}>Làm mới phân bố</Button></div>{pending&&<LoadingState label="Đang đọc phân bố đầy đủ từ Server…"/>}{error&&<p role="alert">{error}</p>}{result&&<><p data-testid="distribution-count">{result.count.toLocaleString('vi-VN')} readings · {result.buckets.length} khoảng · đã xác nhận toàn phạm vi</p>{result.buckets.length>0?<><div className="distribution-bars" role="group" aria-label="Số readings theo thời gian">{result.buckets.map((b,i)=><button key={b.start} style={{height:`${Math.max(2,b.count/max*80)}px`}} aria-label={`${formatWorkspaceTime(b.start,zone)}: ${b.count} readings`} title={`${formatWorkspaceTime(b.start,zone)}: ${b.count} readings`} onClick={()=>{setBegin(i);setEnd(i);open(i,i);}}/>)}</div><div className="distribution-selection">{(['Từ','Đến'] as const).map((label,i)=><label className="field" key={label}>{label} phân bố<select aria-label={`${label} phân bố`} value={i?end:begin} onChange={e=>i?setEnd(Number(e.target.value)):setBegin(Number(e.target.value))}>{result.buckets.map((b,index)=><option value={index} key={b.start}>{formatWorkspaceTime(b.start,zone)} · {b.count} mẫu</option>)}</select></label>)}<Button disabled={begin>end} onClick={()=>open()}>Mở khoảng trên Cube</Button></div></>:<p>Không có readings trong phạm vi.</p>}</>}</details>;
}
