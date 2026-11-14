import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useServices } from '../../app/services';
import { Button, ErrorState, LoadingState } from '../../shared/ui/primitives';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
import type { AnalysisRun, DetectionRequest } from '../../shared/api/generated/wire';
import type { WorkspaceFilters } from '../workspace/state';
import { followRun } from './follow-run';
import { canReplay, readIntent, type Intent } from './intent';
import { AnalysisResults } from './results';

function RunDetail({ datasetId, id }: { datasetId: string; id: string }) {
  const { data, workspace } = useServices();
  const [run, setRun] = useState<AnalysisRun>();
  const [error, setError] = useState('');
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
  return <section><h3>Run đang xem: {id}</h3>{error && <p role="alert">Chưa cập nhật được trạng thái. {error} Trạng thái đã đọc trước đó được giữ nguyên.</p>}<Button variant="secondary" onClick={() => { void follower.current?.refresh(); }}>Đọc lại run</Button>{!run && !error && <LoadingState />}{run && <><p data-testid="run-status">Trạng thái Server: {run.status}</p><p>{run.family} / {run.method} · Tạo: {run.createdAt}{run.completedAt && ` · Kết thúc: ${run.completedAt}`}</p><p>Engine: {run.engineVersion ?? 'Chưa có'} · Model: {run.modelVersion ?? 'Chưa có'}</p><p>Scope đã tiếp nhận: {JSON.stringify(run.scope)}</p><p>Config đã tiếp nhận: {JSON.stringify(run.config)}</p>{run.status === 'failed' && <p role="alert">Phân tích thất bại: {run.error?.code} — {run.error?.message}</p>}{run.status === 'queued' && <p>Đã tiếp nhận, chờ thực thi. Bạn vẫn có thể tra cứu và xem dữ liệu.</p>}{run.status === 'running' && <p>Server đang phân tích. Rời màn hình không hủy job.</p>}{run.status === 'completed' && <AnalysisResults key={run.id} run={run} />}</>}</section>;
}
export function AnalysisPage({ datasetId, filters, runId, selectRun }: { datasetId: string; filters: WorkspaceFilters; runId?: string; selectRun: (id?: string) => void }) {
  const { data, config, session, workspace } = useServices();
  const storageKey = `pm25.analysis.${config.mode}.${session.store.getState().user?.id}.${datasetId}`;
  const [intent, setIntent] = useState(() => readIntent(sessionStorage, storageKey));
  const corrupt = !intent && sessionStorage.getItem(storageKey) !== null;
  const [confirmed, setConfirmed] = useState(false);
  const [method, setMethod] = useState<'zscore' | 'iqr' | 'ml'>(() => intent?.body.method === 'iqr' ? 'iqr' : intent?.body.family === 'ml' ? 'ml' : 'zscore');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | undefined>(undefined);
  const [historyRevision, refreshHistory] = useState(0);
  const [sort, setSort] = useState<'createdAt:asc' | 'createdAt:desc'>('createdAt:desc');
  const history = useMemo(() => createCursorPager(data.analysis.list), [data]);
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useEffect(() => { void history.setQuery({ datasetId, sort, limit: 100 }); return () => history.dispose(); }, [history, datasetId, sort, historyRevision]);
  useEffect(() => () => active.current?.abort(), []);
  const body: DetectionRequest = { datasetId, family: method === 'ml' ? 'ml' : 'statistical', method: method === 'ml' ? 'isolation_forest' : method, config: method === 'zscore' ? { threshold: 3 } : method === 'iqr' ? { multiplier: 1.5 } : {}, scope: { ...(filters.sensorId ? { sensorIds: [filters.sensorId] } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) } };
  const demo = config.mode === 'mock';
  async function send() {
    if (active.current || filters.bbox || corrupt) return;
    let current = intent;
    if (current?.runId) return;
    if (current && !canReplay(current, demo ? 15 * 60_000 : undefined)) { setError('Không còn cửa sổ replay đã xác nhận. Cần đối soát Backend, không tạo run thay thế.'); return; }
    if (!current) { if (!confirmed) return; current = { key: crypto.randomUUID(), body: structuredClone(body), createdAt: Date.now() }; }
    const controller = new AbortController(); active.current = controller; setPending(true); setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(current)); setIntent(current);
      const response = await data.analysis.create(current.body, { idempotencyKey: current.key, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted) return;
      if (response.data.datasetId !== datasetId) throw new Error('Dataset không khớp response.');
      const accepted: Intent = { ...current, runId: response.data.id };
      setIntent(accepted); refreshHistory(value => value + 1); selectRun(response.data.id); sessionStorage.setItem(storageKey, JSON.stringify(accepted));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof DataSourceError ? `${errorMessage(cause)} ${cause.error ? `${cause.error.code}: ${cause.error.message}` : ''} Chưa có ID tiếp nhận xác nhận; giữ nguyên key/payload khi thử lại.` : 'Không thể xác nhận/lưu ngữ cảnh tiếp nhận. Kiểm tra lịch sử; không tạo run thay thế.');
    } finally { if (!controller.signal.aborted) { active.current = undefined; setPending(false); } }
  }
  return <section className="card analysis-page"><h2>Analysis online</h2><p>{demo ? 'DEMO: dữ liệu/lifecycle mô phỏng, không chạy detector thật; run demo mới nằm trong RAM và mất khi reload.' : 'Z-score và IQR dùng cấu hình cố định đã duyệt. Server kiểm tra điều kiện dữ liệu; FE không tự suy ra lỗi/đủ mẫu. Isolation Forest dùng model PM2.5 do Server quản lý, config {} và feature value (ug/m3).'}</p>{method === 'ml' && <p>Baseline chỉ phát hiện bất thường về giá trị PM2.5 theo phân bố tham chiếu; chất lượng trên dữ liệu dự án còn cần đánh giá. Severity low hiện là nhãn tạm.</p>}<p>Phạm vi dự kiến: {JSON.stringify(body.scope)} · Toàn bộ readings Server trong scope, không chỉ điểm đang render.</p>{filters.bbox && <p role="alert">Chưa chốt chuyển bbox sang scope. Chọn trạm/thời gian rõ ràng và bỏ bbox trước khi gửi.</p>}<label className="field">Phương pháp<select aria-label="Phương pháp" disabled={pending || Boolean(intent)} value={method} onChange={e => { setMethod(e.target.value as typeof method); setConfirmed(false); }}><option value="zscore">Z-score</option><option value="iqr">IQR</option><option value="ml">Isolation Forest</option></select></label><p>Method/config: {body.method} {JSON.stringify(body.config)}</p><label><input type="checkbox" checked={confirmed} disabled={pending || Boolean(intent)} onChange={e => setConfirmed(e.target.checked)} /> Tôi xác nhận phạm vi và cấu hình hiển thị.</label>{intent && <p>Ý định đã lưu: {intent.key} · Payload bất biến: {JSON.stringify(intent.body)}{intent.runId && ` · Run: ${intent.runId}`}</p>}{intent && !intent.runId && !canReplay(intent, demo ? 900000 : undefined) && <p role="alert">Chưa có replay window hợp lệ hoặc đã hết hạn. Cần đối soát Backend trước khi gửi lại.</p>}{corrupt && <p role="alert">Ngữ cảnh chờ tiếp nhận không hợp lệ. Cần đối soát Backend trước khi tạo thao tác mới.</p>}<Button disabled={pending || Boolean(filters.bbox) || corrupt || Boolean(intent?.runId) || (!intent && !confirmed) || Boolean(intent && !canReplay(intent, demo ? 900000 : undefined))} onClick={() => { void send(); }}>{pending ? 'Đang gửi…' : intent ? 'Thử lại cùng key' : 'Gửi analysis'}</Button>{intent?.runId && <><Button variant="secondary" onClick={() => selectRun(intent.runId)}>Theo dõi run đã tiếp nhận</Button><Button variant="secondary" onClick={() => { if (window.confirm('Tạo ý định phân tích mới? Run cũ vẫn được giữ trên Server.')) { sessionStorage.removeItem(storageKey); setIntent(undefined); setConfirmed(false); selectRun(undefined); workspace.getState().setResults(); } }}>Chuẩn bị lần chạy mới</Button></>}{error && <p role="alert">{error}</p>}<h3>Lịch sử AnalysisRun</h3><Button variant="secondary" onClick={() => refreshHistory(value => value + 1)}>Làm mới lịch sử</Button><label className="field">Thứ tự lịch sử<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="createdAt:desc">Mới nhất</option><option value="createdAt:asc">Cũ nhất</option></select></label>{state.status === 'loading' && <LoadingState />}{state.status === 'error' && <ErrorState message={errorMessage(state.error)} retry={() => { void history.retry(); }} />}{state.status === 'ready' && !state.data.length && <p>Chưa có run trong trang lịch sử.</p>}<div className="table-scroll"><table><thead><tr><th>Run</th><th>Phương pháp</th><th>Trạng thái</th><th>Ngày tạo</th><th>Theo dõi</th></tr></thead><tbody>{state.data.map(run => <tr key={run.id}><td>{run.id}</td><td>{run.family} / {run.method}</td><td>{run.status}</td><td>{run.createdAt}</td><td><Button onClick={() => { workspace.getState().setResults(); selectRun(run.id); }}>Xem run {run.id}</Button></td></tr>)}</tbody></table></div><p>Đã tải {state.data.length} runs{state.nextCursor ? ' · Còn trang' : ''}</p>{state.nextCursor && <Button disabled={state.status === 'loading' || state.data.length >= 2000} onClick={() => { void history.loadMore(); }}>Tải thêm lịch sử</Button>}{runId && <RunDetail key={`${datasetId}/${runId}`} datasetId={datasetId} id={runId} />}</section>;
}
