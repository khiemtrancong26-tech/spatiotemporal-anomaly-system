import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { expect, it } from 'vitest';
import manifest from './fixtures/beijing-12-stations-demo-2015-03.manifest.json' with { type: 'json' };

it('independently verifies the supplied Beijing golden bytes, station/time grid and descriptive events', async () => {
  const bytes = await readFile(new URL('./fixtures/beijing-12-stations-demo-2015-03.csv', import.meta.url));
  expect(bytes.length).toBe(manifest.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
  // Independent CSV facts, not production normalization/detector logic.
  const rows = parse(bytes, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  expect(Object.keys(rows[0]!)).toEqual(manifest.columns); expect(rows).toHaveLength(manifest.expected.readings);
  const stations = new Set<string>(), times = new Set<number>(), keys = new Set<string>(), coordinates = new Map<string, string>();
  const start = Date.parse(manifest.expected.utcFrom), end = Date.parse(manifest.expected.utcTo);
  for (const row of rows) {
    const id = row.sensorId!, ts = Date.parse(row.timestamp!), value = Number(row.value), lat = Number(row.latitude), lon = Number(row.longitude);
    expect(Number.isFinite(value) && value >= 0).toBe(true); expect(row.unit).toBe('ug/m3'); expect(row.timestamp).toMatch(/\+08:00$/);
    expect(Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180).toBe(true);
    expect(ts).toBeGreaterThanOrEqual(start); expect(ts).toBeLessThanOrEqual(end); expect((ts - start) % 3600000).toBe(0);
    const key = JSON.stringify([id, ts]); expect(keys.has(key)).toBe(false); keys.add(key); stations.add(id); times.add(ts);
    const point = JSON.stringify([lon, lat]); if (coordinates.has(id)) expect(coordinates.get(id)).toBe(point); coordinates.set(id, point);
    expect(row.sourceFile).toMatch(/^PRSA_Data_.+_20130301-20170228\.csv$/); expect(Number(row.sourceRowNo)).toBeGreaterThan(0);
  }
  expect([...stations].sort()).toEqual(manifest.expected.sensors); expect(times.size).toBe(manifest.expected.timestamps);
  expect(Math.min(...times)).toBe(start); expect(Math.max(...times)).toBe(end);
  expect(Math.min(...rows.map(r => Number(r.value)))).toBe(manifest.expected.minValue); expect(Math.max(...rows.map(r => Number(r.value)))).toBe(manifest.expected.maxValue);
  expect(manifest.expected.expectedStationHoursForThisMonth - keys.size).toBe(manifest.expected.missingStationHours);
  const eventA = rows.filter(r => Date.parse(r.timestamp!) === Date.parse(manifest.expected.eventA.sourceTime));
  expect(eventA).toHaveLength(12); expect(eventA.reduce((sum, r) => sum + Number(r.value), 0) / eventA.length).toBe(315.5);
  const eventB = rows.filter(r => Date.parse(r.timestamp!) === Date.parse(manifest.expected.eventB.sourceTime));
  expect(Number(eventB.find(r => r.sensorId === 'Nongzhanguan')!.value)).toBe(369);
  const others = eventB.filter(r => r.sensorId !== 'Nongzhanguan').map(r => Number(r.value)).sort((a, b) => a - b);
  expect(others).toHaveLength(11); expect(others[5]).toBe(80);
  for (const hour of ['22', '23']) expect(rows.some(r => r.sensorId === 'Nongzhanguan' && r.timestamp === `2015-03-26T${hour}:00:00+08:00`)).toBe(false);
});
