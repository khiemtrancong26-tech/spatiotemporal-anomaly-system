import { expect, it } from 'vitest';
import { buildPm25Features, selectPm25Neighbors, type FeaturePoint, type FeatureSensor } from '../src/features/pm25-v2.js';
const datasetId = 'dataset';
const sensors: FeatureSensor[] = ['A', 'B', 'C', 'D', 'E'].map((id, i) => ({ id, externalId: id, datasetId, location: { type: 'Point', coordinates: [i * .01, 0] } }));
const point = (sensorId: string, hour: number, value: number): FeaturePoint => ({ id: `${sensorId}-${hour}`, sensorId, datasetId, value, ts: new Date(Date.UTC(2015, 2, 1, hour)).toISOString() });
it('shares signed differences, fixed 3-neighbor graph and two-reading median without fourth-neighbor fallback', () => {
  const target = point('A', 2, 30), context = [point('A', 0, 10), point('B', 2, 20), point('C', 2, 40), point('E', 2, 9999)];
  const result = buildPm25Features(datasetId, [target], context, sensors);
  expect(result.rows).toEqual([{ readingId: target.id, values: [30, 20, 0] }]);
  expect(selectPm25Neighbors(datasetId, ['A'], sensors).get('A')).toEqual(['B', 'C', 'D']);
  expect(buildPm25Features(datasetId, [target], context.filter(p => p.sensorId !== 'C'), sensors).summary)
    .toMatchObject({ scoredCount: 0, unscorableCount: 1, reasons: { spatialOnly: 1 } });
  expect(buildPm25Features(datasetId, [target], context.filter(p => p.sensorId !== 'E'), sensors.slice(0, 3)).summary.reasons.spatialOnly).toBe(1);
});
it('partitions missing reasons without overlap; no future, stale, rounded-time, cross-dataset or synthetic context', () => {
  const targets = [point('A', 1, 10), point('B', 3, 20), point('E', 4, 30)];
  const r = buildPm25Features(datasetId, targets, [point('A', 2, 5)], sensors);
  expect(r.summary).toEqual({ targetCount: 3, scoredCount: 0, unscorableCount: 3, reasons: { temporalOnly: 0, spatialOnly: 0, both: 3 } });
  const target = point('A', 2, 30), peers = [point('B', 2, 10), point('C', 2, 20), point('D', 2, 60)];
  expect(buildPm25Features(datasetId, [target], peers, sensors).summary.reasons.temporalOnly).toBe(1);
  const prior = { ...point('A', 0, 10), ts: '2015-02-28T23:59:59.999Z' };
  expect(buildPm25Features(datasetId, [target], [prior, ...peers], sensors).summary.reasons.temporalOnly).toBe(1);
  const near = peers.map(p => ({ ...p, ts: '2015-03-01T02:00:00.001Z' }));
  expect(buildPm25Features(datasetId, [target], [point('A', 1, 20), ...near], sensors).summary.reasons.spatialOnly).toBe(1);
  expect(() => buildPm25Features(datasetId, [target], [{ ...peers[0]!, datasetId: 'other' }], sensors)).toThrow();
  expect(() => buildPm25Features(datasetId, [target, target], [], sensors)).toThrow();
  expect(() => buildPm25Features(datasetId, [target], [{ ...target, id: 'duplicate-slot' }], sensors)).toThrow();
});
it('does not let target selection change context graph; honors radius and stable externalId ties', () => {
  const a = point('A', 1, 40), b = point('B', 1, 30), context = [point('A', 0, 10), point('B', 0, 10), point('C', 1, 10), point('D', 1, 20)];
  expect(buildPm25Features(datasetId, [a], [b, ...context], sensors).rows[0]).toEqual(buildPm25Features(datasetId, [a, b], context, sensors).rows[0]);
  const far = sensors.map(s => s.id === 'D' || s.id === 'E' ? { ...s, location: { type: 'Point' as const, coordinates: [100, 0] as const } } : s);
  expect(buildPm25Features(datasetId, [a], [b, ...context], far).summary.reasons.spatialOnly).toBe(1);
  const tied = sensors.map(s => s.id === 'A' ? s : { ...s, location: { type: 'Point' as const, coordinates: [.01, 0] as const } });
  expect(selectPm25Neighbors(datasetId, ['A'], [...tied].reverse()).get('A')).toEqual(['B', 'C', 'D']);
});
