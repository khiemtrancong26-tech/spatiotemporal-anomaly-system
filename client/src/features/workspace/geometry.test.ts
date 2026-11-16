import { describe, expect, it } from 'vitest';
import { cubePoints, latestPerSensor, POINT_LIMIT } from './geometry';
import type { Reading } from '../../shared/api/generated/wire';
const row = (id: string, lon: number, lat: number, ts: string): Reading => ({ id, datasetId: 'd', sensorId: 's', ts, location: { type: 'Point', coordinates: [lon, lat] }, value: 25, unit: 'ug/m3' });
describe('shared visual coordinates', () => {
  it('preserves east/north and chronological direction including offset timestamps', () => {
    const points = cubePoints([row('a', 105, 20, '2026-01-01T07:00:00+07:00'), row('b', 106, 21, '2026-01-01T01:00:00Z')]);
    expect(points[0][0]).toBeLessThan(points[1][0]); expect(points[0][1]).toBeLessThan(points[1][1]); expect(points.map(p => p[2])).toEqual([-1, 1]);
  });
  it('handles a single location/time without NaN', () => expect(cubePoints([row('a', 105, 21, '2026-01-01T00:00:00Z')])).toEqual([[0, 0, 0]]));
  it('chooses newest per station regardless of page order and honors selected historical point', () => {
    const rows = [row('b', 105, 21, '2026-01-02T00:00:00Z'), row('a', 105, 21, '2026-01-01T00:00:00Z')];
    expect(latestPerSensor(rows).map(r => r.id)).toEqual(['b']); expect(latestPerSensor(rows, 'a').map(r => r.id)).toEqual(['a']);
  });
  it('measures bounded geometry preparation without a machine-dependent timing assertion', () => {
    const rows = Array.from({ length: POINT_LIMIT }, (_, i) => row(String(i), 105 + i / 10000, 21, new Date(i * 1000).toISOString()));
    const start = performance.now(); const points = cubePoints(rows);
    console.info(`M4 ${POINT_LIMIT} points: ${(performance.now() - start).toFixed(2)}ms; position + color Float32 buffers: ${POINT_LIMIT * 3 * 4 * 2} bytes`);
    expect(points).toHaveLength(POINT_LIMIT); expect(points.every(p => p.every(Number.isFinite))).toBe(true);
  });
});
