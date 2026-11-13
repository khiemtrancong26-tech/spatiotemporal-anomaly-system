import { expect, it } from 'vitest';
import { createWorkspaceStore } from './state';
import { parseWorkspaceFilters, vietnamTimeToUtc } from './filters';

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
