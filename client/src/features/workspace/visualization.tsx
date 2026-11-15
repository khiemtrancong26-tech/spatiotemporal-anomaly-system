import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { Button, Field, LoadingState, ErrorState } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import { Icon } from '../../shared/ui/icons';
import { TemporalHeatmap } from './heatmap';
import { POINT_LIMIT, color } from './geometry';
import { createSnapshot } from './snapshot';
import { vietnamTimeToUtc } from './filters';
import type { WorkspaceFilters } from './state';
const Renderer = lazy(() => import('./renderer'));
const time = (ts: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(ts));
const localTime = (ts: string) => new Date(Date.parse(ts) + 7 * 3600_000).toISOString().slice(0,19);
export function Visualization({ datasetId, filters, onSensor }: { datasetId: string; filters: WorkspaceFilters; onSensor: (id: string) => void }) {
  const { data, workspace, datasets } = useServices();
  const anomalies = useStore(workspace, s => s.anomalies);
  const resultRun = useStore(workspace, s => s.resultRun);
  const marked = useMemo(() => new Set(anomalies.map(a => a.readingId)), [anomalies]);
  const selected = useStore(workspace, s => s.selectedReadingId);
  const select = useStore(workspace, s => s.selectReading);
  const [mode, setMode] = useState<'map' | 'cube'>(import.meta.env.VITE_MAPBOX_TOKEN ? 'map' : 'cube');
  const [spatialHeatmap, setSpatialHeatmap] = useState(true);
  const [maxAgeHours, setMaxAgeHours] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(selected));
  const [dockOpen, setDockOpen] = useState(false);
  const [dock, setDock] = useState<'readings' | 'heatmap' | 'stations' | 'help'>('readings');
  const [sort, setSort] = useState<'ts:asc' | 'ts:desc'>('ts:asc');
  const [requestedTime, setRequestedTime] = useState<string>();
  const [draftTime, setDraftTime] = useState<string>();
  const [timeError, setTimeError] = useState('');
  const readings = useMemo(() => createCursorPager(data.readings.list), [data]);
  const sensors = useMemo(() => createCursorPager(data.sensors.list), [data]);
  const snapshot = useMemo(() => createSnapshot(data.readings.list), [data]);
  const r = useSyncExternalStore(readings.subscribe, readings.getSnapshot);
  const s = useSyncExternalStore(sensors.subscribe, sensors.getSnapshot);
  const m = useSyncExternalStore(snapshot.subscribe, snapshot.getSnapshot);
  useEffect(() => { void readings.setQuery({ datasetId, ...filters, sort, limit:100 }); return () => readings.dispose(); }, [readings,datasetId,filters,sort]);
  useEffect(() => { void sensors.setQuery({ datasetId, bbox:filters.bbox, sort:'externalId:asc', limit:100 }); return () => sensors.dispose(); }, [sensors,datasetId,filters.bbox]);
  const rows = r.data;
  const timestamp = requestedTime ?? rows[0]?.ts;
  useEffect(() => {
    if (mode === 'map' && timestamp) void snapshot.read({datasetId,sensorId:filters.sensorId,bbox:filters.bbox,timestamp,maxAgeMs:maxAgeHours*3600_000,from:filters.from});
    return () => snapshot.dispose();
  }, [snapshot,mode,timestamp,datasetId,filters.sensorId,filters.bbox,filters.from,maxAgeHours]);
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
  }, [playing,mode,m.status,m.timestamp,m.hasMore,timestamp,times,frameIndex]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange',hide);
    return () => document.removeEventListener('visibilitychange',hide);
  }, []);
  const shown = mode === 'map' ? mapRows : rows;
  const scale = useMemo(() => { const values = [...rows,...mapRows].map(row => row.value); return {min:values.length ? Math.min(...values) : 0,max:values.length ? Math.max(...values) : 0}; },[rows,mapRows]);
  const chosen = rows.find(row => row.id === selected) ?? mapRows.find(row => row.id === selected);
  const stationName = (id: string) => s.data.find(sensor => sensor.id === id)?.name ?? id;
  const total = datasets.get(datasetId)?.importSummary?.importedRows;
  const inspect = useCallback((id: string) => { select(id);setInspectorOpen(true); },[select]);
  const dockRef = useRef<HTMLDetailsElement>(null);
  function chooseTime(ts: string) {setPlaying(false);setRequestedTime(ts);setDraftTime(undefined);setTimeError('');}
  function loadMore() {void readings.loadMore();}
  return <section className="card visualization explorer-v2 explorer-layout-v3">
    <div className="map-toolbar"><header className="viz-toolbar"><div className="sr-only"><h2>Tra cứu PM2.5</h2></div><div className="explorer-actions"><div className="workspace-tabs" aria-label="Chế độ trực quan"><Button aria-pressed={mode === 'cube'} onClick={() => {setPlaying(false);setMode('cube');}}><Icon name="cube" />Cube</Button><Button aria-pressed={mode === 'map'} onClick={() => setMode('map')}><Icon name="map" />Mapbox 3D</Button></div><Button variant="secondary" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(v => !v)}><Icon name="layers" />Chi tiết & lớp</Button></div></header>
    {mode === 'map' && <div className="snapshot-controls">
      <div className="snapshot-heading"><Icon name="activity" /><div><strong>Mốc hiển thị · {timestamp ? time(timestamp) : 'Chưa có thời điểm'}</strong><span>Mỗi trạm lấy mẫu mới nhất không sau mốc T, trong giới hạn độ cũ. Popup ghi thời gian đo thực.</span></div></div>
      <div className="snapshot-inputs"><Button variant="secondary" disabled={frameIndex <= 0} onClick={() => chooseTime(times[frameIndex-1])} title="Trước"><Icon name="arrow" size={16} style={{transform:'rotate(180deg)'}}/><span className="sr-only">Trước</span></Button><label className="field">Thời điểm đã tải<select aria-label="Thời điểm đã tải" value={timestamp ?? ''} onChange={e => chooseTime(e.target.value)}>{!times.length && <option value="">Chưa có dữ liệu</option>}{timestamp && !times.includes(timestamp) && <option value={timestamp}>{time(timestamp)}</option>}{times.map(ts => <option key={ts} value={ts}>{time(ts)}</option>)}</select></label><Button variant="secondary" disabled={frameIndex < 0 || frameIndex >= times.length-1} onClick={() => chooseTime(times[frameIndex+1])} title="Sau"><Icon name="arrow" size={16}/><span className="sr-only">Sau</span></Button><details className="snapshot-date"><summary aria-label="Chọn ngày giờ khác"><span className="full-date-label">Chọn ngày giờ khác</span><span className="compact-date-label" aria-hidden="true">Ngày giờ</span></summary><form onSubmit={e => {e.preventDefault();try {const ts = vietnamTimeToUtc(draftTime ?? (timestamp ? localTime(timestamp) : ''));if(!ts)throw new Error('Chọn ngày giờ để hiển thị.');if((filters.from && ts < filters.from)||(filters.to && ts > filters.to))throw new Error('Thời điểm phải nằm trong khoảng bộ lọc.');chooseTime(ts);}catch(error){setTimeError((error as Error).message);}}}><Field label="Thời điểm bản đồ · UTC+07" type="datetime-local" step="1" required value={draftTime ?? (timestamp ? localTime(timestamp) : '')} onChange={e => setDraftTime(e.target.value)} /><Button type="submit">Hiển thị các trạm</Button></form></details></div>
      <div className="timeline-playback"><Button variant="secondary" disabled={times.length < 2 || m.status === 'error' || m.hasMore} aria-pressed={playing} onClick={() => { if (!playing && (frameIndex < 0 || frameIndex === times.length-1)) chooseTime(times[0]); setPlaying(v=>!v); }}>{playing ? 'Tạm dừng' : 'Phát timeline'}</Button><label className="timeline-range">Mốc thời gian<input aria-label="Timeline thời gian" type="range" min={0} max={Math.max(0,times.length-1)} step={1} disabled={times.length<2} value={Math.max(0,frameIndex)} aria-valuetext={timestamp ? time(timestamp) : 'Chưa có dữ liệu'} onChange={e=>chooseTime(times[Number(e.target.value)])} /></label><label className="field timeline-age">Độ cũ tối đa<select aria-label="Độ cũ tối đa" value={maxAgeHours} onChange={e=>{setPlaying(false);setMaxAgeHours(Number(e.target.value));}}>{[0.5,1,2,4,6,12,24].map(hours=><option key={hours} value={hours}>{hours} giờ</option>)}</select></label></div>

    </div>}
    </div>
    <div className="explorer-status"><span><strong>{mode === 'map' ? mapRows.length : rows.length}</strong> {mode === 'map' ? 'trạm tại thời điểm đang xem' : 'readings trong Cube'}</span><span>{rows.length} readings đã tải theo thời gian{total !== undefined && ` · dataset ${total.toLocaleString('vi-VN')} readings`}</span><div className="explorer-status-actions">{r.nextCursor && <Button variant="secondary" disabled={r.status === 'loading' || rows.length >= POINT_LIMIT} onClick={loadMore}>Tải tiếp 100 readings</Button>}<Button variant="secondary" onClick={() => {setDock('readings');setDockOpen(true);requestAnimationFrame(()=>dockRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}}>Xem bảng dữ liệu</Button></div></div>
    {r.status === 'loading' && <LoadingState />}{r.status === 'error' && <ErrorState message={errorMessage(r.error)} retry={() => {void readings.retry();}} />}
    <div className="explorer-stage"><div className="viz-main">{mode === 'map' || rows.length ? <Suspense fallback={<LoadingState />}><Renderer scale={scale} spatialHeatmap={spatialHeatmap} marked={marked} key={mode} mode={mode} rows={shown} selected={selected} onSelect={inspect} /></Suspense> : <div className="context-placeholder"><Icon name="cube" size={48} /><p>{r.status === 'ready' ? 'Không có readings phù hợp.' : 'Vùng trực quan sẽ hiển thị khi có dữ liệu.'}</p></div>}</div>
      <aside className="context-panel explorer-inspector" hidden={!inspectorOpen}><header><h3><Icon name="info" size={18} />Chi tiết lựa chọn</h3><Button variant="secondary" aria-label="Đóng chi tiết" onClick={() => setInspectorOpen(false)}>Đóng</Button></header>{mode === 'map' && mapRows.length > 0 && <label className="field snapshot-station">Xem chi tiết trạm tại thời điểm này<select aria-label="Xem chi tiết trạm tại thời điểm này" value={mapRows.some(row=>row.id===selected) ? selected : ''} onChange={e=>{if(e.target.value)inspect(e.target.value);}}><option value="">Chọn để xem chi tiết, không ẩn các trạm khác</option>{mapRows.map(row=><option key={row.id} value={row.id}>{stationName(row.sensorId)} · {row.value} µg/m³</option>)}</select></label>}{chosen ? <><div className="context-value">{chosen.value}<small> µg/m³</small></div><p>Trạm: {stationName(chosen.sensorId)}</p><p>{time(chosen.ts)} · UTC+07</p><p>Lon/Lat: {chosen.location.coordinates.join(', ')}</p><p className="reading-reference">Reading: {chosen.id}</p>{mode === 'map' && Date.parse(chosen.ts) !== Date.parse(timestamp ?? '') && <p className="warning-message">Phép đo đang xem có timestamp thực khác mốc T; chỉ hiện trên bản đồ nếu đủ mới và là mẫu gần nhất của trạm.</p>}<details><summary>Anomaly của reading</summary><p>{anomalies.filter(a => a.readingId === chosen.id).map(a => `${a.id}: ${a.method}, ${a.severity}, ${a.status}`).join('; ') || 'Chưa có trong phần đã tải; không suy ra không có anomaly.'}</p></details></> : <div className="context-placeholder"><Icon name="map" size={28} /><p>Chọn điểm hoặc dòng để xem chi tiết. Các trạm khác vẫn hiển thị.</p></div>}{selected && !chosen && <p role="status">Reading đã chọn chưa nằm trong phần readings đang tải/bộ lọc hiện tại. Không tự tải toàn bộ dataset.</p>}
      {mode === 'map' && <div className="map-layer-control"><h3>Lớp bản đồ</h3><p>Bật/tắt heatmap tại góc trên phải bản đồ.</p><p>Heatmap loang mềm biểu diễn cường độ thị giác từ các trạm; không phải nồng độ chính xác tại mọi vị trí.</p></div>}</aside>
      <div className="map-context-overlay"><strong>{mode === 'map' ? (m.timestamp ? time(m.timestamp) : 'Chưa có khung') : 'Space–Time Cube'}</strong>{mode === 'map' ? <>      {timeError && <p role="alert">{timeError}</p>}{m.status === 'loading' && <p role="status">Đang tải khung mới… {m.timestamp && `Đang giữ khung trước tại ${time(m.timestamp)}; chưa phải dữ liệu của mốc T mới.`}</p>}{m.status === 'error' && <ErrorState message={errorMessage(m.error)} retry={() => {void snapshot.retry();}} />}
      {m.status === 'ready' && m.timestamp === timestamp && <p data-testid="snapshot-status">{mapRows.length} trạm có mẫu · {m.hasMore ? `Đã đọc ${POINT_LIMIT} readings; còn trang, số trạm chưa đầy đủ. Thu hẹp phạm vi.` : 'Đã đọc hết cửa sổ độ cũ.'}{mapRows.length === 1 && ' Chỉ có một trạm có mẫu ở thời điểm này.'}{!mapRows.length && ' Không có mẫu đủ mới; không nội suy hoặc tạo thêm reading.'}</p>}
</> : <p>{rows.length} readings đã tải</p>}</div>
      {mode === 'map' && <div className="map-layers-overlay"><Icon name="layers" size={16}/><label className="inline-layer"><input type="checkbox" aria-label="Heatmap không gian" checked={spatialHeatmap} onChange={e=>setSpatialHeatmap(e.target.checked)}/>Heatmap PM2.5</label></div>}
      <details className="map-legend-overlay" open><summary>Chú giải bản đồ</summary>    <div className="viz-legend"><strong>{mode === 'map' ? 'Điểm trạm · PM2.5' : 'PM2.5'} · µg/m³</strong><span>{scale.min}</span><span className="color-ramp" style={{background:`linear-gradient(90deg, ${color(scale.min,scale.min,scale.max)}, ${color(scale.max,scale.min,scale.max)})`}} /><span>{scale.max}</span><span>Thang màu theo dữ liệu đã tải; không phải ngưỡng sức khỏe.</span></div>
    {mode === 'map' && spatialHeatmap && <div className="heat-intensity-legend"><strong>Cường độ thị giác</strong><span>Thấp</span><span className="heat-intensity-ramp"/><span>Cao</span><span>Phụ thuộc PM2.5, mật độ trạm và zoom. Không phải bản đồ nồng độ chính xác ở mọi vị trí.</span></div>}
</details>
    </div>
    <details className="explorer-dock" ref={dockRef} open={dockOpen} onToggle={e=>setDockOpen(e.currentTarget.open)}><summary className="dock-summary"><Icon name="dataset" size={17}/><strong>Dữ liệu bổ trợ</strong><span>{rows.length} readings đã tải</span><span className="dock-disclosure-hint">Mở / thu gọn</span></summary><nav aria-label="Dữ liệu bổ trợ" className="dock-tabs">{([['readings','Bảng readings'],['heatmap','Heatmap thời gian'],['stations','Trạm'],['help','Hướng dẫn']] as const).map(([id,label])=><Button key={id} variant="secondary" aria-pressed={dock === id} onClick={()=>setDock(id)}>{label}</Button>)}</nav>
      <div hidden={dock !== 'readings'} className="dock-content"><div className="records-toolbar"><div><h3>Readings</h3><p>{rows.length} đã tải{r.nextCursor ? ' · Còn dữ liệu' : ''}. Chọn dòng chỉ xem chi tiết, không lọc bản đồ.</p></div><label className="field">Thứ tự thời gian<select value={sort} onChange={e=>{select(undefined);setSort(e.target.value as typeof sort);}}><option value="ts:asc">Cũ → mới</option><option value="ts:desc">Mới → cũ</option></select></label>{r.nextCursor && <Button disabled={r.status === 'loading'||rows.length>=POINT_LIMIT} onClick={loadMore}>Tải thêm readings</Button>}</div><div className="table-scroll records-scroll" tabIndex={0} role="region" aria-label="Bảng readings"><table><thead><tr><th>Trạm</th><th>Thời gian · UTC+07</th><th>PM2.5 · µg/m³</th><th>Chi tiết</th><th>Reading ID</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} aria-selected={row.id===selected}><td title={row.sensorId}>{stationName(row.sensorId)}</td><td>{time(row.ts)}</td><td className="numeric-cell">{row.value}</td><td><Button variant="secondary" aria-label={`Chọn ${row.id}`} onClick={()=>inspect(row.id)}>Xem chi tiết</Button></td><td className="reading-reference">{row.id}</td></tr>)}</tbody></table></div>{rows.length>=POINT_LIMIT && r.nextCursor && <p className="warning-message">Đã đạt giới hạn {POINT_LIMIT} readings trong Cube/bảng; dùng bộ lọc thời gian để tra cứu tiếp. Bản đồ tải các trạm riêng theo thời điểm.</p>}</div>
      <div hidden={dock !== 'heatmap'} className="dock-content"><TemporalHeatmap rows={rows} /></div>
      <div hidden={dock !== 'stations'} className="dock-content"><h3>Trạm trong dataset/vùng đã áp dụng ({s.data.length} đã tải)</h3><p>Danh sách metadata không lọc theo thời gian.</p>{s.status === 'error' && <ErrorState message={errorMessage(s.error)} retry={()=>{void sensors.retry();}} />}<label className="field">Chọn trạm đã tải<select value={filters.sensorId??''} onChange={e=>onSensor(e.target.value)}><option value="">Tất cả trạm</option>{filters.sensorId&&!s.data.some(sensor=>sensor.id===filters.sensorId)&&<option value={filters.sensorId}>{filters.sensorId}</option>}{s.data.map(sensor=><option key={sensor.id} value={sensor.id}>{sensor.name} · {sensor.externalId}</option>)}</select></label>{s.nextCursor&&<Button disabled={s.status==='loading'||s.data.length>=POINT_LIMIT} onClick={()=>{void sensors.loadMore();}}>Tải thêm trạm</Button>}</div>
      <div hidden={dock !== 'help'} className="dock-content technical-details"><h3>Cách đọc bản đồ</h3><p>Mapbox đọc cửa sổ [T − độ cũ tối đa, T] trong phạm vi bộ lọc, lấy tối đa một reading gần nhất mỗi trạm. Mẫu đúng giới hạn độ cũ vẫn được giữ; mẫu cũ hơn bị loại. Không nội suy readings. Hiệu ứng chuyển tiếp chỉ hòa trộn hai hình ảnh heatmap, không tạo phép đo trung gian. Cube giữ các readings đã tải trong khoảng thời gian. Chọn một điểm/dòng chỉ mở chi tiết.</p><p>Trước/Sau và danh sách thời điểm lấy từ readings đã tải; nạp thêm để có thêm thời điểm, hoặc nhập ngày giờ bất kỳ trong phạm vi bộ lọc. Bản đồ đọc tối đa {POINT_LIMIT} readings mỗi cửa sổ; nếu còn trang sẽ báo thiếu dữ liệu và dừng phát tự động. Phát qua các mốc đã tải, tạm dừng khi tab ẩn; giữ khung trước trong lúc tải để tránh nhấp nháy.</p><p>Cube: X đỏ = kinh độ, Y xanh lá = vĩ độ, Z xanh dương = thời gian. Kéo để xoay, cuộn để zoom, chuột phải để pan.</p><p>Lớp anomaly: {resultRun ? `run ${resultRun.id}, ${anomalies.length} đã tải` : `${anomalies.length} chi tiết đã tải`}; tô/viền tím chỉ các reading khớp, không thay thang PM2.5.</p></div>
    </details>
  </section>;
}
