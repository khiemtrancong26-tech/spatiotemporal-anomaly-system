import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import type { AnalysisScope } from './analyst';
import { sensorName } from './analyst';
import type { Sensor } from '../../shared/api/generated/wire';
import type { ExplorationTimeZone } from '@pm25/shared-core';
import { formatWorkspaceTime, zoneLabel } from './time';

export function useAnalystSensors(datasetId: string) {
  const { data } = useServices();
  const pager = useMemo(() => createCursorPager(data.sensors.list), [data]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => { void pager.setQuery({ datasetId, sort: 'externalId:asc', limit: 100 }); return () => pager.dispose(); }, [pager, datasetId]);
  return { ...state, more: () => { void pager.loadMore(); }, retry: () => { void pager.retry(); } };
}
export function ScopeText({ scope, sensors = [], zone }: { scope: AnalysisScope; sensors?: Sensor[]; zone: ExplorationTimeZone }) {
  return <span>{scope.sensorIds ? scope.sensorIds.map(id => sensorName(id, sensors)).join(', ') : 'Tất cả trạm'} · {scope.from || scope.to ? `${scope.from ? formatWorkspaceTime(scope.from, zone) : 'Không giới hạn từ'} → ${scope.to ? formatWorkspaceTime(scope.to, zone) : 'Không giới hạn đến'} · ${zoneLabel(zone)}` : 'Toàn bộ thời gian của dataset'}</span>;
}
export function TechnicalId({ label, id }: { label: string; id: string }) {
  return <div className="ux-technical-id"><span>{label}: {id}</span><button type="button" className="ux-text-button" onClick={() => { void navigator.clipboard?.writeText(id); }}>Sao chép {label}</button></div>;
}
