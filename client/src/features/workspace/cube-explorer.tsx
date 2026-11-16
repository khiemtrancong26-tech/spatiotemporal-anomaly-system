import { explorationOffset } from '@pm25/shared-core';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { Anomaly, Sensor } from '../../shared/api/generated/wire';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { Button, ErrorState, Field, LoadingState } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import { Icon } from '../../shared/ui/icons';
import { POINT_LIMIT } from './geometry';
import { cubeTime, HOUR, hourlySegments, localCubeTime, parseCubeTime, PM25_STOPS, pm25Color, sliceReadings, sliceSummary, stationStats, type CubeMode, type CubeScope } from './cube-data';
import type { WorkspaceFilters } from './state';
import type { Reading } from '../../shared/api/generated/wire';
const CubeRenderer = lazy(() => import('./cube-renderer'));
const titles = { overview: '01 Tổng quan', station: '02 Theo trạm', anomaly: '03 Điều tra bất thường' };
const descriptions = { overview: 'Khám phá các trạm cùng tăng PM2.5 theo không gian và thời gian.', station: 'Theo dõi diễn biến tại một trạm, đối chiếu với bối cảnh xung quanh.', anomaly: 'Điều tra kết quả detector đã công bố, rồi mở review chính thức.' };
const num = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

function StationChart({ rows, scope, offset, onSelect }: { rows: Reading[]; scope: CubeScope; offset: number; onSelect: (id: string) => void }) {
  const from = Date.parse(scope.from), span = Math.max(1, Date.parse(scope.to) - from);
  const x = (r: Reading) => 32 + (Date.parse(r.ts) - from) / span * 248;
  const y = (r: Reading) => 135 - Math.min(370, r.value) / 370 * 113;
  return <svg className="cube-station-chart" viewBox="0 0 300 170" role="img" aria-label="Readings đã tải; ngắt nối khi cách nhau quá một giờ, chưa kết luận thiếu dữ liệu theo cadence">
    {[0, 150, 370].map(v => <g key={v}><line x1="32" x2="280" y1={135 - v / 370 * 113} y2={135 - v / 370 * 113} stroke="#DFE7EF" /><text x="2" y={139 - v / 370 * 113}>{v}</text></g>)}
    {hourlySegments(rows).map(segment => <polyline key={segment[0].id} points={segment.map(r => `${x(r)},${y(r)}`).join(' ')} fill="none" stroke="#087F86" strokeWidth="1.5" />)}
    {rows.map(r => <circle key={r.id} cx={x(r)} cy={y(r)} r="3" fill={pm25Color(r.value)} tabIndex={0} role="button" aria-label={`${cubeTime(r.ts, offset)}: ${r.value} µg/m³`} onClick={() => onSelect(r.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); } }}><title>{cubeTime(r.ts, offset)} · {r.value} µg/m³</title></circle>)}
    <text x="32" y="160">{cubeTime(scope.from, offset, true)}</text><text x="280" y="160" textAnchor="end">{cubeTime(scope.to, offset, true)}</text>
  </svg>;
}

export function CubeExplorer({ initialTimestamp, datasetId, filters, anchor, seedReady, seedError, retrySeed, sensors, sensorsComplete, sensorsError, retrySensors, loadSensors, onMap, onDock, onRows }: {
  initialTimestamp?: string; datasetId: string; filters: WorkspaceFilters; anchor?: string; seedReady: boolean; seedError?: string; retrySeed: () => void; sensors: Sensor[]; sensorsComplete: boolean; sensorsError?: string;
  retrySensors: () => void; loadSensors?: () => void; onMap: (ts?: string) => void; onDock: () => void; onRows: (rows: Reading[]) => void;
}) {
  const { data, workspace, datasets } = useServices();
  const selected = useStore(workspace, s => s.selectedReadingId), resultRun = useStore(workspace, s => s.resultRun);
  const existing = useStore(workspace, s => s.anomalies);
  const [mode, setMode] = useState<CubeMode>(initialTimestamp ? 'station' : 'overview');
  const zone = useStore(workspace, s => s.timeZone), offset = explorationOffset(zone);
  const [focused, focus] = useState(filters.sensorId ?? ''), [showContext, setContext] = useState(true);
  const [customScope, setScope] = useState<CubeScope>(), [windowHours, setHours] = useState('24');
  const [draftFrom, setFrom] = useState<string>(), [draftTo, setTo] = useState<string>(), [scopeError, setScopeError] = useState('');
  useEffect(() => { setFrom(undefined); setTo(undefined); }, [offset]);
  const [requested, setRequested] = useState<string | undefined>(initialTimestamp), [playing, play] = useState(false), [speed, setSpeed] = useState(1800);
  const [runChoice, setRunChoice] = useState<string>(), [status, setStatus] = useState(''), [severity, setSeverity] = useState('');
  const readings = useMemo(() => createCursorPager(data.readings.list), [data]);
  const runs = useMemo(() => createCursorPager(data.analysis.list), [data]);
  const anomalies = useMemo(() => createCursorPager(data.anomalies.list), [data]);
  const r = useSyncExternalStore(readings.subscribe, readings.getSnapshot), a = useSyncExternalStore(anomalies.subscribe, anomalies.getSnapshot), runsState = useSyncExternalStore(runs.subscribe, runs.getSnapshot);
  const [defaultScope, setDefaultScope] = useState<CubeScope>();
  useEffect(() => {
    if (defaultScope) return;
    const from = filters.from ?? anchor;
    if (!from) return undefined;
    const end = Date.parse(from) + 24 * HOUR - 1;
    setDefaultScope({ from, to: new Date(Math.min(end, filters.to ? Date.parse(filters.to) : end)).toISOString() });
  }, [defaultScope, filters.from, filters.to, anchor]);
  const scope = customScope ?? defaultScope;
  useEffect(() => { if (scope) void readings.setQuery({ datasetId, ...filters, ...scope, sort: 'ts:asc', limit: 100 }); return () => readings.dispose(); }, [readings, datasetId, filters, scope]);
  useEffect(() => { if (r.status === 'ready' && r.nextCursor && r.data.length < POINT_LIMIT) void readings.loadMore(); }, [readings, r.status, r.nextCursor, r.data.length]);
  useEffect(() => { if (mode === 'anomaly') void runs.setQuery({ datasetId, sort: 'createdAt:desc', limit: 100 }); }, [mode, runs, datasetId]);
  useEffect(() => () => { runs.dispose(); anomalies.dispose(); }, [runs, anomalies]);
  const runId = runChoice ?? (resultRun?.datasetId === datasetId ? resultRun.id : undefined) ?? existing.find(v => v.datasetId === datasetId)?.analysisRunId;
  useEffect(() => {
    if (runId && scope) void anomalies.setQuery({ datasetId, analysisRunId: runId, ...scope, sort: 'ts:asc', limit: 100 });
    return () => anomalies.dispose();
  }, [anomalies, datasetId, runId, scope]);
  const rows = r.data;
  useEffect(() => { onRows(rows); }, [onRows, rows]);
  const times = useMemo(() => [...new Set(rows.map(row => row.ts))].sort((a, b) => Date.parse(a) - Date.parse(b)), [rows]);
  const timestamp = requested && times.includes(requested) ? requested : times[0];
  const frame = timestamp ? times.indexOf(timestamp) : -1;
  const complete = r.status === 'ready' && !r.nextCursor;
  const expected = filters.sensorId ? [filters.sensorId] : sensors.map(s => s.id);
  const atSlice = sliceReadings(rows, timestamp), summary = sliceSummary(atSlice, expected, complete && sensorsComplete);
  const focusedId = focused || sensors[0]?.id || rows[0]?.sensorId || '';
  const stationRows = useMemo(() => rows.filter(row => row.sensorId === focusedId), [rows, focusedId]);
  const stats = stationStats(stationRows);
  const chosen = rows.find(row => row.id === selected);
  const name = (id: string) => sensors.find(s => s.id === id)?.name ?? id;
  const official = useMemo(() => a.data.filter(item => item.datasetId === datasetId && item.analysisRunId === runId && (!filters.sensorId || item.sensorId === filters.sensorId) && (!filters.bbox || (item.location.coordinates[0] >= filters.bbox[0] && item.location.coordinates[0] <= filters.bbox[2] && item.location.coordinates[1] >= filters.bbox[1] && item.location.coordinates[1] <= filters.bbox[3])) && (!focused || item.sensorId === focused) && (!status || item.status === status) && (!severity || item.severity === severity)), [a.data, datasetId, runId, filters.sensorId, filters.bbox, focused, status, severity]);
  const marked = useMemo(() => new Set(official.map(item => item.readingId)), [official]);
  const selectedAnomaly = official.find(item => item.readingId === selected);
  const total = datasets.get(datasetId)?.importSummary?.importedRows;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => { if (!complete || document.hidden || frame < 0 || frame >= times.length - 1) play(false); else setRequested(times[frame + 1]); }, speed);
    return () => window.clearTimeout(timer);
  }, [playing, complete, frame, times, speed]);
  useEffect(() => { const hide = () => { if (document.hidden) play(false); }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, []);
  const chooseTime = useCallback((ts: string) => { play(false); setRequested(ts); }, []);
  const select = useCallback((id: string) => { workspace.getState().selectReading(id); const row = rows.find(r => r.id === id); if (row) chooseTime(row.ts); }, [workspace, rows, chooseTime]);
  function applyScope(hours = windowHours) {
    try {
      const from = parseCubeTime(draftFrom ?? (scope ? localCubeTime(scope.from, offset) : ''), offset);
      const to = hours === 'custom' ? parseCubeTime(draftTo ?? (scope ? localCubeTime(scope.to, offset) : ''), offset) : new Date(Date.parse(from) + Number(hours) * HOUR - 1).toISOString();
      if (Date.parse(to) < Date.parse(from)) throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
      if ((filters.from && Date.parse(from) < Date.parse(filters.from)) || (filters.to && Date.parse(to) > Date.parse(filters.to))) throw new Error('Khoảng Cube phải nằm trong bộ lọc workspace đã áp dụng.');
      play(false); setRequested(undefined); setScope({ from, to }); setScopeError('');
    } catch (error) { setScopeError((error as Error).message); }
  }
  const dayStart = timestamp ? Math.floor((Date.parse(timestamp) + offset * HOUR) / (24 * HOUR)) * 24 * HOUR - offset * HOUR : 0;
  const hourlyRows = Array.from({ length: 24 }, (_, i) => dayStart + i * HOUR).filter(t => scope && t >= Date.parse(scope.from) && t <= Date.parse(scope.to));
  const sliceOthers = atSlice.filter(r => r.sensorId !== focusedId);
  const otherValues = sliceOthers.map(r => r.value).sort((a,b) => a-b);
  const comparisonComplete = summary.mean !== undefined && atSlice.some(r => r.sensorId === focusedId) && otherValues.length > 0;
  const median = otherValues.length % 2 ? otherValues[Math.floor(otherValues.length/2)] : (otherValues[otherValues.length/2-1]+otherValues[otherValues.length/2])/2;
  const unavailable = () => complete ? 'Không có reading tại mốc (coverage xem Profile)' : 'Chưa xác định · chưa tải đủ';
  function review(item: Anomaly) {
    workspace.getState().setResults(resultRun, [...new Map([...existing, item].map(a => [a.id, a])).values()]);
    workspace.getState().selectReading(item.readingId); workspace.getState().openAnomalies(item.analysisRunId, item.id, true);
  }
  return <div className="cube-explorer">
    <nav className="cube-submodes" aria-label="Chế độ Cube">{(['overview', 'station', 'anomaly'] as const).map(id => <Button key={id} variant="secondary" aria-pressed={mode === id} onClick={() => setMode(id)}>{titles[id]}</Button>)}</nav>
    <header className="cube-heading"><h2 className="sr-only">{titles[mode]}</h2><p>{descriptions[mode]}</p></header>
    <form className="cube-filters" onSubmit={e => { e.preventDefault(); applyScope(); }}>
      <label className="field">{mode === 'station' ? 'Trạm tập trung' : 'Trạm làm nổi bật / lọc kết quả'}<select aria-label="Trạm trong Cube" value={mode === 'station' ? focusedId : focused} onChange={e => focus(e.target.value)}>{mode !== 'station' && <option value="">Tất cả trạm đã tải</option>}{[...new Set([...sensors.map(s => s.id), ...rows.map(r => r.sensorId)])].map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>
      <label className="field">Cửa sổ thời gian<select aria-label="Cửa sổ Cube" value={windowHours} onChange={e => setHours(e.target.value)}><option value="24">24 giờ</option><option value="48">48 giờ</option><option value="168">7 ngày · có thể chưa tải hết</option><option value="custom">Tùy chọn</option></select></label>
      <Field label={`Từ Cube · UTC+0${offset}`} type="datetime-local" required value={draftFrom ?? (scope ? localCubeTime(scope.from, offset) : '')} onChange={e => setFrom(e.target.value)} />
      {windowHours === 'custom' && <Field label={`Đến Cube · UTC+0${offset}`} type="datetime-local" required value={draftTo ?? (scope ? localCubeTime(scope.to, offset) : '')} onChange={e => setTo(e.target.value)} />}
      <label className="field">Múi giờ Cube<select aria-label="Múi giờ Cube" value={offset} onChange={e => { workspace.getState().setTimeZone(Number(e.target.value) === 0 ? 'UTC' : Number(e.target.value) === 8 ? '+08:00' : '+07:00'); setFrom(undefined); setTo(undefined); }}><option value="0">UTC</option><option value="7">UTC+07 · Việt Nam</option><option value="8">UTC+08 · Bắc Kinh</option></select></label>
      <Button type="submit">Xem phạm vi</Button>
      {mode === 'station' && <label className="cube-check"><input type="checkbox" checked={!showContext} onChange={e => setContext(!e.target.checked)} />Chỉ trạm này</label>}
    </form>
    {scopeError && <p role="alert" className="text-error">{scopeError}</p>}
    <div className="cube-coverage" data-testid="cube-coverage"><span><strong>{rows.length}</strong> readings đã tải trong phạm vi{total !== undefined && ` · Tổng dataset: ${num(total)} readings`}</span><span>{sensors.length} trạm metadata đã tải{filters.bbox ? ' trong bbox' : ''} · {offset === 0 ? 'UTC' : `UTC+0${offset}`}</span>{scope && <span>{cubeTime(scope.from, offset)} → {cubeTime(scope.to, offset)}</span>}<Button variant="secondary" onClick={onDock}>Xem bảng dữ liệu</Button></div>
    {(r.status === 'loading' || (!scope && !seedReady && !seedError)) && <LoadingState label="Đang tải phạm vi Cube…" />}
    {!scope && seedReady && <p role="status">Không có phép đo trong khoảng đã chọn.</p>}
    {!scope && seedError && <ErrorState message={seedError} retry={retrySeed} />}
    {r.status === 'error' && <ErrorState message={errorMessage(r.error)} retry={() => { void readings.retry(); }} />}
    {r.nextCursor && <p className="warning-message" role="status">Phạm vi chưa tải hết · {rows.length}/{POINT_LIMIT} readings. {rows.length >= POINT_LIMIT ? 'Thu hẹp khoảng thời gian để xem đầy đủ.' : 'Đang tải các trang trong ngân sách Cube.'}</p>}
    {sensorsError && <ErrorState message={sensorsError} retry={retrySensors} />}{!sensorsComplete && !sensorsError && <p className="warning-message">Metadata trạm chưa tải đủ; chưa xác nhận thống kê toàn bộ trạm. {loadSensors && <Button variant="secondary" onClick={loadSensors}>Tải thêm trạm</Button>}</p>}
    {mode === 'anomaly' && <div className="cube-anomaly-filters"><label className="field">Analysis Run<select aria-label="Analysis Run trong Cube" value={runId ?? ''} onChange={e => { setRunChoice(e.target.value || undefined); workspace.getState().selectReading(undefined); }}><option value="">Chọn kết quả đã hoàn tất</option>{runId && !runsState.data.some(run => run.id === runId) && <option value={runId}>{runId}</option>}{runsState.data.filter(run => run.status === 'completed').map(run => <option key={run.id} value={run.id}>{run.id} · {run.method}</option>)}</select></label>{(['status', 'severity'] as const).map(field => <label className="field" key={field}>{field === 'status' ? 'Trạng thái' : 'Mức độ'}<select aria-label={`Cube ${field}`} value={field === 'status' ? status : severity} onChange={e => field === 'status' ? setStatus(e.target.value) : setSeverity(e.target.value)}>{(field === 'status' ? ['', 'open', 'confirmed', 'false_positive'] : ['', 'low', 'medium', 'high']).map(v => <option key={v} value={v}>{v || 'Tất cả'}</option>)}</select></label>)}{runsState.status === 'loading' && <LoadingState label="Đang tải Analysis Runs…" />}{runsState.status === 'error' && <ErrorState message={errorMessage(runsState.error)} retry={() => { void runs.retry(); }} />}{runsState.nextCursor && <Button variant="secondary" disabled={runsState.status === 'loading' || runsState.data.length >= POINT_LIMIT} onClick={() => { void runs.loadMore(); }}>Tải thêm runs</Button>}</div>}
    <div className="cube-layout"><div className="cube-stage">
      {scope && <Suspense fallback={<LoadingState />}><CubeRenderer rows={rows} sensors={sensors} scope={scope} mode={mode === 'overview' && focused ? 'station' : mode} focusedSensorId={focusedId} showContext={mode === 'station' ? showContext : true} timestamp={timestamp} selected={selected} marked={marked} offset={offset} onSelect={select} /></Suspense>}
      {complete && !rows.length && <div className="cube-empty" role="status">Không có phép đo trong khoảng đã chọn.</div>}
    </div><aside className="cube-panel" aria-label="Thông tin phân tích Cube">
      {mode === 'overview' && <section className="cube-card"><h3><Icon name="activity" size={18} />Ở đâu? Khi nào? Bao lâu?</h3><dl><dt>Ở đâu?</dt><dd>{summary.count} trạm có mẫu trong lát ±30 phút.{atSlice.length > 0 && <> Cao nhất: {name([...atSlice].sort((a, b) => b.value - a.value)[0].sensorId)}.</>}</dd><dt>Khi nào?</dt><dd>{timestamp ? `${cubeTime(timestamp, offset)} · UTC+0${offset}` : 'Chưa có mốc thời gian.'}</dd><dt>Trung bình tại lát</dt><dd data-testid="cube-slice-mean">{summary.mean === undefined ? 'Chưa đầy đủ · chưa công bố trung bình toàn bộ trạm.' : `${num(summary.mean)} µg/m³ · đủ ${expected.length} trạm trong phạm vi.`}</dd><dt>Bao lâu?</dt><dd>Chọn các mốc trên timeline để đối chiếu. Chưa đặt tiêu chí thời lượng; chưa kết luận đợt ô nhiễm.</dd></dl></section>}
      {mode === 'station' && <><section className="cube-card"><p className="eyebrow">TRẠM ĐANG TẬP TRUNG</p><h3>{name(focusedId)}</h3>{stats ? <div className="cube-stat-grid"><span>Min<b>{num(stats.min)}</b></span><span>Mean<b>{num(stats.mean)}</b></span><span>Max<b>{num(stats.max)}</b></span></div> : <p>Chưa có mẫu của trạm trong phạm vi.</p>}<p className="muted">µg/m³ · {stationRows.length} readings đã tải{!complete && ' · phạm vi chưa đầy đủ'}</p>{comparisonComplete ? <p>Trung vị {otherValues.length} trạm khác tại lát: <strong>{num(median)} µg/m³</strong>. Đối chiếu mô tả.</p> : <p>Đối chiếu các trạm tại lát: chưa đủ dữ liệu.</p>}{scope && <StationChart rows={stationRows} scope={scope} offset={offset} onSelect={select} />}</section><section className="cube-card"><h3>Chuỗi theo giờ · {offset === 0 ? 'UTC' : `UTC+0${offset}`}</h3><p>{timestamp && cubeTime(new Date(dayStart).toISOString(), offset).split(',')[0]} · khoảng trống không phải giá trị 0.</p><div className="cube-table-scroll" tabIndex={0} role="region" aria-label="Chuỗi giờ của trạm"><table><thead><tr><th>Giờ</th><th>µg/m³</th><th>Trạng thái</th></tr></thead><tbody>{hourlyRows.map(ts => { const row = stationRows.find(r => Date.parse(r.ts) === ts); return <tr key={ts} aria-selected={Boolean(row && row.id === selected)}><td>{row ? <button className="cube-row-button" onClick={() => select(row.id)}>{localCubeTime(row.ts, offset).slice(11)}</button> : localCubeTime(new Date(ts).toISOString(), offset).slice(11)}</td><td>{row?.value ?? '—'}</td><td>{row ? 'Có mẫu' : unavailable()}</td></tr>; })}</tbody></table></div></section><Button onClick={() => onMap(chosen?.ts ?? timestamp)}><Icon name="map" />Xem trên Mapbox</Button></>}
      {mode === 'anomaly' && <section className="cube-card"><h3>Kết quả phát hiện bất thường</h3>{!runId ? <><p>Chưa có kết quả phát hiện bất thường được chọn.</p><Button onClick={() => workspace.getState().selectTab('analysis')}>Đi tới Phân tích</Button></> : <><p>Run: <strong>{runId}</strong></p>{a.status === 'loading' && <LoadingState label="Đang tải anomalies…" />}{a.status === 'error' && <ErrorState message={errorMessage(a.error)} retry={() => { void anomalies.retry(); }} />}{a.status === 'ready' && <p data-testid="cube-anomaly-count">{official.length} anomalies theo bộ lọc trên {a.data.length} kết quả đã tải{a.nextCursor ? ' · còn trang' : ' · đã hết trang trong phạm vi'}.</p>}<div className="cube-anomaly-list">{official.map(item => <button key={item.id} className="cube-anomaly-item" aria-pressed={item.readingId === selected} onClick={() => { workspace.getState().selectReading(item.readingId); if (rows.some(r => r.id === item.readingId)) chooseTime(item.ts); }}><strong>{name(item.sensorId)}</strong><span>{cubeTime(item.ts, offset)} · {offset === 0 ? 'UTC' : `UTC+0${offset}`}</span><span>{rows.find(r => r.id === item.readingId)?.value ?? 'Reading chưa tải'}{rows.some(r => r.id === item.readingId) && ' µg/m³'} · {item.method}</span></button>)}</div>{a.nextCursor && <Button variant="secondary" disabled={a.status === 'loading' || a.data.length >= POINT_LIMIT} onClick={() => { void anomalies.loadMore(); }}>Tải thêm kết quả</Button>}{a.status === 'ready' && !official.length && <p>Không có anomaly trong phần kết quả và bộ lọc đang xem.</p>}</>}{selectedAnomaly && <div className="cube-anomaly-detail"><h3>Chi tiết anomaly chính thức</h3><dl><dt>Method</dt><dd>{selectedAnomaly.method}</dd><dt>Score</dt><dd>{selectedAnomaly.score}</dd><dt>Severity</dt><dd>{selectedAnomaly.severity}</dd><dt>Status</dt><dd>{selectedAnomaly.status}</dd><dt>Ghi chú</dt><dd>{selectedAnomaly.note || 'Chưa có ghi chú'}</dd></dl><Button onClick={() => review(selectedAnomaly)}>Mở review</Button></div>}</section>}
      {selected && <section className="cube-card cube-inspector"><h3>Chi tiết reading</h3>{chosen ? <><strong>{name(chosen.sensorId)}</strong><div className="cube-reading-value">{num(chosen.value)} <small>µg/m³</small></div><p>{cubeTime(chosen.ts, offset)} · {offset === 0 ? 'UTC' : `UTC+0${offset}`}</p><p className="reading-reference">Reading: {chosen.id}</p><Button variant="secondary" onClick={() => onMap(chosen.ts)}>Xem reading trên Mapbox</Button></> : <p>Reading đã chọn chưa nằm trong phạm vi đã tải. Thu hẹp hoặc đổi khoảng Cube để xem; không tạo điểm từ anomaly.</p>}</section>}
      <section className="cube-card cube-legend"><h3>PM2.5 đo tại trạm (µg/m³)</h3><div className="cube-color-ramp" style={{ background: `linear-gradient(90deg, ${PM25_STOPS.map(([v, c]) => `${c} ${v / 370 * 100}%`).join(',')})` }} /><div className="cube-color-ticks">{[0, 35, 55, 100, 150, 250, 370].map(v => <span key={v} style={{left:`${v/370*100}%`}}>{v}</span>)}</div><p>Thang màu cố định · giá trị đo thực.</p>{mode === 'anomaly' && <p><span className="cube-ring-key" />Anomaly từ AnalysisRun · tâm giữ màu PM2.5.</p>}<p className="muted">Vòng lớn: reading đang chọn. Chỉ các phép đo tồn tại được vẽ.</p></section>
    </aside></div>
    <div className="cube-timeline"><Button aria-pressed={playing} disabled={!complete || times.length < 2} onClick={() => { if (!playing && frame >= times.length - 1) setRequested(times[0]); play(v => !v); }}>{playing ? 'Tạm dừng Cube' : 'Phát Cube'}</Button><Button variant="secondary" aria-label="Mốc Cube trước" disabled={frame <= 0} onClick={() => chooseTime(times[frame - 1])}>‹</Button><label className="cube-time-select">Lát thời gian · {offset === 0 ? 'UTC' : `UTC+0${offset}`}<select aria-label="Lát thời gian Cube" value={timestamp ?? ''} onChange={e => chooseTime(e.target.value)}>{!times.length && <option value="">Chưa có dữ liệu</option>}{times.map(ts => <option key={ts} value={ts}>{cubeTime(ts, offset)}</option>)}</select></label><Button variant="secondary" aria-label="Mốc Cube sau" disabled={frame < 0 || frame >= times.length - 1} onClick={() => chooseTime(times[frame + 1])}>›</Button><label className="cube-slider">Timestamp thực đã tải<input aria-label="Timeline Cube" type="range" min="0" max={Math.max(0, times.length - 1)} value={Math.max(0, frame)} disabled={times.length < 2} aria-valuetext={timestamp ? `${cubeTime(timestamp, offset)} UTC+0${offset}` : 'Chưa có dữ liệu'} onChange={e => chooseTime(times[Number(e.target.value)])} /></label><label className="field">Tốc độ<select aria-label="Tốc độ Cube" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value="1800">1,8 giây / mốc</option><option value="3000">3 giây / mốc</option><option value="1000">1 giây / mốc</option></select></label></div>
    <details className="cube-help"><summary>Cách đọc Cube và dữ liệu bổ trợ</summary><p>Kéo để xoay, cuộn để zoom. Tất cả chế độ giữ chung vị trí và thang thời gian. Lát ±30 phút dùng timestamp thực, không nội suy; thiếu mẫu không phải 0. Thống kê chỉ mô tả phần đã tải. Điểm PM2.5 cao chưa đủ để kết luận anomaly.</p></details>
  </div>;
}
