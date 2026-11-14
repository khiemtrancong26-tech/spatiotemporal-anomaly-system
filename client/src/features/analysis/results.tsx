import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AnalysisRun } from '../../shared/api/generated/wire';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { Button, ErrorState, LoadingState } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
export function AnalysisResults({ run }: { run: AnalysisRun }) {
  const { data, workspace } = useServices();
  const pager = useMemo(() => createCursorPager(data.anomalies.list), [data]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => { if (run.status === 'completed') void pager.setQuery({ datasetId: run.datasetId, analysisRunId: run.id, sort: 'ts:asc', limit: 100 }); return () => pager.dispose(); }, [pager, run.id, run.datasetId, run.status]);
  useEffect(() => { if (run.status === 'completed') workspace.getState().setResults(run, state.data); }, [workspace, run, state.data]);
  if (run.status !== 'completed') return null;
  return <section><h3>Kết quả run {run.id}</h3><p>Phạm vi run độc lập bộ lọc xem hiện tại. Đã tải {state.data.length} anomalies{state.nextCursor ? ' · Còn trang' : ''}; không suy ra tổng số từ phần đã tải.</p>{state.status === 'loading' && <LoadingState />}{state.status === 'error' && <ErrorState message={errorMessage(state.error)} retry={() => { void pager.retry(); }} />}{state.status === 'ready' && !state.data.length && !state.nextCursor && <p>Run hoàn tất, không phát hiện anomaly.</p>}<div className="table-scroll"><table><thead><tr><th>Reading</th><th>Method</th><th>Score</th><th>Severity</th><th>Review</th><th>Xem</th></tr></thead><tbody>{state.data.map(a => <tr key={a.id}><td>{a.readingId}</td><td>{a.family} / {a.method}</td><td>{a.score}</td><td>{a.severity}</td><td>{a.status}</td><td><Button onClick={() => { workspace.getState().selectReading(a.readingId); workspace.getState().selectTab('visualization'); }}>Xem {a.readingId}</Button></td></tr>)}</tbody></table></div>{state.nextCursor && <Button disabled={state.status === 'loading' || state.data.length >= 2000} onClick={() => { void pager.loadMore(); }}>Tải thêm anomalies</Button>}{state.data.length >= 2000 && state.nextCursor && <p>Đã chạm giới hạn 2.000 anomalies trong phiên xem; còn dữ liệu trên Server.</p>}</section>;
}
