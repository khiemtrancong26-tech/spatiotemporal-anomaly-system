import { afterEach, expect, it, vi } from 'vitest';
import { followRun } from './follow-run';
import { canReplay, readIntent } from './intent';
import type { AnalysisRun } from '../../shared/api/generated/wire';
import fixtures from '../../../../docs/fixtures/frontend-online-examples.json';
const run = (fixtures.cases.find(c => c.id === 'analysis-detail')!.response as { data: AnalysisRun }).data;
afterEach(() => vi.useRealTimers());
it('serializes polls, backs off network failures and stops at terminal', async () => {
  vi.useFakeTimers(); const update = vi.fn(), error = vi.fn();
  const load = vi.fn().mockResolvedValueOnce({ ...run, status: 'queued' }).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(run);
  const follower = followRun({ load, update, error, interval: 3000, maxBackoff: 30000, random: () => 1 });
  await vi.advanceTimersByTimeAsync(3000); expect(error).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5999); expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(update).toHaveBeenLastCalledWith(run);
  await vi.advanceTimersByTimeAsync(60000); expect(load).toHaveBeenCalledTimes(3); follower.dispose();
});
it('ignores disposed late responses and never overlaps a pending request', async () => {
  let resolve!: (run: AnalysisRun) => void; const update = vi.fn(); const load = vi.fn(() => new Promise<AnalysisRun>(done => { resolve = done; }));
  const follower = followRun({ load, update, error: vi.fn(), interval: 3000, maxBackoff: 30000 });
  await follower.refresh(); expect(load).toHaveBeenCalledTimes(1); follower.dispose(); resolve(run); await Promise.resolve(); expect(update).not.toHaveBeenCalled();
});
it('pauses while hidden and resumes on explicit visibility refresh', async () => {
  vi.useFakeTimers(); let visible = false; const load = vi.fn().mockResolvedValue(run);
  const follower = followRun({ load, update: vi.fn(), error: vi.fn(), interval: 3000, maxBackoff: 30000, visible: () => visible });
  await vi.advanceTimersByTimeAsync(10000); expect(load).not.toHaveBeenCalled(); visible = true; await follower.refresh(); expect(load).toHaveBeenCalledTimes(1); follower.dispose();
});
it('preserves pending snapshot and refuses expired or unspecified replay windows', () => {
  const intent = { key: crypto.randomUUID(), body: { datasetId: 'd', family: 'ml', method: 'demo', config: {} }, createdAt: 1000 };
  expect(readIntent({ getItem: () => JSON.stringify(intent) }, 'k')).toEqual(intent);
  expect(canReplay(intent as never, undefined, 1001)).toBe(false); expect(canReplay(intent as never, 1000, 2000)).toBe(false); expect(canReplay(intent as never, 1000, 1999)).toBe(true);
  expect(readIntent({ getItem: () => '{broken' }, 'k')).toBeUndefined();
});
