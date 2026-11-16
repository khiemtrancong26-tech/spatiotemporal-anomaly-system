import { expect, it } from 'vitest';
import { createWorkspaceStore } from './state';
import { parseWorkspaceFilters, vietnamTimeToUtc } from './filters';
import { formatWorkspaceTime } from './time';

it('keeps linked visual context independently of focus filtering, and clears it across datasets/sessions',()=>{
 const s=createWorkspaceStore();s.getState().openDataset('a');
 s.getState().setVisualTime('2020-01-01T12:00:00.000Z');s.getState().focusSensor('station');s.getState().selectReading('reading');
 s.getState().setCubeScope({from:'2020-01-01T00:00:00.000Z',to:'2020-01-01T23:59:59.999Z'});
 s.getState().selectTab('analysis');s.getState().setTimeZone('UTC');s.getState().selectTab('visualization');
 expect(s.getState()).toMatchObject({filters:{},visualTime:'2020-01-01T12:00:00.000Z',focusedSensorId:'station',selectedReadingId:'reading',cubeWindowMs:86400_000});
 s.getState().openDataset('b');expect(s.getState().visualTime).toBeUndefined();expect(s.getState().cubeScope).toBeUndefined();expect(s.getState().focusedSensorId).toBeUndefined();
 s.getState().setVisualTime('2020-01-01T12:00:00.000Z');s.getState().clear();expect(s.getState().visualTime).toBeUndefined();
});

it('keeps filters across tabs, resets selection on filtering and clears scope on dataset change', () => {
  const store = createWorkspaceStore();
  store.getState().openDataset('dataset-a');
  store.getState().applyFilters({ sensorId: 'sensor-a' });
  store.getState().selectReading('reading-a');
  store.getState().selectTab('analysis');
  expect(store.getState().filters.sensorId).toBe('sensor-a');
  expect(store.getState().selectedReadingId).toBe('reading-a');
  store.getState().applyFilters({ sensorId: 'sensor-b' });
  expect(store.getState().selectedReadingId).toBeUndefined();
  store.getState().openDataset('dataset-b');
  expect(store.getState()).toMatchObject({ datasetId: 'dataset-b', filters: {}, tab: 'visualization' });
  store.getState().clear();
  expect(store.getState().datasetId).toBeUndefined();
});

it('does not share workspace state between sessions', () => {
  const a = createWorkspaceStore();
  const b = createWorkspaceStore();
  a.getState().openDataset('private-dataset');
  expect(b.getState().datasetId).toBeUndefined();
});

it('uses one workspace timezone without changing applied instants, selection or a review draft', () => {
  const s = createWorkspaceStore(); s.getState().openDataset('a');
  const filters = parseWorkspaceFilters({ sensorId: '', bbox: '', from: '2015-03-01T00:00', to: '2015-03-01T00:00' }, '+08:00');
  s.getState().applyFilters(filters); s.getState().selectReading('reading'); s.getState().setReviewDirty(true);
  s.getState().setTimeZone('UTC');
  expect(s.getState()).toMatchObject({ timeZone: 'UTC', timeZoneChosen: true, filters, selectedReadingId: 'reading', reviewDirty: true });
  expect(filters.from).toBe('2015-02-28T16:00:00.000Z');
  expect(formatWorkspaceTime(filters.from!, '+08:00')).toContain('00:00'); expect(formatWorkspaceTime(filters.from!, 'UTC')).toContain('16:00');
  s.getState().openDataset('b'); expect(s.getState()).toMatchObject({ timeZone: '+07:00', timeZoneChosen: false });
});

it('converts Vietnam local time across UTC day boundaries and rejects normalized invalid dates', () => {
  expect(vietnamTimeToUtc('2026-11-13T00:30')).toBe('2026-11-12T17:30:00.000Z');
  expect(vietnamTimeToUtc('2026-11-13T08:00:05')).toBe('2026-11-13T01:00:05.000Z');
  expect(() => vietnamTimeToUtc('2026-02-30T08:00')).toThrow();
  expect(() => vietnamTimeToUtc('2026-11-13T24:00')).toThrow();
});

it('rejects reversed time ranges and incomplete or reversed geographic bounds', () => {
  const input = { sensorId: '', bbox: '', from: '', to: '' };
  expect(parseWorkspaceFilters(input)).toEqual({ sensorId: undefined, bbox: undefined, from: undefined, to: undefined });
  expect(() => parseWorkspaceFilters({ ...input, bbox: '106,,107,11' })).toThrow();
  expect(() => parseWorkspaceFilters({ ...input, bbox: '107,10,106,11' })).toThrow();
  expect(() => parseWorkspaceFilters({ ...input, from: '2026-11-14T00:00', to: '2026-11-13T00:00' })).toThrow();
  expect(parseWorkspaceFilters({ ...input, bbox: '106,10,107,11' }).bbox).toEqual([106, 10, 107, 11]);
});
