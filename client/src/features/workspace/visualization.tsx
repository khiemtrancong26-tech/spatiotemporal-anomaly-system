import type { InvestigationTarget } from './investigation';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { Button, Field, LoadingState, ErrorState } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import { Icon } from '../../shared/ui/icons';
import { CubeExplorer } from './cube-explorer';
import type { Reading } from '../../shared/api/generated/wire';
import { TemporalHeatmap } from './heatmap';
import { POINT_LIMIT, color } from './geometry';
import { createSnapshot } from './snapshot';
import { explorationUtcTime, explorationOffset } from '@pm25/shared-core';
import { formatWorkspaceTime, explorationLocalTime, zoneLabel } from './time';
import type { ReadingsQuery } from '../../shared/data-source/types';
import type { WorkspaceFilters } from './state';
const Renderer = lazy(() => import('./renderer'));
export function Visualization({ datasetId, filters, onSensor, initialView }: { datasetId: string; filters: WorkspaceFilters; initialView?: {target: InvestigationTarget; reading: Reading}; onSensor: (id: string) => void }) {
  const { data, workspace, datasets, readingsCache } = useServices();
  const zone = useStore(workspace, s => s.timeZone);
  const time = (ts: string) => formatWorkspaceTime(ts, zone), localTime = (ts: string) => explorationLocalTime(ts, zone);
  const anomalies = useStore(workspace, s => s.anomalies);
  const resultRun = useStore(workspace, s => s.resultRun);
  const marked = useMemo(() => new Set(anomalies.map(a => a.readingId)), [anomalies]);
  const selected = useStore(workspace, s => s.selectedReadingId);
  const select = useStore(workspace, s => s.selectReading);
  const [mode, setMode] = useState<'map' | 'cube'>(initialView?.target.preferredMode ?? (import.meta.env.VITE_MAPBOX_TOKEN ? 'map' : 'cube'));
  const [openedModes,setOpenedModes]=useState({map:mode==='map',cube:mode==='cube'});
  // Keep visited investigation viewers alive: their independent cameras and Cube controls are local.
  function changeMode(next:'map'|'cube') {setOpenedModes(previous=>({...previous,[next]:true}));setPlaying(false);setMode(next);if(next==='map'&&selected)setInspectorOpen(true);}
  const focusedSensorId=useStore(workspace,s=>s.focusedSensorId);
  const [spatialHeatmap, setSpatialHeatmap] = useState(true);
  const [maxAgeHours, setMaxAgeHours] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(selected));
  const [dockOpen, setDockOpen] = useState(false);
  const [dock, setDock] = useState<'readings' | 'heatmap' | 'stations' | 'help'>('readings');
  const [cubeRows, setCubeRows] = useState<Reading[]>([]);
  const [sort, setSort] = useState<'ts:asc' | 'ts:desc'>('ts:asc');
  const requestedTime=useStore(workspace,s=>s.visualTime);
  const setRequestedTime=useCallback((ts:string)=>workspace.getState().setVisualTime(ts),[workspace]);
  const cacheRevision=useSyncExternalStore(readingsCache.subscribe,readingsCache.getRevision);
  const pageScope=JSON.stringify([datasetId,filters.sensorId,filters.bbox,filters.from,filters.to,sort]);
  const [paging,setPaging]=useState<{scope:string;cursor?:string;previous:(string|undefined)[]}>({scope:pageScope,previous:[]});
  const pageCursor=paging.scope===pageScope?paging.cursor:undefined;
  const previousPages=paging.scope===pageScope?paging.previous:[];
  const [draftTime, setDraftTime] = useState<string>();
  useEffect(() => { setDraftTime(undefined); }, [zone]);
  const [timeError, setTimeError] = useState('');
  const readings = useMemo(() => createCursorPager((q:ReadingsQuery&{pageCursor?:string},opts)=>{const {pageCursor,...rest}=q;return readingsCache.load({...rest,cursor:pageCursor},opts);}), [readingsCache]);
  const sensors = useMemo(() => createCursorPager(data.sensors.list), [data]);
  const snapshot = useMemo(() => createSnapshot(readingsCache.load,readingsCache), [readingsCache]);
  const r = useSyncExternalStore(readings.subscribe, readings.getSnapshot);
  const s = useSyncExternalStore(sensors.subscribe, sensors.getSnapshot);
  const m = useSyncExternalStore(snapshot.subscribe, snapshot.getSnapshot);
  useEffect(() => { void readings.setQuery({ datasetId, ...filters, sort, pageCursor, limit:100 }); return () => readings.dispose(); }, [readings,datasetId,filters,sort,pageCursor,cacheRevision]);
  useEffect(() => { void sensors.setQuery({ datasetId, bbox:filters.bbox, sort:'externalId:asc', limit:100 }); return () => sensors.dispose(); }, [sensors,datasetId,filters.bbox]);
  const rows = r.data;
  const rawTime=requestedTime ?? initialView?.target.ts ?? rows[0]?.ts;
  const timestamp=rawTime?new Date(Math.min(filters.to?Date.parse(filters.to):Infinity,Math.max(filters.from?Date.parse(filters.from):-Infinity,Date.parse(rawTime)))).toISOString():undefined;
  useEffect(()=>{if(timestamp&&timestamp!==requestedTime)setRequestedTime(timestamp);},[timestamp,requestedTime,setRequestedTime]);
  useEffect(() => {
    if (mode === 'map' && timestamp) void snapshot.read({datasetId,sensorId:filters.sensorId,bbox:filters.bbox,timestamp,maxAgeMs:maxAgeHours*3600_000,from:filters.from});
    return () => snapshot.dispose();
  }, [snapshot,mode,timestamp,datasetId,filters.sensorId,filters.bbox,filters.from,maxAgeHours,cacheRevision]);
  const mapRows = m.rows;
  const times = useMemo(() => [...new Set(rows.map(row => row.ts))].sort((a,b) => Date.parse(a)-Date.parse(b)), [rows]);
  const frameIndex = timestamp ? times.indexOf(timestamp) : -1;
  useEffect(() => {
    if (!playing || mode !== 'map') return;
    if (m.status === 'loading') return;
    if (m.status !== 'error' && m.timestamp !== timestamp) return;
    const stop = m.status === 'error' || m.hasMore || frameIndex < 0 || frameIndex >= times.length - 1;
    const timer = window.setTimeout(() => { if (stop) setPlaying(false); else setRequestedTime(times[frameIndex + 1]); }, stop ? 0 : 1800);
    return () => window.clearTimeout(timer);
  }, [playing,mode,m.status,m.timestamp,m.hasMore,timestamp,times,frameIndex,setRequestedTime]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange',hide);
    return () => document.removeEventListener('visibilitychange',hide);
  }, []);
  const scale = useMemo(() => { const values = [...rows,...mapRows].map(row => row.value); return {min:values.length ? Math.min(...values) : 0,max:values.length ? Math.max(...values) : 0}; },[rows,mapRows]);
  const remembered=useStore(workspace,s=>s.visualReading);
  const chosen = rows.find(row => row.id === selected) ?? mapRows.find(row => row.id === selected) ?? cubeRows.find(row => row.id === selected) ?? (initialView && initialView.reading.id === selected ? initialView.reading : undefined) ?? (remembered?.id===selected?remembered:undefined);
  const origin=initialView?.reading;
  let originAbsence='Reading gốc không có trong snapshot đã tải.';
  if(origin&&timestamp){
    const age=Date.parse(timestamp)-Date.parse(origin.ts),replacement=mapRows.find(row=>row.sensorId===origin.sensorId);
    if(age<0)originAbsence='Reading gốc nằm sau mốc T đang chọn.';
    else if(age>maxAgeHours*3600_000)originAbsence='Reading gốc vượt độ cũ tối đa của snapshot.';
    else if((filters.sensorId&&filters.sensorId!==origin.sensorId)||(filters.from&&Date.parse(origin.ts)<Date.parse(filters.from))||(filters.bbox&&(origin.location.coordinates[0]<filters.bbox[0]||origin.location.coordinates[0]>filters.bbox[2]||origin.location.coordinates[1]<filters.bbox[1]||origin.location.coordinates[1]>filters.bbox[3])))originAbsence='Reading gốc nằm ngoài bộ lọc Workspace đang áp dụng.';
    else if(replacement)originAbsence=Date.parse(replacement.ts)>Date.parse(origin.ts)?'Trạm có mẫu mới hơn; snapshot chỉ hiển thị mẫu gần nhất tại T.':'Snapshot chọn mẫu khác của cùng trạm theo quy tắc latest-per-station và ID.';
  }
  const stationName = (id: string) => s.data.find(sensor => sensor.id === id)?.name ?? id;
  const total = datasets.get(datasetId)?.importSummary?.importedRows;
  const inspect = useCallback((id: string) => { select(id);const row=[...rows,...mapRows,...cubeRows].find(r=>r.id===id);if(row){workspace.getState().focusSensor(row.sensorId);workspace.getState().rememberVisualReading(row);if(mode==='cube')setRequestedTime(row.ts);}setInspectorOpen(true); },[select,rows,mapRows,cubeRows,workspace,mode,setRequestedTime]);
  const dockRef = useRef<HTMLDetailsElement>(null);
  function chooseTime(ts: string) {setPlaying(false);setRequestedTime(ts);setDraftTime(undefined);setTimeError('');}
  const dockRows = mode === 'cube' ? [...cubeRows].sort((a,b) => sort === 'ts:asc' ? Date.parse(a.ts)-Date.parse(b.ts) : Date.parse(b.ts)-Date.parse(a.ts)) : rows;
  function loadMore() {if(r.nextCursor)setPaging({scope:pageScope,cursor:r.nextCursor,previous:[...previousPages,pageCursor]});}
  function previousPage(){setPaging({scope:pageScope,cursor:previousPages.at(-1),previous:previousPages.slice(0,-1)});}
  return <section className="card visualization explorer-v2 explorer-layout-v3">
    <div className="map-toolbar"><header className="viz-toolbar"><div className="sr-only"><h2>Tra cứu PM2.5</h2></div><div className="explorer-actions"><div className="workspace-tabs" aria-label="Chế độ trực quan"><Button aria-pressed={mode === 'cube'} onClick={() => changeMode('cube')}><Icon name="cube" />Cube</Button><Button aria-pressed={mode === 'map'} onClick={() => changeMode('map')}><Icon name="map" />Mapbox 3D</Button></div>{mode === 'map' && <Button variant="secondary" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(v => !v)}><Icon name="layers" />Chi tiết & lớp</Button>}</div></header>
    {mode === 'map' && <div className="snapshot-controls">
      <div className="snapshot-heading"><Icon name="activity" /><div><strong>Mốc hiển thị · {timestamp ? time(timestamp) : 'Chưa có thời điểm'}</strong><span>Mỗi trạm lấy mẫu mới nhất không sau mốc T, trong giới hạn độ cũ. Popup ghi thời gian đo thực.</span></div></div>
      <div className="snapshot-inputs"><Button variant="secondary" disabled={frameIndex <= 0} onClick={() => chooseTime(times[frameIndex-1])} title="Trước"><Icon name="arrow" size={16} style={{transform:'rotate(180deg)'}}/><span className="sr-only">Trước</span></Button><label className="field">Thời điểm đã tải<select aria-label="Thời điểm đã tải" value={timestamp ?? ''} onChange={e => chooseTime(e.target.value)}>{!times.length && <option value="">Chưa có dữ liệu</option>}{timestamp && !times.includes(timestamp) && <option value={timestamp}>{time(timestamp)}</option>}{times.map(ts => <option key={ts} value={ts}>{time(ts)}</option>)}</select></label><Button variant="secondary" disabled={frameIndex < 0 || frameIndex >= times.length-1} onClick={() => chooseTime(times[frameIndex+1])} title="Sau"><Icon name="arrow" size={16}/><span className="sr-only">Sau</span></Button><details className="snapshot-date"><summary aria-label="Chọn ngày giờ khác"><span className="full-date-label">Chọn ngày giờ khác</span><span className="compact-date-label" aria-hidden="true">Ngày giờ</span></summary><form onSubmit={e => {e.preventDefault();try {const ts = explorationUtcTime(draftTime ?? (timestamp ? localTime(timestamp) : ''), zone);if(!ts)throw new Error('Chọn ngày giờ để hiển thị.');if((filters.from && ts < filters.from)||(filters.to && ts > filters.to))throw new Error('Thời điểm phải nằm trong khoảng bộ lọc.');chooseTime(ts);}catch(error){setTimeError((error as Error).message);}}}><Field label={`Thời điểm bản đồ · ${zoneLabel(zone)}`} type="datetime-local" step="1" required value={draftTime ?? (timestamp ? localTime(timestamp) : '')} onChange={e => setDraftTime(e.target.value)} /><Button type="submit">Hiển thị các trạm</Button></form></details></div>
      <div className="timeline-playback"><Button variant="secondary" disabled={times.length < 2 || m.status === 'error' || m.hasMore} aria-pressed={playing} onClick={() => { if (!playing && (frameIndex < 0 || frameIndex === times.length-1)) chooseTime(times[0]); setPlaying(v=>!v); }}>{playing ? 'Tạm dừng' : 'Phát timeline'}</Button><label className="timeline-range">Mốc thời gian<input aria-label="Timeline thời gian" type="range" min={0} max={Math.max(0,times.length-1)} step={1} disabled={times.length<2} value={Math.max(0,frameIndex)} aria-valuetext={timestamp ? time(timestamp) : 'Chưa có dữ liệu'} onChange={e=>chooseTime(times[Number(e.target.value)])} /></label><label className="field timeline-age">Độ cũ tối đa<select aria-label="Độ cũ tối đa" value={maxAgeHours} onChange={e=>{setPlaying(false);setMaxAgeHours(Number(e.target.value));}}>{[0.5,1,2,4,6,12,24].map(hours=><option key={hours} value={hours}>{hours} giờ</option>)}</select></label></div>

    </div>}
    </div>
    {(mode === 'cube' || (initialView && openedModes.cube)) && <div hidden={mode !== 'cube'}><CubeExplorer active={mode === 'cube'} initialTimestamp={timestamp} datasetId={datasetId} filters={filters} anchor={rows[0]?.ts} seedReady={r.status === 'ready'} seedError={r.status === 'error' ? errorMessage(r.error) : undefined} retrySeed={() => {void readings.retry();}} sensors={s.data} sensorsComplete={s.status === 'ready' && !s.nextCursor} sensorsError={s.status === 'error' ? errorMessage(s.error) : undefined} retrySensors={() => {void sensors.retry();}} loadSensors={s.nextCursor ? () => {void sensors.loadMore();} : undefined} onRows={setCubeRows} onMap={ts => {if(ts)chooseTime(ts);changeMode('map');}} onDock={() => {setDock('readings');setDockOpen(true);requestAnimationFrame(()=>dockRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}} /></div>}
    {(mode === 'map' || (initialView && openedModes.map)) && <div hidden={mode !== 'map'}>
    {initialView&&origin&&m.status==='ready'&&m.timestamp===timestamp&&!m.hasMore&&!mapRows.some(row=>row.id===origin.id)&&<p className="metadata-notice" role="status" data-testid="investigation-snapshot-context">{initialView.target.anomalyId?`Anomaly ${initialView.target.anomalyId}`:'Điều tra reading'} · Reading {origin.id}: {originAbsence} Ngữ cảnh điều tra vẫn được giữ.</p>}
    <div className="explorer-status"><span><strong>{mode === 'map' ? mapRows.length : rows.length}</strong> {mode === 'map' ? 'trạm tại thời điểm đang xem' : 'readings trong Cube'}</span><span>Trang {previousPages.length+1} · {rows.length} readings{total !== undefined && ` · dataset ${total.toLocaleString('vi-VN')} readings`}</span><div className="explorer-status-actions"><Button variant="secondary" disabled={!previousPages.length||r.status==='loading'} onClick={previousPage}>Trang readings trước</Button><Button variant="secondary" onClick={()=>{setPaging({scope:pageScope,previous:[]});readingsCache.clear();}}>Làm mới dữ liệu</Button>{r.nextCursor && <Button variant="secondary" disabled={r.status === 'loading'} onClick={loadMore}>Trang readings tiếp theo</Button>}<Button variant="secondary" onClick={() => {setDock('readings');setDockOpen(true);requestAnimationFrame(()=>dockRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}}>Xem bảng dữ liệu</Button></div></div>
    {r.status === 'loading' && <LoadingState />}{r.status === 'error' && <ErrorState message={errorMessage(r.error)} retry={() => {void readings.retry();}} />}
    <div className="explorer-stage"><div className="viz-main"><Suspense fallback={<LoadingState />}><Renderer zone={zone} scale={scale} spatialHeatmap={spatialHeatmap} marked={marked} mode="map" rows={mapRows} selected={selected} focusedSensorId={initialView ? focusedSensorId : undefined} onSelect={inspect} /></Suspense></div>
      <aside className="context-panel explorer-inspector" hidden={!inspectorOpen}><header><h3><Icon name="info" size={18} />Chi tiết lựa chọn</h3><Button variant="secondary" aria-label="Đóng chi tiết" onClick={() => setInspectorOpen(false)}>Đóng</Button></header>{mode === 'map' && mapRows.length > 0 && <label className="field snapshot-station">Xem chi tiết trạm tại thời điểm này<select aria-label="Xem chi tiết trạm tại thời điểm này" value={mapRows.some(row=>row.id===selected) ? selected : ''} onChange={e=>{if(e.target.value)inspect(e.target.value);}}><option value="">Chọn để xem chi tiết, không ẩn các trạm khác</option>{mapRows.map(row=><option key={row.id} value={row.id}>{stationName(row.sensorId)} · {row.value} µg/m³</option>)}</select></label>}{chosen ? <><div className="context-value">{chosen.value}<small> µg/m³</small></div><p>Trạm: {stationName(chosen.sensorId)}</p><p>{time(chosen.ts)} · {zoneLabel(zone)}</p><p>Lon/Lat: {chosen.location.coordinates.join(', ')}</p><p className="reading-reference">Reading: {chosen.id}</p>{mode === 'map' && Date.parse(chosen.ts) !== Date.parse(timestamp ?? '') && <p className="warning-message">Phép đo đang xem có timestamp thực khác mốc T; chỉ hiện trên bản đồ nếu đủ mới và là mẫu gần nhất của trạm.</p>}<details><summary>Anomaly của reading</summary><p>{anomalies.filter(a => a.readingId === chosen.id).map(a => `${a.id}: ${a.method}, ${a.severity}, ${a.status}`).join('; ') || 'Chưa có trong phần đã tải; không suy ra không có anomaly.'}</p></details></> : <div className="context-placeholder"><Icon name="map" size={28} /><p>Chọn điểm hoặc dòng để xem chi tiết. Các trạm khác vẫn hiển thị.</p></div>}{selected && !chosen && <p role="status">Reading đã chọn chưa nằm trong phần readings đang tải/bộ lọc hiện tại. Không tự tải toàn bộ dataset.</p>}
      {mode === 'map' && <div className="map-layer-control"><h3>Lớp bản đồ</h3><p>Bật/tắt heatmap tại góc trên phải bản đồ.</p><p>Heatmap loang mềm biểu diễn cường độ thị giác từ các trạm; không phải nồng độ chính xác tại mọi vị trí.</p></div>}</aside>
      <div className="map-context-overlay"><strong>{mode === 'map' ? (m.timestamp ? time(m.timestamp) : 'Chưa có khung') : 'Space–Time Cube'}</strong>{mode === 'map' ? <>      {timeError && <p role="alert">{timeError}</p>}{m.status === 'loading' && <p role="status">Đang tải khung mới… {m.timestamp && `Đang giữ khung trước tại ${time(m.timestamp)}; chưa phải dữ liệu của mốc T mới.`}</p>}{m.status === 'error' && <ErrorState message={errorMessage(m.error)} retry={() => {void snapshot.retry();}} />}
      {m.status === 'ready' && m.timestamp === timestamp && <p data-testid="snapshot-status">{mapRows.length} trạm có mẫu · {m.hasMore ? 'Cửa sổ chưa hoàn tất.' : 'Đã đọc hết cửa sổ độ cũ.'}{mapRows.length === 1 && ' Chỉ có một trạm có mẫu ở thời điểm này.'}{!mapRows.length && ' Không có mẫu đủ mới; không nội suy hoặc tạo thêm reading.'}</p>}
</> : <p>{rows.length} readings đã tải</p>}</div>
      {mode === 'map' && <div className="map-layers-overlay"><Icon name="layers" size={16}/><label className="inline-layer"><input type="checkbox" aria-label="Heatmap không gian" checked={spatialHeatmap} onChange={e=>setSpatialHeatmap(e.target.checked)}/>Heatmap PM2.5</label></div>}
      <details className="map-legend-overlay" open><summary>Chú giải bản đồ</summary>    <div className="viz-legend"><strong>{mode === 'map' ? 'Điểm trạm · PM2.5' : 'PM2.5'} · µg/m³</strong><span>{scale.min}</span><span className="color-ramp" style={{background:`linear-gradient(90deg, ${color(scale.min,scale.min,scale.max)}, ${color(scale.max,scale.min,scale.max)})`}} /><span>{scale.max}</span><span>Thang màu theo dữ liệu đã tải; không phải ngưỡng sức khỏe.</span></div>
    {mode === 'map' && spatialHeatmap && <div className="heat-intensity-legend"><strong>Cường độ thị giác</strong><span>Thấp</span><span className="heat-intensity-ramp"/><span>Cao</span><span>Phụ thuộc PM2.5, mật độ trạm và zoom. Không phải bản đồ nồng độ chính xác ở mọi vị trí.</span></div>}
</details>
    </div>
    </div>}
    <details className="explorer-dock" ref={dockRef} open={dockOpen} onToggle={e=>setDockOpen(e.currentTarget.open)}><summary className="dock-summary"><Icon name="dataset" size={17}/><strong>Dữ liệu bổ trợ</strong><span>{dockRows.length} readings đã tải</span><span className="dock-disclosure-hint">Mở / thu gọn</span></summary><nav aria-label="Dữ liệu bổ trợ" className="dock-tabs">{([['readings','Bảng readings'],['heatmap','Heatmap thời gian'],['stations','Trạm'],['help','Hướng dẫn']] as const).map(([id,label])=><Button key={id} variant="secondary" aria-pressed={dock === id} onClick={()=>setDock(id)}>{label}</Button>)}</nav>
      <div hidden={dock !== 'readings'} className="dock-content"><div className="records-toolbar"><div><h3>Readings</h3><p>{dockRows.length} đã tải{mode === 'map' && r.nextCursor ? ' · Còn dữ liệu' : ''}. Chọn dòng chỉ xem chi tiết, không lọc bản đồ.</p></div><label className="field">Thứ tự thời gian<select aria-label="Thứ tự thời gian" value={sort} onChange={e=>{select(undefined);setPaging({scope:pageScope,previous:[]});setSort(e.target.value as typeof sort);}}><option value="ts:asc">Cũ → mới</option><option value="ts:desc">Mới → cũ</option></select></label>{mode === 'map' && r.nextCursor && <Button disabled={r.status === 'loading'} onClick={loadMore}>Trang readings tiếp theo</Button>}</div><div className="table-scroll records-scroll" tabIndex={0} role="region" aria-label="Bảng readings"><table><thead><tr><th>Trạm</th><th>Thời gian · {zoneLabel(zone)}</th><th>PM2.5 · µg/m³</th><th>Chi tiết</th><th>Reading ID</th></tr></thead><tbody>{dockRows.map(row=><tr key={row.id} aria-selected={row.id===selected}><td title={row.sensorId}>{stationName(row.sensorId)}</td><td>{time(row.ts)}</td><td className="numeric-cell">{row.value}</td><td><Button variant="secondary" aria-label={`Chọn ${row.id}`} onClick={()=>inspect(row.id)}>Xem chi tiết</Button></td><td className="reading-reference">{row.id}</td></tr>)}</tbody></table></div></div>
      <div hidden={dock !== 'heatmap'} className="dock-content"><TemporalHeatmap rows={dockRows} offset={explorationOffset(zone)} /></div>
      <div hidden={dock !== 'stations'} className="dock-content"><h3>Trạm trong dataset/vùng đã áp dụng ({s.data.length} đã tải)</h3><p>Danh sách metadata không lọc theo thời gian.</p>{s.status === 'error' && <ErrorState message={errorMessage(s.error)} retry={()=>{void sensors.retry();}} />}<label className="field">Chọn trạm đã tải<select value={filters.sensorId??''} onChange={e=>onSensor(e.target.value)}><option value="">Tất cả trạm</option>{filters.sensorId&&!s.data.some(sensor=>sensor.id===filters.sensorId)&&<option value={filters.sensorId}>{filters.sensorId}</option>}{s.data.map(sensor=><option key={sensor.id} value={sensor.id}>{sensor.name} · {sensor.externalId}</option>)}</select></label>{s.nextCursor&&<Button disabled={s.status==='loading'||s.data.length>=POINT_LIMIT} onClick={()=>{void sensors.loadMore();}}>Tải thêm trạm</Button>}</div>
      <div hidden={dock !== 'help'} className="dock-content technical-details"><h3>Cách đọc bản đồ</h3><p>Mapbox đọc cửa sổ [T − độ cũ tối đa, T] trong phạm vi bộ lọc, lấy tối đa một reading gần nhất mỗi trạm. Mẫu đúng giới hạn độ cũ vẫn được giữ; mẫu cũ hơn bị loại. Không nội suy readings. Hiệu ứng chuyển tiếp chỉ hòa trộn hai hình ảnh heatmap, không tạo phép đo trung gian. Cube giữ các readings đã tải trong khoảng thời gian. Chọn một điểm/dòng chỉ mở chi tiết.</p><p>Trước/Sau và danh sách thời điểm lấy từ readings đã tải; nạp thêm để có thêm thời điểm, hoặc nhập ngày giờ bất kỳ trong phạm vi bộ lọc. Snapshot đọc hết các trang trong cửa sổ maxAge; danh sách/timeline đọc chủ động từng trang 100. Có thể nhập trực tiếp thời điểm sâu trong dataset mà không tải các trang trước. Phát qua các mốc đã tải, tạm dừng khi tab ẩn; giữ khung trước trong lúc tải để tránh nhấp nháy.</p><p>Cube: X = kinh độ, Y = vĩ độ, Z = thời gian; màu điểm biểu diễn PM2.5 đo thực. Kéo để xoay, cuộn để zoom, chuột phải để pan.</p><p>Lớp anomaly: {resultRun ? `run ${resultRun.id}, ${anomalies.length} đã tải` : `${anomalies.length} chi tiết đã tải`}; tô/viền tím chỉ các reading khớp, không thay thang PM2.5.</p></div>
    </details>
  </section>;
}
