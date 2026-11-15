import type { Reading } from '../src/index.js';

export const base = [30, 32, 31, 29, 33, 30, 31, 32, 30, 31, 29, 32, 31, 30, 32, 31, 30, 29, 33, 31];

export function mk(sensorId: string, i: number, value: number, over: Partial<Reading> = {}): Reading {
  return {
    id: `${sensorId}-r${i}`,
    datasetId: 'dataset-001',
    sensorId,
    ts: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
    location: { type: 'Point', coordinates: [106.7009, 10.7769] },
    value,
    unit: 'ug/m3',
    ...over,
  };
}

export const series = (sensorId: string, values: number[]): Reading[] => values.map((v, i) => mk(sensorId, i, v));
