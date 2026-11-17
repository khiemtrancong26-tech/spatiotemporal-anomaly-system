import { median } from 'simple-statistics';

export const PM25_V2_MODEL_ID = 'pm25-iforest-uci501-v2';
export const PM25_V2_POLICY = {
  id: 'pm25-st-features-v2-2026-11-17', features: ['value', 'temporal_delta', 'spatial_delta'],
  temporalMaxGapMs: 2 * 3600000, neighborCount: 3, neighborRadiusKm: 50, minSpatialReadings: 2,
  spatialTime: 'exact', distance: 'haversine-6371.0088-km', tieBreak: 'externalId-codepoint',
} as const;
export interface FeaturePoint { id: string; datasetId: string; sensorId: string; ts: string; value: number }
export interface FeatureSensor { id: string; datasetId: string; externalId: string; location: { type: 'Point'; coordinates: readonly [number, number] } }
export interface FeatureRowV2 { readingId: string; values: number[] }
export interface ScoringSummary {
  targetCount: number; scoredCount: number; unscorableCount: number;
  reasons: { temporalOnly: number; spatialOnly: number; both: number };
}
export function distanceKm(a: FeatureSensor, b: FeatureSensor): number {
  const rad = Math.PI / 180, [x1, y1] = a.location.coordinates, [x2, y2] = b.location.coordinates;
  const h = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
/** Fixed station graph: missing readings never cause substitution with a fourth neighbor. */
export function selectPm25Neighbors(datasetId: string, targetSensorIds: readonly string[], sensors: readonly FeatureSensor[]) {
  const byId = new Map<string, FeatureSensor>(), names = new Set<string>();
  for (const sensor of sensors) {
    const [lon, lat] = sensor.location.coordinates;
    if (sensor.datasetId !== datasetId || !sensor.id || !sensor.externalId || byId.has(sensor.id) || names.has(sensor.externalId) ||
      sensor.location.type !== 'Point' || sensor.location.coordinates.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error('Invalid dataset station metadata');
    byId.set(sensor.id, sensor); names.add(sensor.externalId);
  }
  const graph = new Map<string, string[]>();
  for (const id of new Set(targetSensorIds)) {
    const self = byId.get(id); if (!self) throw new Error('Target station is not in dataset');
    const nearest = sensors.filter(s => s.id !== id).map(s => ({ sensor: s, distance: distanceKm(self, s) }))
      .filter(s => s.distance <= PM25_V2_POLICY.neighborRadiusKm)
      .sort((a, b) => a.distance - b.distance || (a.sensor.externalId < b.sensor.externalId ? -1 : a.sensor.externalId > b.sensor.externalId ? 1 : 0))
      .slice(0, PM25_V2_POLICY.neighborCount).map(s => s.sensor.id);
    graph.set(id, nearest);
  }
  return graph;
}
/** Pure shared train/serve implementation. No IO, clocks, DB, imputation or visualization policy. */
export function buildPm25Features(datasetId: string, targets: readonly FeaturePoint[], context: readonly FeaturePoint[], sensors: readonly FeatureSensor[]) {
  const graph = selectPm25Neighbors(datasetId, targets.map(t => t.sensorId), sensors);
  const points = new Map<string, FeaturePoint>(), slots = new Map<string, FeaturePoint>(), series = new Map<string, FeaturePoint[]>();
  const sensorIds = new Set(sensors.map(s => s.id));
  for (const p of [...targets, ...context]) {
    const time = Date.parse(p.ts);
    if (!p.id || p.datasetId !== datasetId || !sensorIds.has(p.sensorId) || !Number.isFinite(time) || new Date(time).toISOString() !== p.ts ||
      !Number.isFinite(p.value) || p.value < 0 || p.value > 3.4028234663852886e38) throw new Error('Invalid feature input');
    const previous = points.get(p.id);
    if (previous) { if (previous.datasetId !== p.datasetId || previous.sensorId !== p.sensorId || previous.ts !== p.ts || previous.value !== p.value) throw new Error('Conflicting reading ID'); else continue; }
    const key = `${p.sensorId}/${time}`;
    if (slots.has(key)) throw new Error('Duplicate station/time');
    points.set(p.id, p); slots.set(key, p);
    const group = series.get(p.sensorId) ?? []; group.push(p); series.set(p.sensorId, group);
  }
  for (const group of series.values()) group.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const rows: FeatureRowV2[] = [], scorable: FeaturePoint[] = [], targetIds = new Set<string>();
  const reasons = { temporalOnly: 0, spatialOnly: 0, both: 0 };
  for (const target of targets) {
    if (targetIds.has(target.id)) throw new Error('Duplicate target'); targetIds.add(target.id);
    const time = Date.parse(target.ts), group = series.get(target.sensorId)!;
    let lo = 0, hi = group.length;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (Date.parse(group[mid]!.ts) < time) lo = mid + 1; else hi = mid; }
    const previous = group[lo - 1];
    const temporalMissing = !previous || time - Date.parse(previous.ts) > PM25_V2_POLICY.temporalMaxGapMs;
    const neighbors = graph.get(target.sensorId)!;
    const sameTime = neighbors.flatMap(id => { const p = slots.get(`${id}/${time}`); return p ? [p.value] : []; });
    const spatialMissing = neighbors.length !== 3 || sameTime.length < 2;
    if (temporalMissing || spatialMissing) {
      if (temporalMissing && spatialMissing) reasons.both++; else if (temporalMissing) reasons.temporalOnly++; else reasons.spatialOnly++;
      continue;
    }
    const values = [target.value, target.value - previous!.value, target.value - median(sameTime)];
    if (!values.every(v => Number.isFinite(v) && Math.abs(v) <= 3.4028234663852886e38)) throw new Error('Features exceed native numeric bounds');
    rows.push({ readingId: target.id, values }); scorable.push(target);
  }
  const summary: ScoringSummary = { targetCount: targets.length, scoredCount: rows.length, unscorableCount: targets.length - rows.length, reasons };
  return { rows, scorable, summary };
}
