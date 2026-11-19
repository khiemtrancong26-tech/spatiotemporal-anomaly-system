import { useState } from 'react';
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ServicesProvider,createPreviewStore } from '../../../src/app/services';
import type { OnlineDataSource } from '../../../src/shared/data-source/types';
import type { Anomaly,Reading } from '../../../src/shared/api/generated/wire';
import { createWorkspaceStore } from '../../../src/features/workspace/state';
import { targetFromAnomaly } from '../../../src/features/workspace/investigation';
import { WorkspacePage } from '../../../src/features/workspace/page';
import c2 from '../../../../docs/fixtures/c2-online-examples.json';

vi.mock('../../../src/features/analysis/page',()=>({AnalysisPage:()=>null}));
vi.mock('../../../src/features/anomalies/page',()=>({AnomaliesPage:()=>null}));
vi.mock('../../../src/features/workspace/exploration',()=>({ExplorationPanel:()=>null}));
vi.mock('../../../src/features/workspace/reading-distribution',()=>({ReadingDistribution:()=>null}));
// Only GPU surfaces are replaced. Workspace, verification, Cube queries and snapshot run normally.
vi.mock('../../../src/features/workspace/cube-renderer',()=>({default:function CubeSurface({rows,onSelect}:{rows:Reading[];onSelect:(id:string)=>void}){
 const [camera,setCamera]=useState('initial');
 return <div data-testid="cube-surface" data-camera={camera}><button onClick={()=>setCamera('user-pose')}>Move Cube camera</button>{rows.map(r=><button key={r.id} onClick={()=>onSelect(r.id)}>Select {r.id}</button>)}</div>;
}}));
vi.mock('../../../src/features/workspace/renderer',()=>({default:function MapSurface({rows,selected,marked}:{rows:Reading[];selected?:string;marked:Set<string>}){
 const [camera,setCamera]=useState('initial');
 return <div data-testid="map-surface" data-camera={camera} data-selected={selected}><button onClick={()=>setCamera('map-pose')}>Move Map camera</button>{rows.map(r=><span key={r.id} data-testid={`marker-${r.id}`} data-anomaly={marked.has(r.id)}>{r.id}</span>)}</div>;
}}));
const ts='2015-03-26T13:00:00.000Z',H=3600000,time=(h:number)=>new Date(Date.parse(ts)+h*H).toISOString();
const row=(id:string,h=0,sensorId='s'):Reading=>({id,datasetId:'d',sensorId,ts:time(h),value:40,unit:'ug/m3',location:{type:'Point',coordinates:[116.3,39.9]}});
const original=row('original'),rows=[original,row('newer',1),row('other',0,'other')];
const anomaly={id:'anomaly',datasetId:'d',analysisRunId:'run',readingId:original.id,sensorId:'s',ts,location:original.location,method:'zscore',family:'statistical',score:4,severity:'high',status:'open'} as Anomaly;
beforeEach(()=>{vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>{fn();return 0;});vi.stubGlobal('cancelAnimationFrame',vi.fn());Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>vi.unstubAllGlobals());
async function setup(){
 const workspace=createWorkspaceStore();workspace.getState().openDataset('d');workspace.getState().applyFilters({from:time(-24),to:time(24)});workspace.getState().openAnomalies('run','anomaly');workspace.getState().setResults(undefined,[anomaly]);workspace.getState().investigate(targetFromAnomaly(anomaly,'cube'));
 const load=vi.fn<OnlineDataSource['readings']['list']>(async q=>({data:rows.filter(r=>(!q.sensorId||r.sensorId===q.sensorId)&&(!q.from||Date.parse(r.ts)>=Date.parse(q.from))&&(!q.to||Date.parse(r.ts)<=Date.parse(q.to))).sort((a,b)=>(Date.parse(a.ts)-Date.parse(b.ts))*(q.sort==='ts:desc'?-1:1)),page:{limit:100,nextCursor:null}}));
 const data={readings:{list:load},datasets:{profile:vi.fn().mockResolvedValue({...c2.profile.data,datasetId:'d'})},sensors:{list:vi.fn().mockResolvedValue({data:[{id:'s',name:'Station S'},{id:'other',name:'Other'}],page:{limit:100,nextCursor:null}})},analysis:{list:vi.fn().mockResolvedValue({data:[{id:'run',status:'completed'}],page:{limit:100,nextCursor:null}})},anomalies:{list:vi.fn().mockResolvedValue({data:[anomaly],page:{limit:100,nextCursor:null}})}} as unknown as OnlineDataSource;
 render(<ServicesProvider services={{workspace,data,config:{mode:'online',apiBaseUrl:'http://test'},preview:createPreviewStore()}}><WorkspacePage datasetId="d" selectRun={()=>{}}/></ServicesProvider>);
 await screen.findByTestId('cube-surface');return {workspace,load};
}
async function switchTo(name:'Mapbox 3D'|'Cube'){fireEvent.click(screen.getByRole('button',{name}));if(name==='Mapbox 3D')await screen.findByTestId('snapshot-status');else await waitFor(()=>expect(screen.getByTestId('cube-surface')).toBeVisible());}
it.each(['Điểm gốc','Cùng trạm ±12h','Tất cả trạm ±12h'])('retains identity, filters, Cube submode and both camera instances in %s',async label=>{
 const {workspace}=await setup();fireEvent.click(within(screen.getByRole('group',{name:'Phạm vi điều tra'})).getByRole('button',{name:label}));await waitFor(()=>expect(screen.getByTestId('cube-surface')).toBeVisible());
 const filters=workspace.getState().filters;fireEvent.click(screen.getByRole('button',{name:'03 Điều tra bất thường'}));fireEvent.click(screen.getByRole('button',{name:'Move Cube camera'}));const cube=screen.getByTestId('cube-surface');
 await switchTo('Mapbox 3D');expect(await screen.findByTestId('marker-original')).toHaveAttribute('data-anomaly','true');fireEvent.click(screen.getByRole('button',{name:'Move Map camera'}));const map=screen.getByTestId('map-surface');
 await switchTo('Cube');expect(screen.getByTestId('cube-surface')).toBe(cube);expect(cube).toHaveAttribute('data-camera','user-pose');expect(screen.getByRole('button',{name:'03 Điều tra bất thường'})).toHaveAttribute('aria-pressed','true');
 await switchTo('Mapbox 3D');expect(screen.getByTestId('map-surface')).toBe(map);expect(map).toHaveAttribute('data-camera','map-pose');
 expect(workspace.getState()).toMatchObject({selectedReadingId:'original',visualTime:ts,focusedSensorId:'s',filters,investigation:{target:{anomalyId:'anomaly',readingId:'original',sensorId:'s',ts}}});
 fireEvent.click(screen.getByRole('button',{name:'Quay lại Anomalies'}));expect(workspace.getState()).toMatchObject({tab:'anomalies',filters:{from:time(-24),to:time(24)},selectedReadingId:'original',investigation:undefined});
});
it('uses the chosen Cube reading T, preserves scope, and explains the original reading replaced in the snapshot',async()=>{
 const {workspace,load}=await setup();fireEvent.click(screen.getByRole('button',{name:'Tất cả trạm ±12h'}));
 fireEvent.change(screen.getByLabelText('Cửa sổ Cube'),{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('Từ Cube · UTC+07'),{target:{value:'2015-03-26T18:00'}});fireEvent.change(screen.getByLabelText('Đến Cube · UTC+07'),{target:{value:'2015-03-26T22:00'}});fireEvent.click(screen.getByRole('button',{name:'Xem phạm vi'}));
 await screen.findByRole('button',{name:'Select newer'});fireEvent.click(screen.getByRole('button',{name:'Select newer'}));const scope=workspace.getState().cubeScope;expect(scope).toEqual({from:time(-2),to:time(2)});
 await switchTo('Mapbox 3D');await waitFor(()=>expect(screen.getByTestId('marker-newer')).toBeVisible());expect(screen.queryByTestId('marker-original')).toBeNull();expect(screen.getByTestId('investigation-snapshot-context')).toHaveTextContent('mẫu mới hơn');
 expect(workspace.getState()).toMatchObject({visualTime:time(1),selectedReadingId:'newer',investigation:{target:{anomalyId:'anomaly',readingId:'original'}}});
 await switchTo('Cube');expect(workspace.getState().cubeScope).toEqual(scope);expect(screen.getByLabelText('Lát thời gian Cube',{exact:true})).toHaveValue(time(1));expect(load.mock.calls.every(([q])=>!q.to||Date.parse(q.to)>=Date.parse(q.from??q.to))).toBe(true);
});
it.each([[-1,'sau mốc T'],[3,'độ cũ tối đa']])('explains missing original at T%ih without creating a marker or resetting investigation',async(h,reason)=>{
 const {workspace}=await setup();fireEvent.click(screen.getByRole('button',{name:'Tất cả trạm ±12h'}));act(()=>workspace.getState().setVisualTime(time(h)));
 await switchTo('Mapbox 3D');expect(screen.queryByTestId('marker-original')).toBeNull();expect(screen.getByTestId('investigation-snapshot-context')).toHaveTextContent(reason);expect(screen.getByTestId('investigation-snapshot-context')).toHaveTextContent('anomaly');expect(workspace.getState().investigation?.target.readingId).toBe('original');
});
it('opens details for a selected Cube reading even when the Mapbox inspector was previously closed',async()=>{
 await setup();await switchTo('Mapbox 3D');fireEvent.click(screen.getByRole('button',{name:'Đóng chi tiết'}));await switchTo('Cube');fireEvent.click(screen.getByRole('button',{name:'Select original'}));await switchTo('Mapbox 3D');expect(screen.getByRole('heading',{name:'Chi tiết lựa chọn'})).toBeVisible();
});
