import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import type { DatasetProfile, ReadingAggregation, Sensor } from '../../shared/api/generated/wire';
import { Button, ErrorState, LoadingState } from '../../shared/ui/primitives';
import { explorationError as errorMessage } from './exploration-error';
import type { WorkspaceFilters } from './state';
import { formatWorkspaceTime, zoneLabel } from './time';

export function ExplorationPanel({ datasetId, filters, profile, loading, error, retry }: {
  datasetId: string; filters: WorkspaceFilters; profile?: DatasetProfile; loading: boolean; error: string; retry: () => void;
}) {
  const { data, workspace, config } = useServices(), zone = useStore(workspace, s => s.timeZone);
  const [stations, setStations] = useState<Sensor[]>([]), [stationError, setStationError] = useState('');
  const [cursor, setCursor] = useState<string | null>(), [selected, select] = useState<string[]>([]);
  const [bucket, setBucket] = useState<'hour' | 'day'>('hour'), [result, setResult] = useState<ReadingAggregation>();
  const [pending, setPending] = useState(false), [failure, setFailure] = useState(''), [revision, refresh] = useState(0);
  const [sensorRevision, refreshSensors] = useState(0), [requestedCursor, requestCursor] = useState<string>();
  const [tablePage, setTablePage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void data.sensors.list({ datasetId, bbox: filters.bbox, limit: 200, cursor: requestedCursor }, { signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) { setStations(previous => requestedCursor ? [...previous, ...page.data] : page.data); setCursor(page.page.nextCursor); setStationError(''); }
    }).catch(e => { if (!controller.signal.aborted) setStationError(errorMessage(e)); });
    return () => controller.abort();
  }, [data, datasetId, filters.bbox, requestedCursor, sensorRevision]);
  const from = filters.from ?? profile?.metadata.sampling?.expectedFrom ?? profile?.scoped.observedFrom;
  const to = filters.to ?? profile?.metadata.sampling?.expectedTo ?? profile?.scoped.observedTo;
  const sensorIds = useMemo(() => filters.sensorId ? [filters.sensorId] : selected.length ? selected : undefined, [filters.sensorId, selected]);
  useEffect(() => {
    setResult(undefined); setFailure(''); setTablePage(0); setPending(false);
    if (!profile || !from || !to) return;
    const controller = new AbortController(); setPending(true);
    void data.aggregates.get({ datasetId, bbox: filters.bbox, sensorIds, from, to, bucket, timeZone: zone }, { signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setResult(response);
    }).catch(e => { if (!controller.signal.aborted) setFailure(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [data, datasetId, filters.bbox, profile, from, to, bucket, zone, sensorIds, revision]);
  const name = (id: string) => stations.find(s => s.id === id)?.name ?? id;
  const max = Math.max(1, ...(result?.series.flatMap(s => s.buckets.map(b => b.mean ?? 0)) ?? []));
  const bucketCount = result?.series[0]?.buckets.length ?? 0;
  return <section className="card exploration-page" aria-label="Data Exploration"><h2>Data Exploration</h2>
    <p>{config.mode === 'online' ? 'Online · số liệu từ API thật' : 'Chế độ demo/mock · Exploration chưa mô phỏng, có thể không khả dụng'}. Số liệu toàn scope do Server tính; không suy từ readings đã tải trên Map/Cube.</p>
    {loading && <LoadingState label="Đang tính Profile trên Server…" />}{error && <ErrorState message={error} retry={retry} />}
    {profile && <><div data-testid="exploration-profile"><h3>Profile và chất lượng</h3><p>Tổng dataset: <strong>{profile.dataset.readingCount}</strong> readings · {profile.dataset.sensorCount} trạm. Scope Server: <strong>{profile.scoped.readingCount}</strong> readings · {profile.scoped.sensorsWithReadings}/{profile.scoped.sensorCount} trạm có mẫu.</p>
      <p>Phạm vi thực có: {profile.scoped.observedFrom ? formatWorkspaceTime(profile.scoped.observedFrom, zone) : 'Rỗng'} — {profile.scoped.observedTo ? formatWorkspaceTime(profile.scoped.observedTo, zone) : 'Rỗng'} · {zoneLabel(zone)}</p>
      <p>Min / mean / max: {profile.scoped.min ?? '—'} / {profile.scoped.mean?.toFixed(2) ?? '—'} / {profile.scoped.max ?? '—'} µg/m³.</p>
      <p data-testid="exploration-coverage">Coverage scope: {profile.scoped.coverage.status === 'unknown' ? 'Chưa xác định (chưa có cadence/anchor/khoảng kỳ vọng)' : profile.scoped.coverage.status === 'not_applicable' ? 'Không có slot kỳ vọng trong scope' : `${profile.scoped.coverage.observedSlots}/${profile.scoped.coverage.expectedSlots} slots · thiếu ${profile.scoped.coverage.missingSlots} station–time · ${((profile.scoped.coverage.ratio ?? 0) * 100).toFixed(2)}%`}. Ngoài lưới: {profile.scoped.coverage.unexpectedReadings ?? 'Chưa xác định'}.</p>
      <p>Chất lượng nguồn: {profile.sourceQuality.totalRows ?? 'Chưa biết'} dòng · invalid {profile.sourceQuality.invalidRows ?? 'Chưa biết'} · trùng {profile.sourceQuality.duplicateRows ?? 'Chưa biết'} · xung đột {profile.sourceQuality.conflictingRows ?? 'Chưa biết'}. Dòng thiếu giá trị nguồn: {profile.sourceQuality.missingValueRows ?? 'Chưa có phân loại'}; không đồng nghĩa thiếu station–time.</p>
      <p>Timezone: {zoneLabel(zone)} · {profile.metadata.source === 'fallback' ? 'Fallback hiển thị +07:00; chưa có metadata nguồn' : `Đã cấu hình metadata v${profile.metadata.version}`}. Phần readings chưa tải thuộc Map/Cube, không cộng vào missing.</p>
      {profile.metadata.provenance && <details><summary>Nguồn metadata</summary><p>{profile.metadata.provenance}</p></details>}</div>
      <h3>So sánh trạm trên cùng bucket</h3><p>Mean của readings thực có, bucket rỗng để trống; không nội suy và không phải reading quan sát. Khoảng: {from ? formatWorkspaceTime(from, zone) : 'Chưa có'} — {to ? formatWorkspaceTime(to, zone) : 'Chưa có'} · {zoneLabel(zone)}.</p>
      <label className="field">Bucket tổng hợp<select aria-label="Bucket tổng hợp" value={bucket} onChange={e => setBucket(e.target.value as typeof bucket)}><option value="hour">Giờ</option><option value="day">Ngày</option></select></label>
      <fieldset><legend>Trạm so sánh (tối đa 20; bỏ chọn hết = tất cả trong scope)</legend>{stations.filter(s => !filters.sensorId || s.id === filters.sensorId).map(s => <label key={s.id} style={{ display: 'inline-block', margin: '0.5rem' }}><input type="checkbox" checked={filters.sensorId === s.id || selected.includes(s.id)} disabled={Boolean(filters.sensorId) || (!selected.includes(s.id) && selected.length >= 20)} onChange={e => select(previous => e.target.checked ? [...previous, s.id] : previous.filter(id => id !== s.id))} />{s.name}</label>)}{cursor && <Button onClick={() => requestCursor(cursor)}>Tải thêm metadata trạm</Button>}{stationError && <ErrorState message={stationError} retry={() => refreshSensors(n => n + 1)} />}</fieldset>
      {pending && <LoadingState label="Đang tổng hợp toàn scope…" />}{failure && <ErrorState message={failure} retry={() => refresh(n => n + 1)} />}
      {!from || !to ? <p>Chưa có khoảng thời gian để tổng hợp. Chọn phạm vi tra cứu.</p> : null}
      {result && <div data-testid="exploration-aggregates"><p>Đã nhận đầy đủ: {result.series.length} series × {bucketCount} buckets · {zoneLabel(zone)} · metadata {result.metadataVersion ?? 'unknown'}.</p>
        {!result.series.length && <p>Không có trạm trong scope.</p>}{result.series.map(series => <div key={series.sensorId}><h4>{name(series.sensorId)}</h4><svg viewBox="0 0 800 150" role="img" aria-label={`Mean PM2.5 ${name(series.sensorId)} · ${zoneLabel(zone)}`} style={{ width: '100%', maxHeight: 180 }}>
          <line x1="20" x2="780" y1="130" y2="130" stroke="currentColor" />{series.buckets.map((b, i) => b.mean === null ? null : <circle key={b.start} cx={20 + i / Math.max(1, bucketCount - 1) * 760} cy={130 - b.mean / max * 110} r="2" fill="#087F86"><title>{formatWorkspaceTime(b.start, zone)} — {formatWorkspaceTime(b.end, zone)} · mean {b.mean.toFixed(2)} µg/m³ · count {b.count} · missing {b.coverage.missingSlots ?? 'unknown'}</title></circle>)}
        </svg></div>)}
        <details><summary>Bảng bucket so sánh</summary><p>Bucket {Math.min(tablePage * 100 + 1, bucketCount)}–{Math.min((tablePage + 1) * 100, bucketCount)}/{bucketCount}. Mỗi ô: mean · count · missing; “—” là bucket rỗng.</p><div className="table-scroll" role="region" aria-label="Bảng aggregate"><table><thead><tr><th>Bắt đầu · {zoneLabel(zone)}</th>{result.series.map(s => <th key={s.sensorId}>{name(s.sensorId)}</th>)}</tr></thead><tbody>{result.series[0]?.buckets.slice(tablePage * 100, (tablePage + 1) * 100).map((b, index) => <tr key={b.start}><td>{formatWorkspaceTime(b.start, zone)}</td>{result.series.map(s => { const cell = s.buckets[tablePage * 100 + index]; return <td key={s.sensorId}>{cell.mean?.toFixed(2) ?? '—'} · {cell.count} · {cell.coverage.missingSlots ?? 'unknown'}</td>; })}</tr>)}</tbody></table></div><Button disabled={tablePage === 0} onClick={() => setTablePage(n => n - 1)}>Trang bucket trước</Button><Button disabled={(tablePage + 1) * 100 >= bucketCount} onClick={() => setTablePage(n => n + 1)}>Trang bucket sau</Button></details>
      </div>}
    </>}
  </section>;
}
