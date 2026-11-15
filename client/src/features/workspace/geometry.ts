import type { Reading } from '../../shared/api/generated/wire';
export const POINT_LIMIT = 2000;
export function color(value: number, min: number, max: number) {
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  return `rgb(${Math.round(40 + 200 * t)}, ${Math.round(150 - 90 * t)}, ${Math.round(230 - 180 * t)})`;
}
// Equirectangular local projection, common XY scale; Z is normalized elapsed time.
export function cubePoints(rows: Reading[]) {
  if (!rows.length) return [];
  const lon = rows.map(r => r.location.coordinates[0]), lat = rows.map(r => r.location.coordinates[1]), ts = rows.map(r => Date.parse(r.ts));
  const midLon = (Math.min(...lon) + Math.max(...lon)) / 2, midLat = (Math.min(...lat) + Math.max(...lat)) / 2;
  const x = lon.map(v => (v - midLon) * Math.cos(midLat * Math.PI / 180)), y = lat.map(v => v - midLat);
  const span = Math.max(...x.map(Math.abs), ...y.map(Math.abs), 0.00001), start = Math.min(...ts), duration = Math.max(...ts) - start;
  return rows.map((_, i) => [x[i] / span, y[i] / span, duration ? (ts[i] - start) / duration * 2 - 1 : 0] as const);
}
export function latestPerSensor(rows: Reading[], selected?: string) {
  const bySensor = new Map<string, Reading>();
  for (const row of rows) { const previous = bySensor.get(row.sensorId); if (!previous || Date.parse(row.ts) > Date.parse(previous.ts) || (row.ts === previous.ts && row.id > previous.id)) bySensor.set(row.sensorId, row); }
  const chosen = rows.find(r => r.id === selected);
  if (chosen) bySensor.set(chosen.sensorId, chosen);
  return [...bySensor.values()];
}
