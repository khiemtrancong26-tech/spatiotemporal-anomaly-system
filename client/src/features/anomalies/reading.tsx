import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import type { Anomaly, Reading } from '../../shared/api/generated/wire';
import { Button, LoadingState } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import { resolveInvestigation, targetFromAnomaly } from '../workspace/investigation';
import { formatWorkspaceTime, zoneLabel } from '../workspace/time';
import { number } from '../workspace/analyst';

export function AnomalyReading({ item }: { item: Anomaly }) {
  const { data, workspace } = useServices(), zone = useStore(workspace, s => s.timeZone);
  const [reading, setReading] = useState<Reading>(), [pending, setPending] = useState(false), [error, setError] = useState(''), [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setReading(undefined); setError(''); setPending(true);
    void resolveInvestigation(data.readings.list, targetFromAnomaly(item, 'cube'), controller.signal).then(r => { if (!controller.signal.aborted) setReading(r); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error && e.name !== 'DataSourceError' ? e.message : errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [data, item, revision]);
  return <div className="ux-reading"><span>PM2.5 thực đo</span>{pending ? <LoadingState label="Đang tải phép đo để đối chiếu…" /> : reading ? <><strong>{number(reading.value)} <small>µg/m³</small></strong><p>{formatWorkspaceTime(reading.ts, zone)} · {zoneLabel(zone)}</p><small>Đã xác minh đúng dataset, trạm, thời điểm và readingId.</small></> : <><p role="status">{error || 'Chưa tải phép đo để đối chiếu'}</p><Button variant="secondary" onClick={() => refresh(n => n + 1)}>Thử tải lại reading</Button></>}</div>;
}
