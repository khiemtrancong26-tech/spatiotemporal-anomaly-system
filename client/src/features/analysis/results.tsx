import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { AnalysisRun } from '../../shared/api/generated/wire';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { Button, ErrorState, LoadingState, StatusBadge } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import { formatWorkspaceTime, zoneLabel } from '../workspace/time';
import { methodName, number, scoreLabel, sensorName } from '../workspace/analyst';
import { useAnalystSensors } from '../workspace/analyst-ui';
export function AnalysisResults({ run }: { run: AnalysisRun }) {
  const { data, workspace } = useServices(), zone = useStore(workspace, s => s.timeZone), sensors = useAnalystSensors(run.datasetId);
  const pager = useMemo(() => createCursorPager(data.anomalies.list), [data]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => { if (run.status === 'completed') void pager.setQuery({ datasetId: run.datasetId, analysisRunId: run.id, sort: 'ts:asc', limit: 100 }); return () => pager.dispose(); }, [pager, run.id, run.datasetId, run.status]);
  useEffect(() => { if (run.status === 'completed') workspace.getState().setResults(run, state.data); }, [workspace, run, state.data]);
  if (run.status !== 'completed') return null;
  return <section className="ux-results"><div className="ux-panel-heading"><div><h3>Các điểm được detector đánh dấu</h3><p>{methodName(run.method)} · {scoreLabel(run.method)}; không phải xác suất hay mức sức khỏe.</p></div><Button variant="secondary" onClick={() => workspace.getState().openAnomalies(run.id)}>Mở Anomalies</Button></div>
    <p className="ux-notice">Điểm bị đánh dấu là gợi ý cần điều tra. Review là đánh giá của Analyst, chưa xác nhận nguyên nhân hoặc lỗi cảm biến.</p>
    {state.status === 'loading' && <LoadingState label="Đang tải kết quả của run…" />}{state.status === 'error' && <ErrorState message={`Run đã hoàn tất nhưng chưa tải được danh sách. ${errorMessage(state.error)}`} retry={() => { void pager.retry(); }} />}
    {state.status === 'ready' && !state.data.length && !state.nextCursor && <p>{run.scoringSummary ? `Không phát hiện anomaly trong ${run.scoringSummary.scoredCount} targets đã chấm. ${run.scoringSummary.unscorableCount} targets chưa chấm không được coi là normal.` : 'Run hoàn tất, không phát hiện anomaly. Detector không đánh dấu reading nào trong scope của run này.'}</p>}
    {state.data.length > 0 && <><p>Đã tải {state.data.length} anomalies{state.nextCursor ? ' · Còn dữ liệu trên Server' : ' · Đã hết trang của run'}; không suy ra tổng từ một trang.</p><div className="ux-list-scroll" tabIndex={0} role="region" aria-label="Kết quả analysis"><table className="ux-responsive-table"><thead><tr><th>Trạm</th><th>Thời gian</th><th>Score</th><th>Review</th><th>Điều tra</th></tr></thead><tbody>{state.data.map(a => <tr key={a.id}><td data-label="Trạm">{sensorName(a.sensorId, sensors.data)}</td><td data-label="Thời gian">{formatWorkspaceTime(a.ts, zone)} · {zoneLabel(zone)}</td><td data-label={scoreLabel(a.method)}><strong>{number(a.score, 4)}</strong><small>{scoreLabel(a.method)}</small></td><td data-label="Review"><StatusBadge value={a.status} /></td><td data-label="Điều tra"><Button variant="secondary" aria-label={`Xem ${a.readingId}`} onClick={() => workspace.getState().openAnomalies(run.id, a.id)}>Điều tra phát hiện</Button></td></tr>)}</tbody></table></div></>}
    {state.nextCursor && <Button variant="secondary" disabled={state.status === 'loading' || state.data.length >= 2000} onClick={() => { void pager.loadMore(); }}>Tải thêm anomalies</Button>}{state.data.length >= 2000 && state.nextCursor && <p className="ux-warning">Đã chạm giới hạn 2.000 anomalies trong phiên xem; còn dữ liệu trên Server.</p>}
  </section>;
}
