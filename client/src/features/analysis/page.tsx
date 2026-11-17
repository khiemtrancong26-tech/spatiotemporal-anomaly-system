import { useStore } from 'zustand';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { explorationUtcTime } from '@pm25/shared-core';
import { useServices } from '../../app/services';
import { StatusBadge, Button, ErrorState, LoadingState, Field } from '../../shared/ui/primitives';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
import type { AnalysisRun, DatasetProfile, DetectionRequest } from '../../shared/api/generated/wire';
import type { WorkspaceFilters } from '../workspace/state';
import { formatWorkspaceTime, explorationLocalTime, zoneLabel } from '../workspace/time';
import { METHODS, methodName, number, runScope, scopeFromFilters, scopeKey, shortId, type AnalysisScope, type Method } from '../workspace/analyst';
import { ScopeText, TechnicalId, useAnalystSensors } from '../workspace/analyst-ui';
import { followRun } from './follow-run';
import { ANALYSIS_REPLAY_MS, canReplay, readIntent, type Intent } from './intent';
import { AnalysisResults } from './results';

function RunDetail({ datasetId, id }: { datasetId: string; id: string }) {
  const { data, workspace } = useServices(), zone = useStore(workspace, s => s.timeZone);
  const sensors = useAnalystSensors(datasetId);
  const [run, setRun] = useState<AnalysisRun>(), [error, setError] = useState('');
  const follower = useRef<ReturnType<typeof followRun> | undefined>(undefined);
  useEffect(() => {
    workspace.getState().setResults();
    const active = followRun({ interval: 3000, maxBackoff: 30000, visible: () => !document.hidden,
      load: async signal => { const result = await data.analysis.get(id, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }); if (result.id !== id || result.datasetId !== datasetId) throw new Error('Run không thuộc dataset/ID đang xem.'); return result; },
      update: result => { setRun(result); setError(''); }, error: cause => setError(cause instanceof DataSourceError ? errorMessage(cause) : 'Không thể xác nhận run thuộc dataset này.'),
    });
    follower.current = active;
    const visibility = () => { if (!document.hidden) void active.refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { active.dispose(); document.removeEventListener('visibilitychange', visibility); };
  }, [data, datasetId, id, workspace]);
  return <section className="ux-panel ux-run-detail"><div className="ux-panel-heading"><div><h3>Lần phân tích {shortId(id)}</h3><p>Phạm vi run đã lưu độc lập với bộ lọc đang tra cứu.</p></div><Button variant="secondary" onClick={() => { void follower.current?.refresh(); }}>Đọc lại run</Button></div>
    {error && <p role="alert" className="ux-warning">Chưa cập nhật được trạng thái. {error} Trạng thái đã đọc trước đó được giữ nguyên.</p>}{!run && !error && <LoadingState />}
    {run && <><div className="ux-run-summary"><div><span>PHƯƠNG PHÁP</span><strong>{methodName(run.method)}</strong></div><div><span>TRẠNG THÁI SERVER</span><p data-testid="run-status"><StatusBadge value={run.status} /></p></div><div><span>PHẠM VI ĐÃ TIẾP NHẬN</span><ScopeText scope={runScope(run)} sensors={sensors.data} zone={zone} /></div></div>
      <p>Tạo: {formatWorkspaceTime(run.createdAt, zone)} · {zoneLabel(zone)}{run.completedAt && ` · Kết thúc: ${formatWorkspaceTime(run.completedAt, zone)}`}</p>
      {run.status === 'failed' && <p role="alert" className="ux-warning">Lần phân tích không hoàn tất: {run.error?.code} — {run.error?.message}. Chỉnh phạm vi/phương pháp và chuẩn bị lần chạy mới nếu muốn tiếp tục.</p>}
      {run.status === 'queued' && <p className="ux-notice">Server đã tiếp nhận và đang chờ thực thi. Bạn vẫn có thể khám phá dữ liệu.</p>}{run.status === 'running' && <p className="ux-notice">Server đang phân tích; rời trang không hủy job.</p>}
      {run.scoringSummary && <p className="ux-warning" data-testid="scoring-summary">Đã chấm {run.scoringSummary.scoredCount}/{run.scoringSummary.targetCount} targets · chưa chấm {run.scoringSummary.unscorableCount}. Thiếu temporal: {run.scoringSummary.reasons.temporalOnly}; thiếu spatial: {run.scoringSummary.reasons.spatialOnly}; thiếu cả hai: {run.scoringSummary.reasons.both}. Các nhóm không đếm trùng; target chưa chấm không được coi là normal.</p>}
      <details><summary>Nguồn & chi tiết kỹ thuật của run</summary><TechnicalId label="Run ID" id={run.id} /><p>Engine: {run.engineVersion ?? 'Chưa có'} · Model: {run.modelVersion ?? 'Chưa có'}</p><pre>{JSON.stringify({ scope: run.scope, config: run.config }, null, 2)}</pre></details>
      {run.status === 'completed' && <AnalysisResults key={run.id} run={run} />}</>}
  </section>;
}

export function AnalysisPage({ datasetId, filters, runId, selectRun, active: visible = true }: { datasetId: string; filters: WorkspaceFilters; runId?: string; selectRun: (id?: string) => void; active?: boolean }) {
  const { data, config, session, workspace, datasets } = useServices(), zone = useStore(workspace, s => s.timeZone);
  const prepared = useStore(workspace, s => s.analysisDraft), sensors = useAnalystSensors(datasetId);
  const storageKey = `pm25.analysis.${config.mode}.${session.store.getState().user?.id}.${datasetId}`;
  const [intent, setIntent] = useState(() => { const value = readIntent(sessionStorage, storageKey); return value?.body.datasetId === datasetId ? value : undefined; });
  const corrupt = !intent && sessionStorage.getItem(storageKey) !== null;
  const [scope, setScope] = useState<AnalysisScope>(() => prepared?.scope ?? scopeFromFilters(filters));
  const [scopeOpen, openScope] = useState(false), [bboxResolved, resolveBbox] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [method, setMethod] = useState<Method>(() => intent?.body.method as Method || 'zscore');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [dateFrom, setFrom] = useState<string>(), [dateTo, setTo] = useState<string>();
  const [profile, setProfile] = useState<DatasetProfile>(), [profileError, setProfileError] = useState(''), [profilePending, profileLoading] = useState(false);
  const active = useRef<AbortController | undefined>(undefined), lastPrepared = useRef(prepared?.revision);
  const filterSignature = JSON.stringify(filters), lastFilters = useRef(filterSignature);
  const [historyRevision, refreshHistory] = useState(0), [sort, setSort] = useState<'createdAt:asc' | 'createdAt:desc'>('createdAt:desc');
  const history = useMemo(() => createCursorPager(data.analysis.list), [data]);
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useEffect(() => { if (visible) void history.setQuery({ datasetId, sort, limit: 100 }); }, [history, datasetId, sort, historyRevision, visible]);
  useEffect(() => () => { active.current?.abort(); history.dispose(); }, [history]);
  useEffect(() => {
    if (!visible) return;
    if (prepared && prepared.revision !== lastPrepared.current) { setScope(prepared.scope); setFrom(undefined); setTo(undefined); lastPrepared.current = prepared.revision; setConfirmed(false); resolveBbox(false); }
    else if (filterSignature !== lastFilters.current && !intent) { setScope(scopeFromFilters(filters)); setFrom(undefined); setTo(undefined); setConfirmed(false); resolveBbox(false); }
    lastFilters.current = filterSignature;
  }, [prepared, visible, filterSignature, filters, intent]);
  useEffect(() => { setFrom(undefined); setTo(undefined); }, [zone]);
  const spec = METHODS[method] ?? METHODS.zscore;
  const body: DetectionRequest = useMemo(() => ({ datasetId, family: spec.family, method, config: { ...spec.config }, scope }), [datasetId, spec, method, scope]);
  const submittedScope = intent?.body.scope ?? scope;
  useEffect(() => {
    setProfile(undefined); setProfileError('');
    if (!visible) return;
    const controller = new AbortController(); profileLoading(true);
    void data.datasets.profile(datasetId, { sensorIds: submittedScope.sensorIds, from: submittedScope.from, to: submittedScope.to }, { signal: controller.signal }).then(p => { if (controller.signal.aborted) return; if (p.datasetId !== datasetId || scopeKey({sensorIds:p.scope.sensorIds ?? undefined,from:p.scope.from ?? undefined,to:p.scope.to ?? undefined}) !== scopeKey(submittedScope)) throw new Error('Profile không khớp scope Analysis.'); setProfile(p); }).catch(e => { if (!controller.signal.aborted) setProfileError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) profileLoading(false); });
    return () => controller.abort();
  }, [data, datasetId, submittedScope, visible]);
  const replayWindow = config.mode === 'mock' ? 15 * 60_000 : ANALYSIS_REPLAY_MS;
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!intent || intent.runId || !visible) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [intent, visible]);
  const replayable = intent ? canReplay(intent, replayWindow, now) : true;
  const overLimit = !intent && profile !== undefined && profile.scoped.readingCount > 50000;
  const bboxBlocked = Boolean(filters.bbox) && !(bboxResolved && scope.sensorIds?.length);
  function changeScope(next: AnalysisScope) { setScope(next); setConfirmed(false); resolveBbox(false); }
  async function send() {
    if (active.current || corrupt || (!intent && (bboxBlocked || overLimit || scope.sensorIds?.length === 0))) return;
    let current = intent;
    if (current?.runId) return;
    if (current && !canReplay(current, replayWindow)) { setError('Cửa sổ replay đã hết hạn. Đối soát lịch sử; không tạo run thay thế bằng key mới.'); return; }
    if (!current) { if (!confirmed) return; current = { key: crypto.randomUUID(), body: structuredClone(body), createdAt: Date.now() }; }
    const controller = new AbortController(); active.current = controller; setPending(true); setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(current)); setIntent(current);
      const response = await data.analysis.create(current.body, { idempotencyKey: current.key, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted) return;
      if (response.data.datasetId !== datasetId || response.data.status !== 'queued') throw new Error('Response tiếp nhận không khớp dataset/trạng thái queued.');
      const accepted: Intent = { ...current, runId: response.data.id };
      setIntent(accepted); history.dispose(); refreshHistory(value => value + 1); selectRun(response.data.id); sessionStorage.setItem(storageKey, JSON.stringify(accepted));
    } catch (cause) { if (!controller.signal.aborted) setError(`${cause instanceof DataSourceError ? errorMessage(cause) : 'Không thể xác nhận/lưu ngữ cảnh tiếp nhận.'} Chưa có ID tiếp nhận xác nhận; giữ nguyên key và payload. Đối soát lịch sử hoặc chủ động thử lại cùng key trong cửa sổ replay.`); }
    finally { if (!controller.signal.aborted) { active.current = undefined; setPending(false); } }
  }
  return <section className="analyst-ux ux-analysis"><header className="ux-page-heading"><div><p className="ux-eyebrow">02 · CHẠY PHÁT HIỆN BẤT THƯỜNG</p><h2>Tạo một lần phân tích</h2><p>Chọn rõ dữ liệu và phương pháp. Server xử lý toàn bộ scope đã xác nhận.</p></div><span className="badge">{intent?.runId ? 'Đã tiếp nhận' : pending ? 'Đang gửi yêu cầu' : intent ? 'Chưa xác nhận tiếp nhận' : 'Chưa gửi run'}</span></header>
    {config.mode === 'mock' && <p className="ux-notice">DEMO: dữ liệu/lifecycle mô phỏng, không chạy detector thật; run demo mới nằm trong RAM và mất khi reload.</p>}
    <div className="ux-analysis-grid"><section className="ux-panel"><h3><span className="ux-step">1</span>Phạm vi phân tích</h3><p>{datasets.get(datasetId)?.name ?? datasetId}</p><div className="ux-scope-summary"><ScopeText scope={submittedScope} sensors={sensors.data} zone={zone} /></div><p>{intent ? 'Snapshot của thao tác đã lưu; bộ lọc mới không thay đổi payload này.' : prepared?.source ?? 'Phạm vi workspace hiện tại'}</p>
      <div className="ux-limit"><span>Readings trong scope</span><strong>{profilePending ? 'Đang kiểm tra…' : profile ? number(profile.scoped.readingCount, 0) : 'Chưa xác nhận'}</strong><span>Giới hạn Backend: 50.000 readings / run</span>{profile && <meter min="0" max="50000" value={Math.min(profile.scoped.readingCount, 50000)} aria-label="Readings so với giới hạn Analysis" />}<small>{profile ? profile.scoped.readingCount > 50000 ? 'Vượt giới hạn; thu hẹp thời gian hoặc số trạm.' : 'Trong giới hạn dự kiến; Backend vẫn kiểm tra độc lập.' : 'Profile chưa xác nhận count; Backend vẫn là nguồn kiểm tra cuối cùng.'}</small></div>
      {profileError && <p className="ux-warning">Chưa xác nhận số readings: {profileError}</p>}{overLimit && <p role="alert" className="ux-warning">Phạm vi có nhiều hơn 50.000 readings. Thu hẹp thời gian hoặc số trạm.</p>}
      <Button variant="secondary" disabled={Boolean(intent) || pending} aria-expanded={scopeOpen} onClick={() => openScope(v => !v)}>Chỉnh phạm vi Analysis</Button>
      {scopeOpen && <div className="ux-scope-editor"><label className="ux-check"><input type="checkbox" checked={!scope.sensorIds} disabled={Boolean(intent)} onChange={e => changeScope({ ...scope, sensorIds: e.target.checked ? undefined : [] })} />Tất cả trạm</label>{scope.sensorIds && <fieldset className="ux-sensor-options"><legend>Chọn rõ trạm trong scope</legend>{sensors.data.map(s => <label key={s.id}><input type="checkbox" disabled={Boolean(intent)} checked={scope.sensorIds?.includes(s.id) ?? false} onChange={e => changeScope({ ...scope, sensorIds: e.target.checked ? [...(scope.sensorIds ?? []), s.id] : scope.sensorIds?.filter(id => id !== s.id) })} />{s.name}</label>)}</fieldset>}{sensors.nextCursor && <Button variant="secondary" onClick={sensors.more}>Tải thêm trạm Analysis</Button>}
        <form onSubmit={e => { e.preventDefault(); try { const from = dateFrom ?? (scope.from ? explorationLocalTime(scope.from, zone) : ''), to = dateTo ?? (scope.to ? explorationLocalTime(scope.to, zone) : ''); const next = { ...scope, from: from ? explorationUtcTime(from, zone) : undefined, to: to ? explorationUtcTime(to, zone) : undefined }; if (next.from && next.to && next.to < next.from) throw new Error('Khoảng thời gian bị đảo ngược.'); changeScope(next); setError(''); } catch (e) { setError((e as Error).message); } }}><Field label={`Analysis từ · ${zoneLabel(zone)}`} type="datetime-local" step="1" value={dateFrom ?? (scope.from ? explorationLocalTime(scope.from, zone) : '')} onChange={e => setFrom(e.target.value)} /><Field label={`Analysis đến · ${zoneLabel(zone)}`} type="datetime-local" step="1" value={dateTo ?? (scope.to ? explorationLocalTime(scope.to, zone) : '')} onChange={e => setTo(e.target.value)} /><Button type="submit">Áp dụng thời gian Analysis</Button></form>
      </div>}
      {filters.bbox && !intent && <div className="ux-warning"><p>Analysis không nhận bbox. Chọn rõ các trạm muốn phân tích trước khi chạy.</p><Button variant="secondary" disabled={!scope.sensorIds?.length} onClick={() => { resolveBbox(true); setConfirmed(false); }}>Dùng các trạm đã chọn, bỏ bbox khỏi Analysis</Button>{bboxResolved && <p>Đã xác nhận scope trạm; bbox không được gửi trong body.</p>}</div>}
    </section><section className="ux-panel"><h3><span className="ux-step">2</span>Chọn phương pháp</h3><fieldset className="ux-methods"><legend className="sr-only">Phương pháp</legend>{(Object.keys(METHODS) as Method[]).map(id => <label key={id} className={`ux-method ${method === id ? 'is-selected' : ''}`}><input type="radio" name="detector-method" value={id} checked={method === id} disabled={pending || Boolean(intent)} onChange={() => { setMethod(id); setConfirmed(false); }} /><span><strong>{METHODS[id].name}</strong><p>{METHODS[id].description}</p><small>{METHODS[id].setting}</small></span></label>)}</fieldset>{method === 'isolation_forest' && <p className="ux-warning">Score không phải xác suất. Severity low là metadata tạm, không phải mức ô nhiễm hoặc mức nguy hiểm sức khỏe.</p>}</section>
    <section className="ux-panel"><h3><span className="ux-step">3</span>Xác nhận và chạy</h3><p>Tạo một Analysis Run mới.</p><p>Queued → Running → Completed / Failed</p><p>Kết quả lưu trên Server, có thể xem lại từ lịch sử.</p><label className="ux-confirm"><input type="checkbox" checked={confirmed} disabled={pending || Boolean(intent)} onChange={e => setConfirmed(e.target.checked)} />Tôi đã kiểm tra phạm vi và phương pháp phân tích.</label><Button className="ux-wide" disabled={pending || corrupt || Boolean(intent?.runId) || (!intent && (!confirmed || bboxBlocked || overLimit || scope.sensorIds?.length === 0)) || !replayable} onClick={() => { void send(); }}>{pending ? 'Đang gửi…' : intent ? 'Thử lại cùng key' : 'Chạy phát hiện bất thường'}</Button><p>Chỉ 202 xác nhận tiếp nhận job. Mất phản hồi không có nghĩa Server chưa nhận; không tạo key mới.</p>
      {intent && !intent.runId && !replayable && <p role="alert">Cửa sổ replay đã hết hạn. Đối soát Backend trước khi tiếp tục.</p>}{corrupt && <p role="alert">Ngữ cảnh chờ tiếp nhận không hợp lệ. Đối soát Backend trước khi tạo thao tác mới.</p>}
      {intent?.runId && <div className="ux-actions"><Button variant="secondary" onClick={() => selectRun(intent.runId)}>Theo dõi run đã tiếp nhận</Button><Button variant="secondary" onClick={() => { if (window.confirm('Tạo ý định phân tích mới? Run cũ vẫn giữ trên Server.')) { sessionStorage.removeItem(storageKey); setIntent(undefined); setConfirmed(false); selectRun(undefined); workspace.getState().setResults(); } }}>Chuẩn bị lần chạy mới</Button></div>}
      {intent && <details><summary>Thông tin thao tác đã gửi</summary><TechnicalId label="Idempotency key" id={intent.key} /><p>Gửi lúc {formatWorkspaceTime(new Date(intent.createdAt).toISOString(), zone)} · {zoneLabel(zone)} · cửa sổ replay {config.mode === 'mock' ? '15 phút (demo)' : '24 giờ'}.</p><pre>{JSON.stringify(intent.body, null, 2)}</pre></details>}
    </section></div>{error && <p role="alert" className="ux-warning">{error}</p>}
    {runId && visible && <RunDetail key={`${datasetId}/${runId}`} datasetId={datasetId} id={runId} />}
    <section className="ux-panel"><div className="ux-panel-heading"><div><h3>Lịch sử phân tích</h3><p>Mỗi dòng là một lần chạy độc lập; xem lại không chạy thuật toán lần nữa.</p></div><Button variant="secondary" onClick={() => { history.dispose(); refreshHistory(n => n + 1); }}>Làm mới lịch sử</Button></div><label className="field ux-inline-field">Thứ tự lịch sử<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="createdAt:desc">Mới nhất</option><option value="createdAt:asc">Cũ nhất</option></select></label>
      {state.status === 'loading' && <LoadingState />}{state.status === 'error' && <ErrorState message={errorMessage(state.error)} retry={() => { void history.retry(); }} />}{state.status === 'ready' && !state.data.length && <p>Chưa có run trong trang lịch sử.</p>}
      <div className="ux-list-scroll" tabIndex={0} role="region" aria-label="Lịch sử analysis"><table className="ux-responsive-table"><thead><tr><th>Phương pháp</th><th>Phạm vi</th><th>Tạo lúc</th><th>Trạng thái</th><th>Tác vụ</th></tr></thead><tbody>{state.data.map(run => <tr key={run.id}><td data-label="Phương pháp"><strong>{methodName(run.method)}</strong><small>Run {shortId(run.id)}</small></td><td data-label="Phạm vi"><ScopeText scope={runScope(run)} sensors={sensors.data} zone={zone} /></td><td data-label="Tạo lúc">{formatWorkspaceTime(run.createdAt, zone)} · {zoneLabel(zone)}</td><td data-label="Trạng thái"><StatusBadge value={run.status} /></td><td data-label="Tác vụ"><Button variant="secondary" aria-label={`Xem run ${run.id}`} onClick={() => { workspace.getState().setResults(); selectRun(run.id); }}>{run.status === 'completed' ? 'Xem kết quả' : 'Theo dõi'}</Button></td></tr>)}</tbody></table></div><p>Đã tải {state.data.length} runs{state.nextCursor ? ' · Còn trang' : ''}</p>{state.nextCursor && <Button variant="secondary" disabled={state.status === 'loading' || state.data.length >= 2000} onClick={() => { void history.loadMore(); }}>Tải thêm lịch sử</Button>}
    </section>
  </section>;
}
