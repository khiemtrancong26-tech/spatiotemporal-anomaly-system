import { AnalysisPage } from '../analysis/page';
import { AnalysisResults } from '../analysis/results';
import { Visualization } from './visualization';
import { useEffect, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { Button, Field, PageTitle, EmptyState } from '../../shared/ui/primitives';
import { parseWorkspaceFilters } from './filters';
import type { WorkspaceTab } from './state';
export function WorkspacePage({ datasetId, runId, selectRun }: { datasetId: string; runId?: string; selectRun: (id?: string) => void }) {
  const { workspace, datasets } = useServices();
  const state = useStore(workspace);
  useEffect(() => { workspace.getState().openDataset(datasetId); }, [workspace, datasetId]);
  useEffect(() => { if (runId) workspace.getState().selectTab('analysis'); }, [workspace, runId]);
  const [draft, setDraft] = useState(() => {
    const filters = workspace.getState().datasetId === datasetId ? workspace.getState().filters : {};
    const local = (utc?: string) => utc ? new Date(Date.parse(utc) + 7 * 3600_000).toISOString().slice(0, 19) : '';
    return { sensorId: filters.sensorId ?? '', bbox: filters.bbox?.join(',') ?? '', from: local(filters.from), to: local(filters.to) };
  });
  const [error, setError] = useState('');
  const dataset = datasets.get(datasetId);
  function apply(event: FormEvent) {
    event.preventDefault();
    try { workspace.getState().applyFilters(parseWorkspaceFilters(draft)); setError(''); } catch (cause) { setError((cause as Error).message); }
  }
  return <><PageTitle eyebrow="WORKSPACE" title={dataset?.name ?? 'Dataset Workspace'} description={`Dataset ID: ${datasetId}`} />{!dataset && <p className="metadata-notice" role="status">Chưa có metadata dataset. Workspace đang dùng ID từ URL; chưa thể xác nhận dataset tồn tại. Không tự quét danh sách dataset.</p>}<form className="card workspace-filters" onSubmit={apply}><Field label="Trạm (Sensor ID)" value={draft.sensorId} onChange={(e) => setDraft({ ...draft, sensorId: e.target.value })} hint="Dùng ID nội bộ; có thể chọn trạm đã tải trong phần tra cứu." /><Field label="Vùng bbox" value={draft.bbox} placeholder="west,south,east,north" onChange={(e) => setDraft({ ...draft, bbox: e.target.value })} /><Field label="Từ · UTC+07" type="datetime-local" step="1" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /><Field label="Đến · UTC+07" type="datetime-local" step="1" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /><Button type="submit">Áp dụng bộ lọc</Button><Button variant="secondary" onClick={() => { setDraft({ sensorId: '', bbox: '', from: '', to: '' }); setError(''); workspace.getState().applyFilters({}); }}>Xóa bộ lọc</Button>{error && <p role="alert" className="text-error">{error}</p>}</form><nav className="workspace-tabs" aria-label="Khu vực workspace">{(['visualization', 'analysis', 'anomalies'] as WorkspaceTab[]).map((tab) => <Button key={tab} variant={state.tab === tab ? 'primary' : 'secondary'} aria-pressed={state.tab === tab} onClick={() => workspace.getState().selectTab(tab)}>{tab === 'visualization' ? 'Visualization' : tab === 'analysis' ? 'Analysis' : 'Anomalies'}</Button>)}</nav><p className="muted" data-testid="applied-filter">Bộ lọc đã áp dụng: {state.filters.sensorId || 'Tất cả trạm'} · {state.filters.from || 'Không giới hạn từ'} · {state.filters.to || 'Không giới hạn đến'}</p>{state.tab === 'anomalies' && <p className="metadata-notice">Danh sách anomalies chỉ hỗ trợ dataset/thời gian và bộ lọc detector; trạm/bbox không áp dụng theo API hiện tại.</p>}{state.tab === 'visualization' && state.datasetId === datasetId ? <Visualization key={JSON.stringify([datasetId, state.filters])} datasetId={datasetId} filters={state.filters} onSensor={sensorId => { setDraft({ ...draft, sensorId }); workspace.getState().applyFilters({ ...state.filters, sensorId: sensorId || undefined }); }} /> : state.tab === 'analysis' ? <AnalysisPage key={JSON.stringify([datasetId, state.filters])} datasetId={datasetId} filters={state.filters} runId={runId} selectRun={selectRun} /> : state.resultRun ? <section className="card"><AnalysisResults key={state.resultRun.id} run={state.resultRun} /></section> : <section className="card"><EmptyState title="Danh sách anomaly" description="Nghiệp vụ được nối ở M5–M6." /></section>}</>;
}
