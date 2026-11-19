import { expect, it, vi } from 'vitest';
import type { Reading } from '../../../src/shared/api/generated/wire';
import { resolveInvestigation, type InvestigationTarget } from '../../../src/features/workspace/investigation';
import { createWorkspaceStore } from '../../../src/features/workspace/state';
import { aggregatePath } from '../../../src/features/workspace/exploration-chart';
import { ANALYSIS_REPLAY_MS, canReplay } from '../../../src/features/analysis/intent';

const target: InvestigationTarget = { datasetId: 'd', analysisRunId: 'run', anomalyId: 'a', readingId: 'exact', sensorId: 's', ts: '2015-03-26T13:00:00.000Z', location: { type: 'Point', coordinates: [116.3, 39.9] }, preferredMode: 'cube' };
const reading = (id = 'exact') => ({ id, datasetId: 'd', sensorId: 's', ts: target.ts, value: 369, unit: 'ug/m3', location: target.location } as Reading);
it('resolves the exact identity on a later page and preserves the query instant', async () => {
  const load = vi.fn().mockResolvedValueOnce({ data: [reading('other')], page: { limit: 100, nextCursor: 'next' } }).mockResolvedValueOnce({ data: [reading()], page: { limit: 100, nextCursor: null } });
  expect(await resolveInvestigation(load, target, new AbortController().signal)).toEqual(reading());
  expect(load.mock.calls[1][0]).toMatchObject({ datasetId: 'd', sensorId: 's', from: target.ts, to: target.ts, cursor: 'next', limit: 100 });
});
it('rejects nearby readings, foreign identity and unresolved partial scope', async () => {
  const page = (data: Reading[], nextCursor: string | null = null) => ({ data, page: { limit: 100, nextCursor } });
  await expect(resolveInvestigation(vi.fn().mockResolvedValue(page([reading('nearby')])), target, new AbortController().signal)).rejects.toThrow('Không tìm thấy');
  await expect(resolveInvestigation(vi.fn().mockResolvedValue(page([{ ...reading(), sensorId: 'foreign' }])), target, new AbortController().signal)).rejects.toThrow('không khớp');
  const load = vi.fn().mockImplementation(async () => page(Array.from({ length: 100 }, () => reading('other')), `cursor-${load.mock.calls.length}`));
  await expect(resolveInvestigation(load, target, new AbortController().signal)).rejects.toThrow('2.000'); expect(load).toHaveBeenCalledTimes(20);
});
it('restores filters, tab and exact selected reading after investigation and isolates datasets', () => {
  const store = createWorkspaceStore(); store.getState().openDataset('d'); store.getState().applyFilters({ from: '2015-03-01T00:00:00.000Z' }); store.getState().openAnomalies('run', 'a');
  store.getState().investigate(target); store.getState().applyFilters({ sensorId: 's', from: target.ts, to: target.ts }); store.getState().selectReading('exact'); store.getState().returnFromInvestigation();
  expect(store.getState()).toMatchObject({ filters: { from: '2015-03-01T00:00:00.000Z' }, selectedReadingId: 'exact', tab: 'anomalies', anomalyContext: { runId: 'run', anomalyId: 'a' } });
  expect(() => store.getState().investigate({ ...target, datasetId: 'foreign' })).toThrow();
  store.getState().openDataset('other'); expect(store.getState().anomalyContext).toBeUndefined(); expect(store.getState().investigation).toBeUndefined();
});
it('hands off a comparison scope without creating a run or changing workspace filters', () => {
  const s = createWorkspaceStore(); s.getState().openDataset('d'); s.getState().prepareAnalysis({ sensorIds: ['explicit'] }, 'chart');
  expect(s.getState()).toMatchObject({ filters: {}, tab: 'analysis', analysisDraft: { scope: { sensorIds: ['explicit'] } }, resultRun: undefined });
});
it('opens a new SVG segment at null buckets and never interpolates their value', () => {
  const buckets = [{ mean: 10 }, { mean: null }, { mean: 30 }, { mean: 40 }] as Parameters<typeof aggregatePath>[0];
  expect(aggregatePath(buckets, i => i, value => value)).toBe('M0,10  M2,30 L3,40');
});
it('replays the same intent only inside the server-confirmed 24-hour receipt window', () => {
  const intent = { key: 'key', body: { datasetId: 'd', family: 'statistical', method: 'zscore', config: { threshold: 3 } }, createdAt: 1000 } as const;
  expect(canReplay(intent, ANALYSIS_REPLAY_MS, 1000 + ANALYSIS_REPLAY_MS - 1)).toBe(true);
  expect(canReplay(intent, ANALYSIS_REPLAY_MS, 1000 + ANALYSIS_REPLAY_MS)).toBe(false);
  expect(canReplay(intent, ANALYSIS_REPLAY_MS, 999)).toBe(false);
});
