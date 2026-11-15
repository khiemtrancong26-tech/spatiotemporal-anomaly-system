import type { Reading } from '../../shared/api/generated/wire';
import { color } from './geometry';
export const GRID_DEGREES = 0.02;
export function temporalCells(rows: Reading[]) {
  const cells = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const local = new Date(Date.parse(row.ts) + 7 * 3600_000).toISOString();
    const key = local.slice(0, 13);
    const previous = cells.get(key) ?? { sum: 0, count: 0 };
    cells.set(key, { sum: previous.sum + row.value, count: previous.count + 1 });
  }
  return [...cells].map(([key, value]) => ({ day: key.slice(0, 10), hour: Number(key.slice(11)), mean: value.sum / value.count, count: value.count }));
}
/** Display-only occupied grid; receives exactly the Mapbox points, never interpolates. */
export function spatialCells(rows: Reading[], min: number, max: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const bins = new Map<string, { x: number; y: number; sum: number; count: number }>();
  for (const row of rows) {
    const x = Math.min(8999, Math.floor(row.location.coordinates[0] / GRID_DEGREES));
    const y = Math.min(4499, Math.floor(row.location.coordinates[1] / GRID_DEGREES));
    const key = `${x}:${y}`, previous = bins.get(key) ?? { x, y, sum: 0, count: 0 };
    bins.set(key, { ...previous, sum: previous.sum + row.value, count: previous.count + 1 });
  }
  return { type: 'FeatureCollection', features: [...bins.values()].map(({ x, y, sum, count }) => {
    const w = x * GRID_DEGREES, s = y * GRID_DEGREES, e = w + GRID_DEGREES, n = s + GRID_DEGREES;
    return { type: 'Feature', properties: { mean: sum / count, count, color: color(sum / count, min, max) }, geometry: { type: 'Polygon', coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] } };
  }) };
}
