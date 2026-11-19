import { describe, expect, it } from 'vitest';
import type { Reading, Sensor } from '../../../src/shared/api/generated/wire';
import { cubeProjection, cubeTime, hourlySegments, localCubeTime, parseCubeTime, pm25Color, sliceReadings, sliceSummary } from '../../../src/features/workspace/cube-data';

const row = (id: string, ts: string, value = 25, sensorId = 'A'): Reading => ({ id, datasetId: 'd', sensorId, ts, value, unit: 'ug/m3', location: { type: 'Point', coordinates: [116.3, 39.9] } });
const scope = { from: '2015-03-26T00:00:00+08:00', to: '2015-03-27T00:00:00+08:00' };
describe('Cube scientific/data invariants', () => {
  it('uses fixed RGB stops and clamps concentrations across all selections', () => {
    expect(pm25Color(-10)).toBe('#0D9488'); expect(pm25Color(370)).toBe('rgb(127, 29, 29)');
    expect(pm25Color(999)).toBe(pm25Color(370)); expect(pm25Color(25)).toBe('rgb(89, 208, 107)');
  });
  it('preserves the instant when changing display between Beijing and Vietnam', () => {
    const instant = '2015-03-26T21:00:00+08:00';
    expect(localCubeTime(instant, 8)).toBe('2015-03-26T21:00'); expect(localCubeTime(instant, 7)).toBe('2015-03-26T20:00');
    expect(parseCubeTime('2015-03-26T20:00', 7)).toBe(parseCubeTime('2015-03-26T21:00', 8));
    expect(cubeTime(instant, 8)).toContain('21:00'); expect(cubeTime(instant, 7)).toContain('20:00');
  });
  it('keeps space and elapsed-time positions when focusing a station or filtering anomalies', () => {
    const sensors = [{ location: { coordinates: [116.2, 39.8] } }, { location: { coordinates: [116.6, 40.1] } }] as Sensor[];
    const first = row('a', scope.from), last = row('b', scope.to), mid = row('m', '2015-03-26T12:00:00+08:00');
    const overview = cubeProjection([first, mid, last], sensors, scope), station = cubeProjection([mid], sensors, scope);
    expect(station.point(mid.location.coordinates, mid.ts)).toEqual(overview.point(mid.location.coordinates, mid.ts));
    expect(overview.z(first.ts)).toBe(-1); expect(overview.z(mid.ts)).toBe(0); expect(overview.z(last.ts)).toBe(1);
    expect(overview.point([116.6, 40.1], mid.ts)[0]).toBeGreaterThan(overview.point([116.2, 39.8], mid.ts)[0]);
    expect(overview.point([116.6, 40.1], mid.ts)[1]).toBeGreaterThan(overview.point([116.2, 39.8], mid.ts)[1]);
  });
  it('breaks lines at missing hours and never inserts a fabricated sample', () => {
    const rows = [row('17', '2015-03-26T17:00:00+08:00', 69), row('18', '2015-03-26T18:00:00+08:00', 84), row('21', '2015-03-26T21:00:00+08:00', 369)];
    expect(hourlySegments(rows).map(segment => segment.map(r => r.value))).toEqual([[69, 84], [369]]);
    expect(sliceReadings(rows, '2015-03-26T22:00:00+08:00')).toEqual([]);
  });
  it('publishes a slice mean only with full station metadata, complete pages and one sample per station', () => {
    const a = row('a', '2015-03-16T19:00:00+08:00', 300), b = row('b', a.ts, 331, 'B');
    expect(sliceSummary([a, b], ['A', 'B'], true).mean).toBe(315.5);
    expect(sliceSummary([a], ['A', 'B'], true).mean).toBeUndefined();
    expect(sliceSummary([a, b], ['A', 'B'], false).mean).toBeUndefined();
    expect(sliceSummary([a, a, b], ['A', 'B'], true).mean).toBeUndefined();
  });
});
