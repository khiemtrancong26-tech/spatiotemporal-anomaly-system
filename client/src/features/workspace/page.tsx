import { resolveInvestigation } from './investigation';
import type { Reading } from '../../shared/api/generated/wire';
import { explorationLocalTime, type ExplorationTimeZone } from '@pm25/shared-core';
import type { DatasetProfile } from '../../shared/api/generated/wire';
import { explorationError as errorMessage } from './exploration-error';
import { ExplorationPanel } from './exploration';
import { formatWorkspaceTime, zoneLabel } from './time';
import { Icon } from '../../shared/ui/icons';
import { AnalysisPage } from '../analysis/page';
import { AnomaliesPage } from '../anomalies/page';
import { Visualization } from './visualization';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { Button, Field, PageTitle } from '../../shared/ui/primitives';
import { parseWorkspaceFilters } from './filters';
import type { WorkspaceTab } from './state';
export function WorkspacePage({ datasetId, runId, selectRun }: { datasetId: string; runId?: string; selectRun: (id?: string) => void }) {
  const { workspace, datasets, data } = useServices();
  const state = useStore(workspace);
  const tabBar = useRef<HTMLElement>(null);
  useEffect(() => { const reveal = () => { if (workspace.getState().tab !== 'visualization') tabBar.current?.querySelector<HTMLElement>('[aria-pressed=true]')?.scrollIntoView({block:'nearest',inline:'nearest'}); }; reveal(); window.addEventListener('resize',reveal); return () => window.removeEventListener('resize',reveal); }, [workspace,state.tab]);
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => { setVisited(previous => previous.includes(state.tab) ? previous : [...previous, state.tab]); }, [state.tab]);
  const investigation = state.investigation;
  const [verified, setVerified] = useState<Reading>(), [investigationError, setInvestigationError] = useState(''), [investigationRevision, retryInvestigation] = useState(0);
  useEffect(() => {
    setVerified(undefined); setInvestigationError('');
    if (!investigation || state.datasetId !== datasetId) return;
    const controller = new AbortController();
    void resolveInvestigation(data.readings.list, investigation.target, controller.signal).then(row => {
      if (controller.signal.aborted || workspace.getState().datasetId !== datasetId) return;
      // Begin at the exact reading. Context expansion is a separate, explicit action.
      workspace.getState().applyFilters({ sensorId: row.sensorId, from: row.ts, to: row.ts });
      workspace.getState().selectReading(row.id); setVerified(row);
    }).catch(e => { if (!controller.signal.aborted) setInvestigationError(e instanceof Error && e.name !== 'DataSourceError' ? e.message : errorMessage(e)); });
    return () => controller.abort();
  }, [data, workspace, datasetId, state.datasetId, investigation, investigationRevision]);
  function expandInvestigation(allStations: boolean) {
    if (!verified) return;
    const scope={from:new Date(Date.parse(verified.ts) - 12 * 3600000).toISOString(),to:new Date(Date.parse(verified.ts) + 12 * 3600000).toISOString()};
    workspace.getState().setCubeScope(scope);
    workspace.getState().applyFilters({ sensorId: allStations ? undefined : verified.sensorId, ...scope });
    workspace.getState().selectReading(verified.id);
  }

  useEffect(() => { workspace.getState().openDataset(datasetId); }, [workspace, datasetId]);
  useEffect(() => { if (runId) workspace.getState().selectTab('analysis'); }, [workspace, runId]);
  const [draft, setDraft] = useState(() => {
    const filters = workspace.getState().datasetId === datasetId ? workspace.getState().filters : {};
    const local = (utc?: string) => utc ? new Date(Date.parse(utc) + 7 * 3600_000).toISOString().slice(0, 19) : '';
    return { sensorId: filters.sensorId ?? '', bbox: filters.bbox?.join(',') ?? '', from: local(filters.from), to: local(filters.to) };
  });
  const [profile, setProfile] = useState<DatasetProfile>();
  const [profileError, setProfileError] = useState(''), [profileLoading, setProfileLoading] = useState(false), [profileRevision, refreshProfile] = useState(0);
  useEffect(() => {
    if (state.datasetId !== datasetId) return;
    const controller = new AbortController(); setProfile(undefined); setProfileError(''); setProfileLoading(true);
    void data.datasets.profile(datasetId, { sensorIds: state.filters.sensorId ? [state.filters.sensorId] : undefined, bbox: state.filters.bbox, from: state.filters.from, to: state.filters.to }, { signal: controller.signal }).then(p => {
      if (controller.signal.aborted) return; setProfile(p);
      if (!workspace.getState().timeZoneChosen) workspace.getState().setTimeZone(p.metadata.timeZone, false);
    }).catch(e => { if (!controller.signal.aborted) setProfileError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setProfileLoading(false); });
    return () => controller.abort();
  }, [data, workspace, datasetId, state.datasetId, state.filters, profileRevision]);
  useEffect(() => {
    const f = workspace.getState().filters;
    setDraft({ sensorId: f.sensorId ?? '', bbox: f.bbox?.join(',') ?? '', from: f.from ? explorationLocalTime(f.from, state.timeZone) : '', to: f.to ? explorationLocalTime(f.to, state.timeZone) : '' });
  }, [workspace, state.timeZone, datasetId, state.filters]);
  const [error, setError] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filterPanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!filtersExpanded) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !filterPanel.current?.contains(event.target)) setFiltersExpanded(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFiltersExpanded(false); filterPanel.current?.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [filtersExpanded]);
  const dataset = datasets.get(datasetId);
  function apply(event: FormEvent) {
    event.preventDefault(); if (state.reviewDirty && !window.confirm('Bỏ bản review chưa lưu để đổi bộ lọc?')) return;
    try { workspace.getState().applyFilters(parseWorkspaceFilters(draft, state.timeZone)); setError(''); setFiltersExpanded(false); } catch (cause) { setError((cause as Error).message); }
  }
  return <div className={`workspace-page ${state.tab !== 'visualization' ? 'workspace-analyst' : ''}`}><PageTitle eyebrow="WORKSPACE" title={dataset?.name ?? 'Dataset Workspace'} description={`Dataset ID: ${datasetId}`} />{!dataset && <p className="metadata-notice" role="status">{profile ? 'Profile Server đã xác nhận dataset imported. Tên dataset chưa có trong phiên; đang dùng ID từ URL.' : profileLoading ? 'Đang đọc Profile để xác nhận dataset.' : 'Chưa đọc được Profile dataset. Có thể thử lại tại Data Exploration.'}</p>}<div className="workspace-layout"><details ref={filterPanel} className="workspace-control-panel" open={filtersExpanded} onToggle={e => setFiltersExpanded(e.currentTarget.open)}><summary className="filter-heading"><Icon name="filter" /><span className="filter-title">Phạm vi tra cứu</span><span>{zoneLabel(state.timeZone)}</span></summary><form className="card workspace-filters" onSubmit={apply}><Field label="Trạm (Sensor ID)" value={draft.sensorId} onChange={(e) => setDraft({ ...draft, sensorId: e.target.value })} placeholder="Tất cả trạm" /><Field label="Vùng bbox" value={draft.bbox} placeholder="west,south,east,north" onChange={(e) => setDraft({ ...draft, bbox: e.target.value })} /><Field label={`Từ · ${zoneLabel(state.timeZone)}`} type="datetime-local" step="1" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /><Field label={`Đến · ${zoneLabel(state.timeZone)}`} type="datetime-local" step="1" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /><div className="filter-actions"><Button type="submit">Áp dụng bộ lọc</Button><Button variant="secondary" onClick={() => { if (state.reviewDirty && !window.confirm('Bỏ bản review chưa lưu để xóa bộ lọc?')) return; setDraft({ sensorId: '', bbox: '', from: '', to: '' }); setError(''); workspace.getState().applyFilters({}); setFiltersExpanded(false); }}>Xóa bộ lọc</Button></div>{error && <p role="alert" className="text-error">{error}</p>}</form></details><div className="workspace-content"><div className="workspace-command-bar"><nav ref={tabBar} className="workspace-tabs" aria-label="Khu vực workspace">{(['exploration', 'visualization', 'analysis', 'anomalies'] as WorkspaceTab[]).map((tab) => <Button key={tab} variant={state.tab === tab ? 'primary' : 'secondary'} aria-pressed={state.tab === tab} onClick={() => { if (!state.reviewDirty || window.confirm('Bỏ bản review chưa lưu để đổi tab?')) { if(tab === 'anomalies' && state.tab === 'analysis' && runId) workspace.getState().openAnomalies(runId); else workspace.getState().selectTab(tab); } }}><Icon name={tab === 'visualization' ? 'cube' : tab === 'analysis' ? 'activity' : 'layers'} />{tab === 'exploration' ? 'Data Exploration' : tab === 'visualization' ? 'Visualization' : tab === 'analysis' ? 'Analysis' : 'Anomalies'}</Button>)}</nav><label className="field workspace-timezone">Múi giờ workspace<select aria-label="Múi giờ workspace" value={state.timeZone} onChange={e => workspace.getState().setTimeZone(e.target.value as ExplorationTimeZone)}><option value="UTC">UTC</option><option value="+07:00">UTC+07:00</option><option value="+08:00">UTC+08:00</option></select></label></div><p className="muted" data-testid="applied-filter">Bộ lọc đã áp dụng: {state.filters.sensorId || 'Tất cả trạm'} · {state.filters.from ? formatWorkspaceTime(state.filters.from, state.timeZone) : 'Không giới hạn từ'} · {state.filters.to ? formatWorkspaceTime(state.filters.to, state.timeZone) : 'Không giới hạn đến'} · {zoneLabel(state.timeZone)} · {profile?.metadata.source === 'configured' ? 'Metadata dataset' : 'Fallback +07:00'} · {profile && <span data-testid="server-profile-summary">Tổng dataset: {profile.dataset.readingCount} readings · Scope Server: {profile.scoped.readingCount} readings. Số đã tải xem riêng trên Map/Cube.</span>}</p>{state.tab === 'anomalies' && <p className="metadata-notice">Danh sách anomalies chỉ hỗ trợ dataset/thời gian và bộ lọc detector; trạm/bbox không áp dụng theo API hiện tại.</p>}{investigation && state.tab === 'visualization' && <section className="analyst-ux ux-investigation-entry" aria-label="Điều tra reading">
        <div className="ux-panel">
          <header className="investigation-header">
            <div className="investigation-identity">
              <h3><Icon name="activity" size={18} />Điều tra reading</h3>
              <p>Trạm <strong>{investigation.target.sensorId}</strong><span aria-hidden="true"> · </span><time dateTime={investigation.target.ts}>{formatWorkspaceTime(investigation.target.ts, state.timeZone)}</time> · {zoneLabel(state.timeZone)}</p>
              <p className="investigation-reading">Reading <code>{investigation.target.readingId}</code></p>
            </div>
            <Button variant="secondary" onClick={() => workspace.getState().returnFromInvestigation()}>Quay lại {investigation.returnTab === 'analysis' ? 'Analysis' : 'Anomalies'}</Button>
          </header>
          {!verified && !investigationError && <p className="investigation-status" role="status">Đang xác minh reading chính xác trên Server…</p>}
          {investigationError && <div className="investigation-error" role="alert"><p>{investigationError}</p><Button variant="secondary" onClick={() => retryInvestigation(n => n + 1)}>Thử xác minh lại</Button></div>}
          {verified && (() => {
            const from = Date.parse(state.filters.from ?? ''), to = Date.parse(state.filters.to ?? ''), source = Date.parse(verified.ts);
            const exact = !state.filters.bbox && state.filters.sensorId === verified.sensorId && from === source && to === source;
            const expanded = !state.filters.bbox && from === source - 12 * 3600000 && to === source + 12 * 3600000;
            const station = expanded && state.filters.sensorId === verified.sensorId;
            const all = expanded && !state.filters.sensorId;
            return <div className="investigation-context">
              <div className="investigation-verification"><span className="investigation-status" role="status">Đã xác minh đúng ID</span><p>{exact ? 'Điểm gốc · Chỉ thời điểm nguồn' : station ? 'Cùng trạm · Bối cảnh ±12 giờ' : all ? 'Tất cả trạm · Bối cảnh ±12 giờ' : 'Phạm vi Workspace tùy chỉnh'}</p></div>
              <div className="investigation-segments" role="group" aria-label="Phạm vi điều tra">
                <Button variant="secondary" aria-pressed={exact} onClick={() => { workspace.getState().setCubeScope({ from: verified.ts, to: verified.ts }); workspace.getState().applyFilters({ sensorId: verified.sensorId, from: verified.ts, to: verified.ts }); workspace.getState().selectReading(verified.id); }}>Điểm gốc</Button>
                <Button variant="secondary" aria-pressed={station} onClick={() => expandInvestigation(false)}>Cùng trạm ±12h</Button>
                <Button variant="secondary" aria-pressed={all} onClick={() => expandInvestigation(true)}>Tất cả trạm ±12h</Button>
              </div>
            </div>;
          })()}
        </div>
      </section>}
      {state.tab === 'exploration' && <ExplorationPanel key={JSON.stringify([datasetId, state.filters])} datasetId={datasetId} filters={state.filters} profile={profile} loading={profileLoading} error={profileError} retry={() => refreshProfile(n => n + 1)} />}
      {state.tab === 'visualization' && state.datasetId === datasetId && (!investigation || verified) && <Visualization key={JSON.stringify([datasetId, state.filters])} datasetId={datasetId} filters={state.filters} initialView={investigation && verified ? { target: investigation.target, reading: verified } : undefined} onSensor={sensorId => { setDraft({ ...draft, sensorId }); workspace.getState().applyFilters({ ...state.filters, sensorId: sensorId || undefined }); }} />}
      <div hidden={state.tab !== 'analysis'}>{(state.tab === 'analysis' || visited.includes('analysis')) && <AnalysisPage datasetId={datasetId} filters={state.filters} runId={runId} selectRun={selectRun} active={state.tab === 'analysis'} />}</div>
      <div hidden={state.tab !== 'anomalies'}>{(state.tab === 'anomalies' || visited.includes('anomalies')) && <AnomaliesPage datasetId={datasetId} filters={state.filters} runId={runId} initialAnomalyId={state.anomalies.find(a => a.readingId === state.selectedReadingId)?.id} active={state.tab === 'anomalies'} />}</div></div></div></div>;
}
