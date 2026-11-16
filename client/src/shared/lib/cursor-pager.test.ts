import { expect, it, vi } from 'vitest';
import { createCursorPager, type Page } from './cursor-pager';

const page = (ids: string[], nextCursor: string | null = null): Page<{ id: string }> => ({ data: ids.map((id) => ({ id })), page: { limit: 100, nextCursor } });
it('ignores a late response from an old dataset even if transport ignores abort', async () => {
  let resolveOld!: (value: Page<{ id: string }>) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(page(['new']));
  const pager = createCursorPager<{ id: string }, { datasetId: string; sort: string }>(load);
  const old = pager.setQuery({ datasetId: 'old', sort: 'ts:asc' });
  await pager.setQuery({ datasetId: 'new', sort: 'ts:desc' });
  resolveOld(page(['stale'], 'old-cursor')); await old;
  expect(pager.getSnapshot().data).toEqual([{ id: 'new' }]);
  expect(load.mock.calls[0][1].signal.aborted).toBe(true);
  expect(load.mock.calls[1][0].cursor).toBeUndefined();
});

it('deduplicates pages, preserves rows on load-more failure and retries the same cursor', async () => {
  const load = vi.fn().mockResolvedValueOnce(page(['a'], 'next')).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(page(['a', 'b']));
  const pager = createCursorPager<{ id: string }, { datasetId: string }>(load);
  await pager.setQuery({ datasetId: 'd' });
  await pager.loadMore();
  expect(pager.getSnapshot()).toMatchObject({ status: 'error', data: [{ id: 'a' }] });
  await pager.retry();
  expect(load.mock.calls[1][0].cursor).toBe('next');
  expect(load.mock.calls[2][0].cursor).toBe('next');
  expect(pager.getSnapshot().data).toEqual([{ id: 'a' }, { id: 'b' }]);
  await pager.loadMore(); expect(load).toHaveBeenCalledTimes(3);
});

it('resets cursor for changed sort/filter; identical queries do not refetch', async () => {
  const load = vi.fn().mockResolvedValue(page(['a'], 'next'));
  const pager = createCursorPager<{ id: string }, { datasetId: string; sort: string; sensorId?: string }>(load);
  await pager.setQuery({ datasetId: 'd', sort: 'ts:asc' });
  await pager.setQuery({ sort: 'ts:asc', datasetId: 'd' });
  expect(load).toHaveBeenCalledTimes(1);
  await pager.setQuery({ datasetId: 'd', sort: 'ts:desc', sensorId: 'sensor2' });
  expect(load.mock.calls[1][0].cursor).toBeUndefined();
  pager.dispose();
});
