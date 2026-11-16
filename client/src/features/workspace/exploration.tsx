import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import type { DatasetProfile, ReadingAggregation } from '../../shared/api/generated/wire';
import { Button, ErrorState, LoadingState } from '../../shared/ui/primitives';
import { explorationError as errorMessage } from './exploration-error';
import type { WorkspaceFilters } from './state';
import { formatWorkspaceTime, zoneLabel } from './time';
import { number, scopeFromFilters, sensorName } from './analyst';
import { useAnalystSensors } from './analyst-ui';
import { ExplorationChart } from './exploration-chart';

export function ExplorationPanel({ datasetId, filters, profile, loading, error, retry }: {
  datasetId: string; filters: WorkspaceFilters; profile?: DatasetProfile; loading: boolean; error: string; retry: () => void;
}) {
  const { data, workspace, config } = useServices(), zone = useStore(workspace, s => s.timeZone);
  const sensors = useAnalystSensors(datasetId);
  const [selected, select] = useState<string[]>(), [bucket, setBucket] = useState<'hour' | 'day'>('day');
  const [result, setResult] = useState<ReadingAggregation>(), [pending, setPending] = useState(false), [failure, setFailure] = useState(''), [revision, refresh] = useState(0);
  const [tablePage, setTablePage] = useState(0), [multiples, showMultiples] = useState(false), [scopeChoice, chooseScope] = useState(false);
  useEffect(() => { if (selected === undefined && sensors.status === 'ready') select(filters.sensorId ? [filters.sensorId] : sensors.data.slice(0, 3).map(s => s.id)); }, [selected, sensors.status, sensors.data, filters.sensorId]);
  const from = filters.from ?? profile?.metadata.sampling?.expectedFrom ?? profile?.scoped.observedFrom;
  const to = filters.to ?? profile?.metadata.sampling?.expectedTo ?? profile?.scoped.observedTo;
  const sensorIds = useMemo(() => filters.sensorId ? [filters.sensorId] : selected, [filters.sensorId, selected]);
  useEffect(() => {
    setResult(undefined); setFailure(''); setTablePage(0); setPending(false);
    if (!profile || !from || !to || !sensorIds?.length) return;
    const duration = Date.parse(to) - Date.parse(from), days = bucket === 'hour' ? 31 : 366;
    if (duration > days * 86400_000) { setFailure(`Phạm vi theo ${bucket === 'hour' ? 'giờ' : 'ngày'} tối đa ${days} ngày. Chọn phạm vi nhỏ hơn hoặc đổi độ phân giải.`); return; }
    if (sensorIds.length > 20 || (Math.floor(duration / (bucket === 'hour' ? 3600_000 : 86400_000)) + 2) * sensorIds.length > 20000) { setFailure('Yêu cầu có thể vượt 20 series hoặc 20.000 ô. Giảm số trạm, khoảng thời gian hoặc chọn theo ngày.'); return; }
    const controller = new AbortController(); setPending(true);
    void data.aggregates.get({ datasetId, bbox: filters.bbox, sensorIds, from, to, bucket, timeZone: zone }, { signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setResult(response);
    }).catch(e => { if (!controller.signal.aborted) setFailure(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [data, datasetId, filters.bbox, profile, from, to, bucket, zone, sensorIds, revision]);
  const name = (id: string) => sensorName(id, sensors.data), count = result?.series[0]?.buckets.length ?? 0;
  const coverage = profile?.scoped.coverage;
  function prepare(chart: boolean) {
    if (chart && !sensorIds?.length) return;
    workspace.getState().prepareAnalysis({ ...scopeFromFilters(filters), ...(chart ? { sensorIds: [...sensorIds!] } : {}) }, chart ? 'Các trạm đang so sánh; thời gian từ bộ lọc workspace' : 'Toàn bộ phạm vi workspace');
  }
  return <section className="analyst-ux ux-exploration" aria-label="Data Exploration">
    <header className="ux-page-heading"><div><p className="ux-eyebrow">01 · KHÁM PHÁ DỮ LIỆU</p><h2>Hiểu dữ liệu trước khi phân tích</h2><p>Kiểm tra phạm vi, chất lượng dữ liệu và xu hướng giữa các trạm.</p></div><Button onClick={() => chooseScope(true)}>Phân tích phạm vi này</Button></header>
    {config.mode === 'mock' && <p className="ux-notice">Dữ liệu mô phỏng; không phải bằng chứng detector hoặc API production.</p>}
    {loading && <LoadingState label="Đang tính Profile trên Server…" />}{error && <ErrorState message={error} retry={retry} />}
    {profile && <div className="ux-kpis" data-testid="exploration-profile"><article><span>READINGS DATASET</span><strong>{number(profile.dataset.readingCount, 0)}</strong><small>Toàn bộ dataset · Server Profile</small></article><article><span>TRẠM TRONG PHẠM VI</span><strong>{profile.scoped.sensorsWithReadings}<small> / {profile.scoped.sensorCount}</small></strong><small>Trạm có readings</small></article><article><span>PM2.5 TRUNG BÌNH</span><strong>{number(profile.scoped.mean)}<small> µg/m³</small></strong><small>Trên readings thực có trong scope</small></article><article data-testid="exploration-coverage"><span>ĐỘ PHỦ KỲ VỌNG</span><strong className="ux-kpi-text">{coverage?.status === 'known' ? `${number((coverage.ratio ?? 0) * 100)}%` : coverage?.status === 'not_applicable' ? 'Không áp dụng' : 'Chưa xác định'}</strong><small>{coverage?.status === 'known' ? `${coverage.observedSlots}/${coverage.expectedSlots} slots · thiếu ${coverage.missingSlots}` : coverage?.reason ?? 'Thiếu sampling metadata'}</small></article></div>}
    <div className="ux-exploration-grid"><section className="ux-panel ux-selection"><h3>Phạm vi khám phá</h3><p>{profile ? `${number(profile.scoped.readingCount, 0)} readings trong phạm vi · Server Profile` : 'Chưa xác nhận số readings'}</p><p>{from && to ? `${formatWorkspaceTime(from, zone)} → ${formatWorkspaceTime(to, zone)} · ${zoneLabel(zone)}` : 'Chưa có khoảng thời gian để tổng hợp. Chọn phạm vi tra cứu.'}</p>{(!filters.from || !filters.to) && <p className="ux-notice">Biểu đồ dùng khoảng thời gian từ Profile để xem trước. Khoảng này không tự trở thành scope Analysis.</p>}
      <label className="field">Bucket tổng hợp<select aria-label="Bucket tổng hợp" value={bucket} onChange={e => setBucket(e.target.value as typeof bucket)}><option value="day">Ngày</option><option value="hour">Giờ</option></select></label>
      <fieldset className="ux-sensor-options"><legend>Trạm so sánh · tối đa 20</legend>{sensors.data.filter(s => !filters.sensorId || s.id === filters.sensorId).map(s => <label key={s.id}><input type="checkbox" checked={sensorIds?.includes(s.id) ?? false} disabled={Boolean(filters.sensorId) || (!sensorIds?.includes(s.id) && (sensorIds?.length ?? 0) >= 20)} onChange={e => select(previous => e.target.checked ? [...(previous ?? []), s.id] : previous?.filter(id => id !== s.id))} />{s.name}</label>)}</fieldset>
      {sensors.nextCursor && <Button variant="secondary" disabled={sensors.status === 'loading'} onClick={sensors.more}>Tải thêm metadata trạm</Button>}{sensors.status === 'error' && <ErrorState message={errorMessage(sensors.error)} retry={sensors.retry} />}
      <p className="ux-notice">Đã chọn {sensorIds?.length ?? 0} trạm để so sánh biểu đồ. Phạm vi Analysis được chọn riêng ở bước tiếp theo.</p>
    </section><section className="ux-panel ux-chart-panel"><div className="ux-panel-heading"><div><h3>So sánh xu hướng PM2.5</h3><p>Mean mỗi {bucket === 'hour' ? 'giờ' : 'ngày'} · {zoneLabel(zone)} · dữ liệu tổng hợp trên Server</p></div></div>
      {pending && <LoadingState label="Đang tổng hợp toàn scope…" />}{failure && <ErrorState message={failure} retry={() => refresh(n => n + 1)} />}{!sensorIds?.length && <p>Chọn ít nhất một trạm để so sánh.</p>}
      {result && <div data-testid="exploration-aggregates"><p>Đã nhận đầy đủ: {result.series.length} series × {count} buckets.</p>{!result.series.length ? <p>Không có trạm trong scope.</p> : <ExplorationChart result={result} zone={zone} name={name} />}</div>}
      <p className="ux-help">Khoảng trống là bucket không có mẫu. Không tự điền 0, không nội suy; mean bucket không phải reading.</p>
    </section></div>
    <div className="ux-two-columns"><section className="ux-panel"><h3>Chất lượng và độ tin cậy</h3>{profile ? <><div className="ux-quality-grid"><span>Min<b>{number(profile.scoped.min)}</b><small>µg/m³</small></span><span>Max<b>{number(profile.scoped.max)}</b><small>µg/m³</small></span><span>Dòng invalid<b>{number(profile.sourceQuality.invalidRows, 0)}</b></span><span>Dòng trùng<b>{number(profile.sourceQuality.duplicateRows, 0)}</b></span></div><p>Coverage {coverage?.status === 'unknown' ? 'chưa xác định — nguồn chưa khai báo đầy đủ lịch lấy mẫu kỳ vọng.' : coverage?.reason ?? 'được tính từ metadata nguồn.'} Không đồng nhất slot thiếu với số đo bằng 0.</p><details><summary>Nguồn & kỹ thuật</summary><p>Phạm vi thực có: {profile.scoped.observedFrom ? formatWorkspaceTime(profile.scoped.observedFrom, zone) : 'Rỗng'} → {profile.scoped.observedTo ? formatWorkspaceTime(profile.scoped.observedTo, zone) : 'Rỗng'}.</p><p>{profile.metadata.provenance ?? 'Chưa có provenance nguồn'} · metadata v{profile.metadata.version ?? 'unknown'} · {profile.metadata.source}.</p><p>Chất lượng nguồn: {number(profile.sourceQuality.totalRows, 0)} dòng · xung đột {number(profile.sourceQuality.conflictingRows, 0)} · thiếu giá trị {number(profile.sourceQuality.missingValueRows, 0)}. {profile.sourceQuality.reason}</p></details></> : <p>Chưa có Profile đã xác nhận.</p>}</section><section className="ux-panel"><h3>Bước tiếp theo</h3><p>Chọn phạm vi phân tích có chủ ý; không dùng 100 hoặc 2.000 readings đang hiển thị làm đầu vào detector.</p><div className="ux-actions"><Button onClick={() => chooseScope(true)}>Phân tích phạm vi này</Button><Button variant="secondary" onClick={() => workspace.getState().selectTab('visualization')}>Xem tại Visualization</Button></div><p>Chuyển sang cấu hình Analysis; chưa gửi job.</p></section></div>
    {scopeChoice && <section className="ux-panel ux-scope-choice" role="region" aria-label="Chọn phạm vi Analysis"><h3>Phân tích phạm vi nào?</h3><p>Lựa chọn trạm trên biểu đồ chỉ phục vụ so sánh. Thời gian Analysis dùng bộ lọc workspace; không tự dùng khoảng preview.</p>{filters.bbox && <p className="ux-warning">Analysis không nhận bbox. Chọn rõ các trạm muốn phân tích và xác nhận ở bước tiếp theo.</p>}<div className="ux-actions"><Button onClick={() => prepare(false)}>Toàn bộ scope workspace</Button><Button variant="secondary" disabled={!sensorIds?.length} onClick={() => prepare(true)}>Các trạm đang so sánh ({sensorIds?.length ?? 0})</Button><Button variant="secondary" onClick={() => chooseScope(false)}>Đóng lựa chọn</Button></div></section>}
    {result && <details className="ux-panel"><summary>Bảng bucket so sánh</summary><p>Bucket {Math.min(tablePage * 100 + 1, count)}–{Math.min((tablePage + 1) * 100, count)}/{count}. Mỗi ô: mean · count · missing; “—” là bucket rỗng.</p><div className="table-scroll" role="region" aria-label="Bảng aggregate"><table><thead><tr><th>Bắt đầu · {zoneLabel(zone)}</th>{result.series.map(s => <th key={s.sensorId}>{name(s.sensorId)}</th>)}</tr></thead><tbody>{result.series[0]?.buckets.slice(tablePage * 100, (tablePage + 1) * 100).map((b, index) => <tr key={b.start}><td>{formatWorkspaceTime(b.start, zone)}</td>{result.series.map(s => { const cell = s.buckets[tablePage * 100 + index]; return <td key={s.sensorId}>{number(cell.mean)} · {cell.count} · {cell.coverage.missingSlots ?? 'unknown'}</td>; })}</tr>)}</tbody></table></div><div className="ux-actions"><Button variant="secondary" disabled={tablePage === 0} onClick={() => setTablePage(n => n - 1)}>Trang bucket trước</Button><Button variant="secondary" disabled={(tablePage + 1) * 100 >= count} onClick={() => setTablePage(n => n + 1)}>Trang bucket sau</Button></div></details>}
    {result && <details className="ux-panel" onToggle={e => showMultiples(e.currentTarget.open)}><summary>Biểu đồ riêng từng trạm · Small multiples</summary>{multiples && result.series.map(s => <section key={s.sensorId}><h4>{name(s.sensorId)}</h4><ExplorationChart result={{ ...result, series: [s] }} zone={zone} name={name} /></section>)}</details>}
  </section>;
}
