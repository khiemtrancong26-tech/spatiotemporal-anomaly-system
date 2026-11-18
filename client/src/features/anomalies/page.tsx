import { runClientTask } from '../../app/error-handling';
import { useStore } from 'zustand';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useOfflineState, useServices } from '../../app/services';
import { StatusBadge, Button, Field, ErrorState, LoadingState } from '../../shared/ui/primitives';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { errorMessage } from '../../shared/api/errors';
import type { Anomaly, AnomaliesQuery } from '../../shared/api/generated/wire';
import type { WorkspaceFilters } from '../workspace/state';
import { explorationUtcTime } from '@pm25/shared-core';
import { formatWorkspaceTime, explorationLocalTime, zoneLabel } from '../workspace/time';
import { methodName, number, scoreLabel, sensorName, shortId } from '../workspace/analyst';
import { TechnicalId, useAnalystSensors } from '../workspace/analyst-ui';
import { targetFromAnomaly } from '../workspace/investigation';
import { AnomalyReading } from './reading';
import { AnomalyReview } from './review';

export function AnomaliesPage({ datasetId, filters, runId, initialAnomalyId, active = true }: { datasetId: string; filters: WorkspaceFilters; runId?: string; initialAnomalyId?: string; active?: boolean }) {
  const { data, workspace } = useServices(), zone = useStore(workspace, s => s.timeZone), context = useStore(workspace, s => s.anomalyContext);
  const local = useOfflineState();
  const sensors = useAnalystSensors(datasetId);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [draft, setDraft] = useState({ run: context?.runId ?? runId ?? '', family: '', method: '', severity: '', status: '', sort: 'ts:asc' });
  const [query, setQuery] = useState<AnomaliesQuery>({ datasetId, analysisRunId: context?.runId ?? runId, from: (context?.runId ?? runId) ? undefined : filters.from, to: (context?.runId ?? runId) ? undefined : filters.to, sort: 'ts:asc', limit: 100 });
  const [dateFrom, setFrom] = useState<string>(), [dateTo, setTo] = useState<string>();
  const [item, setItem] = useState<Anomaly>(), [error, setError] = useState(''), [loading, setLoading] = useState(false), [reviewOpen, openReview] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const handledContext = useRef<typeof context>(undefined), listRef = useRef<HTMLDivElement>(null);
  const pager = useMemo(() => createCursorPager(data.anomalies.list), [data]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => { if (active) runClientTask(pager.setQuery(query)); }, [pager, query, active, local.offline]);
  useEffect(() => () => { pager.dispose(); request.current?.abort(); }, [pager]);
  useEffect(() => { setFrom(undefined); setTo(undefined); }, [zone]);
  const lastGlobal = useRef(JSON.stringify([filters.from, filters.to]));
  useEffect(() => {
    const key = JSON.stringify([filters.from, filters.to]);
    if (active && key !== lastGlobal.current) { lastGlobal.current = key; openReview(false); setItem(undefined); setQuery(q => ({ ...q, from: filters.from, to: filters.to })); setFrom(undefined); setTo(undefined); }
  }, [active, filters.from, filters.to]);
  const targetId = context?.anomalyId ?? initialAnomalyId;
  useEffect(() => {
    if (!active || (context && context === handledContext.current)) return;
    if (context) {
      setFrom(undefined); setTo(undefined);
      setDraft(d => ({ ...d, run: context.runId ?? '', family: '', method: '', severity: '', status: '' }));
      setQuery({ datasetId, analysisRunId: context.runId, sort: 'ts:asc', limit: 100 });
    }
    if (!targetId) {
      handledContext.current = context;
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true); setError('');
    void data.anomalies.get(targetId, { signal: controller.signal }).then(a => {
      if (controller.signal.aborted) return;
      if (a.datasetId !== datasetId || a.id !== targetId || (context?.runId && a.analysisRunId !== context.runId)) throw new Error('Response anomaly không khớp dataset/run/ID.');
      setItem(a); openReview(context?.review ?? false);
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => {
      // An interrupted request must be retried if the same context is reopened.
      if (controller.signal.aborted) return;
      handledContext.current = context;
      request.current = undefined;
      setLoading(false);
    });
    return () => controller.abort();
  }, [active, context, targetId, data, datasetId]);
  useEffect(() => {
    if (active) return;
    request.current?.abort();
    setLoading(false);
  }, [active]);
  function discard() { return !workspace.getState().reviewDirty || window.confirm('Bỏ bản review chưa lưu để tiếp tục?'); }
  async function select(id: string) {
    if (!discard()) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true); setError(''); openReview(false);
    try { const a = await data.anomalies.get(id, { signal: controller.signal }); if (!controller.signal.aborted) { if (a.datasetId !== datasetId || a.id !== id) throw new Error('Response không khớp'); setItem(a); setOverrides(previous => ({...previous,[a.id]:a})); const current = workspace.getState(); current.setResults(current.resultRun, [...new Map([...current.anomalies, a].map(v => [v.id, v])).values()]); } }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function saved(a: Anomaly) {
    setItem(a); setOverrides(previous => ({...previous,[a.id]:a})); const current = workspace.getState(); current.setResults(current.resultRun, current.anomalies.map(v => v.id === a.id ? a : v));
    // Patch the displayed item locally, retaining the loaded pages/cursor and scroll.
    setOverrides(previous => ({ ...previous, [a.id]: a }));
  }
  const [overrides, setOverrides] = useState<Record<string, Anomaly>>({});
  const rows = state.data.map(a => overrides[a.id] && overrides[a.id].version >= a.version ? overrides[a.id] : a).filter(a => (!query.status || a.status === query.status) && (!query.severity || a.severity === query.severity));
  function investigate(mode: 'map' | 'cube') { if (item && discard()) workspace.getState().investigate(targetFromAnomaly(item, mode)); }
  return <section className="analyst-ux ux-anomalies"><header className="ux-page-heading"><div><p className="ux-eyebrow">03 · ĐIỀU TRA VÀ ĐÁNH GIÁ</p><h2>Anomalies cần xem xét</h2><p>Phát hiện của detector cần được đối chiếu và đánh giá trong bối cảnh.</p></div><Button variant="secondary" onClick={() => { if (discard()) workspace.getState().selectTab('analysis'); }}>Quay lại Analysis</Button></header>
    <details className="ux-filter-disclosure" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary>Bộ lọc phát hiện</summary><form className="ux-panel ux-anomaly-filters" onSubmit={e => { e.preventDefault(); if (!discard()) return; try { const from = dateFrom === undefined ? query.from : dateFrom ? explorationUtcTime(dateFrom, zone) : undefined, to = dateTo === undefined ? query.to : dateTo ? explorationUtcTime(dateTo, zone) : undefined; if (from && to && to < from) throw new Error('Khoảng thời gian bị đảo ngược.'); openReview(false); setItem(undefined); setError(''); setQuery({ datasetId, from, to, analysisRunId: draft.run || undefined, family: (draft.family || undefined) as AnomaliesQuery['family'], method: draft.method || undefined, severity: (draft.severity || undefined) as AnomaliesQuery['severity'], status: (draft.status || undefined) as AnomaliesQuery['status'], sort: draft.sort as AnomaliesQuery['sort'], limit: 100 }); listRef.current?.scrollTo(0, 0); } catch (e) { setError((e as Error).message); } }}>
      <Field label="Analysis run ID" value={draft.run} placeholder="Tất cả run" onChange={e => setDraft({ ...draft, run: e.target.value })} /><Field label="Method" value={draft.method} placeholder="Tất cả phương pháp" onChange={e => setDraft({ ...draft, method: e.target.value })} />
      {(['family', 'severity', 'status', 'sort'] as const).map(field => <label className="field" key={field}>{({ family: 'Nhóm phương pháp', severity: 'Metadata severity', status: 'Trạng thái review', sort: 'Thứ tự thời gian' })[field]}<select aria-label={field} value={draft[field]} onChange={e => setDraft({ ...draft, [field]: e.target.value })}>{(field === 'family' ? ['', 'statistical', 'ml'] : field === 'severity' ? ['', 'low', 'medium', 'high'] : field === 'status' ? ['', 'open', 'confirmed', 'false_positive'] : ['ts:asc', 'ts:desc']).map(v => <option key={v} value={v}>{v || 'Tất cả'}</option>)}</select></label>)}
      <Field label={`Anomalies từ · ${zoneLabel(zone)}`} type="datetime-local" step="1" value={dateFrom ?? (query.from ? explorationLocalTime(query.from, zone) : '')} onChange={e => setFrom(e.target.value)} /><Field label={`Anomalies đến · ${zoneLabel(zone)}`} type="datetime-local" step="1" value={dateTo ?? (query.to ? explorationLocalTime(query.to, zone) : '')} onChange={e => setTo(e.target.value)} /><Button type="submit">Lọc anomalies</Button><p className="ux-filter-help">{query.analysisRunId ? `Run đang xem ${shortId(query.analysisRunId)}.` : 'Đang xem nhiều run; score của các phương pháp không so sánh trực tiếp.'} API không lọc theo trạm/bbox. Severity không phải nồng độ hoặc mức sức khỏe.</p>
    </form></details>
    <div className={`ux-anomaly-layout ${item ? 'has-selection' : ''} ${reviewOpen ? 'is-review' : ''}`}><section className="ux-panel ux-list-panel"><div className="ux-panel-heading"><div><h3>Danh sách phát hiện</h3><p>{state.data.length} mục đã tải{state.nextCursor ? (local.offline ? ' · Còn trang đã lưu' : ' · Còn dữ liệu trên Server') : state.status === 'ready' ? (local.offline ? ' · Kết quả đã lưu' : ' · Đã hết trang trong phạm vi') : ''}</p></div></div>
      {state.status === 'loading' && <LoadingState />}{state.status === 'error' && <ErrorState message={errorMessage(state.error)} retry={() => { runClientTask(pager.retry()); }} />}{state.status === 'ready' && !rows.length && !state.nextCursor && <p>Không có anomalies phù hợp bộ lọc.</p>}
      <div ref={listRef} className="ux-list-scroll" tabIndex={0} role="region" aria-label="Bảng anomalies"><table className="ux-data-table"><thead><tr><th>Trạm</th><th>Thời gian</th><th>Score</th><th>Review</th><th>Tác vụ</th></tr></thead><tbody>{rows.map(a => <tr key={a.id} aria-selected={a.id === item?.id}><td data-label="Trạm"><strong>{sensorName(a.sensorId, sensors.data)}</strong><small>{methodName(a.method)}</small></td><td data-label="Thời gian">{formatWorkspaceTime(a.ts, zone)} · {zoneLabel(zone)}</td><td data-label={scoreLabel(a.method)}>{number(a.score, 4)}<small>{scoreLabel(a.method)}</small></td><td data-label="Review"><StatusBadge value={a.status} /></td><td data-label="Tác vụ"><Button variant="secondary" aria-label={`Review ${a.id}`} disabled={loading} onClick={() => { runClientTask(select(a.id)); }}>Xem chi tiết</Button></td></tr>)}</tbody></table></div>
      {state.nextCursor && <Button variant="secondary" disabled={state.status === 'loading' || state.data.length >= 2000} onClick={() => { runClientTask(pager.loadMore()); }}>Tải thêm anomalies</Button>}{state.data.length >= 2000 && state.nextCursor && <p className="ux-warning">Phần kết quả chưa tải hết; đã đạt ngân sách 2.000 anomalies.</p>}
    </section><aside className="ux-anomaly-inspector" aria-label="Điều tra phát hiện">
      {loading && <LoadingState label="Đang đọc chi tiết anomaly…" />}{error && <p role="alert" className="ux-warning">{error}</p>}
      {item ? <><section className="ux-panel"><div className="ux-panel-heading"><div><h3>{sensorName(item.sensorId, sensors.data)}</h3><p>{formatWorkspaceTime(item.ts, zone)} · {zoneLabel(zone)}</p></div><StatusBadge value={item.status} /></div>
        {active && <AnomalyReading key={`${item.id}/${item.version}`} item={item} />}
        <dl className="ux-detail-grid"><div><dt>Phương pháp</dt><dd>{methodName(item.method)}</dd></div><div><dt>{scoreLabel(item.method)}</dt><dd>{number(item.score, 4)}</dd></div><div><dt>Tọa độ lon / lat</dt><dd>{item.location.coordinates.join(', ')}</dd></div><div><dt>Metadata severity</dt><dd>{item.severity}</dd></div></dl>
        <p className="ux-notice">Đây là cảnh báo thuật toán; chưa chứng minh nguyên nhân ô nhiễm hay lỗi cảm biến.</p><div className="ux-stack-actions"><Button onClick={() => investigate('cube')}>Điều tra trên Cube</Button><Button variant="secondary" onClick={() => investigate('map')}>Xem trên Mapbox</Button><Button variant="secondary" aria-expanded={reviewOpen} onClick={() => openReview(true)}>Đánh giá phát hiện</Button></div>
        <details><summary>Chi tiết kỹ thuật</summary><TechnicalId label="Anomaly ID" id={item.id} /><TechnicalId label="Reading ID" id={item.readingId} /><TechnicalId label="Run ID" id={item.analysisRunId} /><p>Version {item.version}</p></details>
      </section>{reviewOpen && active && <AnomalyReview key={item.id} item={item} saved={saved} />}<Button variant="secondary" onClick={() => { if (discard()) { openReview(false); setItem(undefined); } }}>Về danh sách anomalies</Button></> : <section className="ux-panel ux-inspector-empty"><h3>Điều tra một phát hiện</h3><p>Chọn “Xem chi tiết” để đối chiếu reading thực đo, mở Cube/Mapbox hoặc ghi nhận đánh giá.</p></section>}
    </aside></div>
  </section>;
}
