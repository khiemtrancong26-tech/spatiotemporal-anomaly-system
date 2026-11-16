import type { Reading, Sensor } from '../../shared/api/generated/wire';
import { explorationUtcTime } from '@pm25/shared-core';

export type CubeMode = 'overview' | 'station' | 'anomaly';
export type CubeScope = { from: string; to: string };
export const HOUR = 3600_000;
export const PM25_STOPS = [
  [0, '#0D9488'], [15, '#2DD4BF'], [35, '#84CC16'], [55, '#FACC15'],
  [100, '#FB923C'], [150, '#EF4444'], [250, '#B91C1C'], [370, '#7F1D1D'],
] as const;

export function pm25Color(value: number) {
  const v = Math.max(0, Math.min(370, value));
  const end = PM25_STOPS.findIndex(stop => stop[0] >= v);
  if (end <= 0) return PM25_STOPS[0][1];
  const [a, ac] = PM25_STOPS[end - 1], [b, bc] = PM25_STOPS[end];
  const rgb = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${[1, 3, 5].map(i => Math.round(rgb(ac, i) + (rgb(bc, i) - rgb(ac, i)) * (v - a) / (b - a))).join(', ')})`;
}

export function cubeTime(ts: string, offset = 7, short = false) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'UTC',
    ...(short ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { dateStyle: 'short', timeStyle: 'short' }),
  }).format(new Date(Date.parse(ts) + offset * HOUR));
}
export const localCubeTime = (ts: string, offset: number) => new Date(Date.parse(ts) + offset * HOUR).toISOString().slice(0, 16);
export const parseCubeTime = (local: string, offset: number) => {
  return explorationUtcTime(local, offset === 0 ? 'UTC' : offset === 8 ? '+08:00' : '+07:00');
};

/** A single spatial frame and explicit time domain shared by every presentation mode. */
export function cubeProjection(rows: Reading[], sensors: Sensor[], scope: CubeScope) {
  const coords = sensors.length ? sensors.map(s => s.location.coordinates) : rows.map(r => r.location.coordinates);
  const lon = coords.map(c => c[0]), lat = coords.map(c => c[1]);
  const west = lon.length ? Math.min(...lon) : 0, east = lon.length ? Math.max(...lon) : 0;
  const south = lat.length ? Math.min(...lat) : 0, north = lat.length ? Math.max(...lat) : 0;
  const midLon = (west + east) / 2, midLat = (south + north) / 2, cos = Math.cos(midLat * Math.PI / 180);
  const span = Math.max((east - west) * cos / 2, (north - south) / 2, .00001);
  const start = Date.parse(scope.from), duration = Math.max(1, Date.parse(scope.to) - start);
  const z = (ts: string) => (Date.parse(ts) - start) / duration * 2 - 1;
  const point = (coordinates: number[], ts: string) => [(coordinates[0] - midLon) * cos / span, (coordinates[1] - midLat) / span, z(ts)] as const;
  return { point, z, west, east, south, north, start, duration };
}

export function sliceReadings(rows: Reading[], ts?: string) {
  return ts ? rows.filter(r => Math.abs(Date.parse(r.ts) - Date.parse(ts)) <= HOUR / 2) : [];
}
export function stationStats(rows: Reading[]) {
  if (!rows.length) return undefined;
  const values = rows.map(r => r.value);
  return { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length };
}
/** Segment on elapsed time, so missing samples never become a continuous trend. */
export function hourlySegments(rows: Reading[]) {
  const sorted = [...rows].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const segments: Reading[][] = [];
  for (const row of sorted) {
    const last = segments.at(-1);
    if (!last || Date.parse(row.ts) - Date.parse(last.at(-1)!.ts) > HOUR) segments.push([row]);
    else last.push(row);
  }
  return segments;
}

export function sliceSummary(rows: Reading[], expectedSensorIds: string[], complete: boolean) {
  const ids = new Set(rows.map(r => r.sensorId));
  const full = complete && expectedSensorIds.length > 0 && expectedSensorIds.every(id => ids.has(id)) && rows.length === ids.size;
  return { count: ids.size, mean: full ? stationStats(rows)?.mean : undefined };
}

export function linkedCubeScope(ts:string,filters:{from?:string;to?:string},previous?:CubeScope,durationMs?:number):CubeScope {
 const lower=filters.from?Date.parse(filters.from):-Infinity,upper=filters.to?Date.parse(filters.to):Infinity;
 const t=Math.min(upper,Math.max(lower,Date.parse(ts)));
 if(previous&&Date.parse(previous.from)<=t&&Date.parse(previous.to)>=t&&Date.parse(previous.from)>=lower&&Date.parse(previous.to)<=upper)return previous;
 const duration=durationMs??(previous?Date.parse(previous.to)-Date.parse(previous.from)+1:24*HOUR);
 return {from:new Date(Math.max(lower,t-duration/2)).toISOString(),to:new Date(Math.min(upper,t+duration/2-1)).toISOString()};
}
