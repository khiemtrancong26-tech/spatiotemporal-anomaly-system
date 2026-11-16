import { describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { toSensorDto, type SensorDocument } from '../src/modules/query/query.mapping.js';
import { parseBbox, parseQueryTime } from '../src/modules/query/query.validation.js';
import { createQueryService } from '../src/modules/query/query.service.js';
import { createCursorCodec } from '../src/shared/pagination.js';
import type { QueryRepository, ReadingsQuery } from '../src/modules/query/query.types.js';
import type { DatasetReadAccess } from '../src/modules/datasets/index.js';
import { bboxCoveringCircle } from '../src/modules/query/query.repository.js';
import type { Bbox } from '../src/modules/query/query.types.js';

describe('B4 Sensor DTO mapping', () => {
  it('whitelists fields and preserves public string IDs, source externalId and lon/lat order', () => {
    const document = { _id: new ObjectId(), datasetId: new ObjectId(), externalId: 'SOURCE-A', name: 'Station A',
      location: { type: 'Point' as const, coordinates: [106, 10] as [number, number] }, type: 'pm25' as const, unit: 'ug/m3' as const,
      region: 'South', importAttemptId: 'private', sourceRowNumber: 12 };
    expect(toSensorDto(document)).toEqual({ id: document._id.toHexString(), datasetId: document.datasetId.toHexString(),
      externalId: 'SOURCE-A', name: 'Station A', location: { type: 'Point', coordinates: [106, 10] }, type: 'pm25', unit: 'ug/m3', region: 'South' });
    const withoutRegion: SensorDocument = { ...document }; delete withoutRegion.region;
    expect(toSensorDto(withoutRegion)).not.toHaveProperty('region');
    for (const coordinates of [[181, 0], [0, 91], [Number.NaN, 0]]) {
      expect(() => toSensorDto({ ...document, location: { type: 'Point', coordinates: coordinates as [number, number] } })).toThrow('WGS84');
    }
  });
});

describe('B4 query validation and service with explicit test doubles', () => {
  it('uses a conservative sphere prefilter that contains the rectangle, including polar/dateline/degenerate edges', () => {
    expect(bboxCoveringCircle([-180, -90, 180, 90])).toBeNull();
    const rectangles: Bbox[] = [[106, 10, 107, 11], [0, 0, 0, 0], [-180, -90, -179, -89], [179, 89, 180, 90], [-170, -1, 170, 1], [10, -80, 10, 80]];
    const rad = (degrees: number) => degrees * Math.PI / 180;
    for (const bbox of rectangles) {
      const cover = bboxCoveringCircle(bbox); expect(cover).not.toBeNull();
      if (!cover) throw new Error('Unexpected unbounded circle');
      for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) {
        const lon = bbox[0] + (bbox[2] - bbox[0]) * x / 10, lat = bbox[1] + (bbox[3] - bbox[1]) * y / 10;
        // Independent haversine distance, rather than repeating the path-length bound.
        const a = Math.sin(rad(lat - cover.center[1]) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(cover.center[1])) * Math.sin(rad(lon - cover.center[0]) / 2) ** 2;
        const distance = 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
        expect(distance).toBeLessThanOrEqual(cover.radius);
      }
    }
  });
  it('parses inclusive WGS84 rectangles, including points/lines/world, without wrapping or accepting malformed numbers', () => {
    expect(parseBbox(undefined)).toBeUndefined();
    for (const bbox of ['-180,-90,180,90', '106,10,106,10', '106,10,107,10', '106,10,106,11']) expect(parseBbox(bbox)).toEqual(bbox.split(',').map(Number));
    expect(parseBbox(' 1.06e2 , +10 ,107.0,11')).toEqual([106, 10, 107, 11]);
    for (const bbox of ['', '1,2,3', '1,2,3,4,5', '1,,3,4', 'NaN,0,1,1', 'Infinity,0,1,1', '0x10,0,20,1', '107,10,106,11', '106,11,107,10', '-181,0,0,0', '0,-91,0,0', '0,0,181,1', '0,0,1,91']) {
      expect(() => parseBbox(bbox)).toThrow(expect.objectContaining({ statusCode: 422, code: 'INVALID_BBOX' }));
    }
  });
  it('preserves exact UTC millisecond instants and rejects offsets, rollover and precision loss', () => {
    expect(parseQueryTime(undefined)).toBeUndefined();
    expect(parseQueryTime('2026-11-14T00:00:00Z')).toBe('2026-11-14T00:00:00.000Z');
    expect(parseQueryTime('2024-02-29T23:59:59.1Z')).toBe('2024-02-29T23:59:59.100Z');
    for (const time of ['2026-02-29T00:00:00Z', '2026-01-01T24:00:00Z', '2026-11-14T00:00:00.1234Z', '2026-11-14T07:00:00+07:00', '2026-11-14T00:00:00', 'bad']) {
      expect(() => parseQueryTime(time)).toThrow(expect.objectContaining({ statusCode: 422 }));
    }
  });
  function fixture() {
    const datasetId = new ObjectId().toHexString(), sensorId = new ObjectId().toHexString();
    const repository: QueryRepository = { resolveSensorBoundary: vi.fn(async (_dataset, after) => after),
      sensorIdInDataset: vi.fn(async () => sensorId), sensors: vi.fn(async () => []), readings: vi.fn(async () => []) };
    const datasets: DatasetReadAccess = { getState: vi.fn(async () => ({ id: datasetId, status: 'imported' as const })) };
    const codec = createCursorCodec('B4-test-only-cursor-secret-at-least-32-bytes');
    return { datasetId, sensorId, repository, datasets, codec, service: createQueryService(repository, datasets, codec) };
  }
  it('guards the parent and sensor reference before any query and keeps empty pages distinct from unavailable parents', async () => {
    const f = fixture();
    vi.mocked(f.datasets.getState).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: f.datasetId, status: 'importing' });
    await expect(f.service.sensors({ datasetId: 'opaque-unknown' })).rejects.toMatchObject({ statusCode: 422, code: 'DATASET_NOT_FOUND' });
    await expect(f.service.readings({ datasetId: f.datasetId })).rejects.toMatchObject({ statusCode: 422, code: 'DATASET_NOT_READY' });
    vi.mocked(f.repository.sensorIdInDataset).mockResolvedValueOnce(null);
    await expect(f.service.readings({ datasetId: f.datasetId, sensorId: 'other' })).rejects.toMatchObject({ statusCode: 422, code: 'SENSOR_NOT_IN_DATASET' });
    expect(f.repository.readings).not.toHaveBeenCalled(); expect(f.repository.sensors).not.toHaveBeenCalled();
    expect(await f.service.readings({ datasetId: f.datasetId })).toEqual({ data: [], page: { limit: 100, nextCursor: null } });
    expect(f.repository.readings).toHaveBeenCalledWith({ datasetId: f.datasetId, direction: 'asc', limit: 101 });
    await expect(f.service.readings({ datasetId: f.datasetId, from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' })).rejects.toMatchObject({ code: 'INVALID_TIME_RANGE' });
  });
  it('binds cursors to every filter/sort/operation and fetches only one extra row; canonical-equivalent filters can continue', async () => {
    const f = fixture(), base = { datasetId: f.datasetId, sensorId: f.sensorId, bbox: '106,10,107,11', from: '2026-11-14T00:00:00Z', to: '2026-11-14T01:00:00Z', limit: 1 };
    const reading = (id: string) => ({ id, datasetId: f.datasetId, sensorId: f.sensorId, ts: '2026-11-14T00:00:00.000Z',
      location: { type: 'Point' as const, coordinates: [106, 10] as [number, number] }, value: 0, unit: 'ug/m3' as const });
    vi.mocked(f.repository.readings).mockResolvedValueOnce([reading(new ObjectId().toHexString()), reading(new ObjectId().toHexString())]);
    const first = await f.service.readings(base), cursor = first.page.nextCursor!;
    expect(first.data).toHaveLength(1); expect(cursor).toBeTruthy();
    for (const changed of [{ bbox: '106,10,108,11' }, { from: '2026-11-14T00:00:01Z' }, { to: '2026-11-14T01:00:01Z' }, { sort: 'ts:desc' }]) {
      const query = { ...base, ...changed, cursor };
      await expect(f.service.readings(query)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    }
    const noSensor: ReadingsQuery = { ...base, cursor }; delete noSensor.sensorId;
    await expect(f.service.readings(noSensor)).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(f.service.sensors({ datasetId: f.datasetId, bbox: base.bbox, cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await f.service.readings({ ...base, bbox: '106.0,10.0,107.0,11.0', from: '2026-11-14T00:00:00.000Z', cursor, limit: 2 });
    expect(f.repository.readings).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 3, after: { id: first.data[0]!.id, key: '2026-11-14T00:00:00.000Z' } }));
  });
});
