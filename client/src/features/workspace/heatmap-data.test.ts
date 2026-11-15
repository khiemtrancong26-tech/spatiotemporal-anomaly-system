import { describe, expect, it } from 'vitest';
import { spatialCells, temporalCells } from './heatmap-data';
import { color, latestPerSensor } from './geometry';
import type { Reading } from '../../shared/api/generated/wire';
const row = (id: string, value: number, ts = '2026-11-10T18:00:00Z', lon = 105.001, sensorId = 's1'): Reading => ({ id, value, ts, datasetId:'dataset-1', sensorId, location:{type:'Point',coordinates:[lon,21.001]}, unit:'ug/m3' } as Reading);
describe('display-only heatmap aggregation', () => {
  it('buckets UTC+07 day/hour across midnight and equivalent offsets, keeping counts and means', () => {
    expect(temporalCells([row('a',10),row('b',30,'2026-11-11T01:30:00+07:00'),row('c',0,'2026-11-10T16:59:59Z')])).toEqual([
      {day:'2026-11-11',hour:1,mean:20,count:2}, {day:'2026-11-10',hour:23,mean:0,count:1},
    ]);
    expect(temporalCells([])).toEqual([]);
  });
  it('only fills occupied cells, uses existing colors and respects latest/selected Mapbox points', () => {
    const rows = [row('old',10),row('new',50,'2026-11-10T19:00:00Z'),row('other',30,undefined,105.005,'s2'),row('far',70,undefined,106.005,'s3')];
    const grid = spatialCells(latestPerSensor(rows),10,70);
    expect(grid.features).toHaveLength(2);
    expect(grid.features[0].properties).toEqual({mean:40,count:2,color:color(40,10,70)});
    expect(spatialCells(latestPerSensor(rows,'old'),10,70).features[0].properties?.mean).toBe(20);
    expect(spatialCells([],0,0).features).toEqual([]);
  });
  it('keeps occupied polygons bounded at the date line and poles', () => {
    const r = row('edge',5,undefined,180); r.location.coordinates[1] = 90;
    const coords = spatialCells([r],5,5).features[0].geometry.coordinates[0];
    expect(coords.every(([x,y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90)).toBe(true);
    expect(coords[0]).toEqual(coords.at(-1));
  });
});
