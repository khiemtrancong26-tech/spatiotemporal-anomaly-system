import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeOfflineDatabase, offlineDb } from './database';

afterEach(() => {
  vi.restoreAllMocks();
  offlineDb.close();
});

describe('initializeOfflineDatabase', () => {
  it('opens IndexedDB once when multiple bootstrap callers initialize concurrently', async () => {
    const open = vi.spyOn(offlineDb, 'open').mockResolvedValue(offlineDb);

    const first = initializeOfflineDatabase();
    const second = initializeOfflineDatabase();

    expect(first).toBe(second);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports an IndexedDB failure without rejecting application bootstrap', async () => {
    const failure = new Error('IndexedDB is unavailable');
    const open = vi.spyOn(offlineDb, 'open').mockRejectedValue(failure);
    const onError = vi.fn();

    await expect(initializeOfflineDatabase(onError)).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('allows a later retry after an earlier open failure', async () => {
    const open = vi.spyOn(offlineDb, 'open')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(offlineDb);

    await expect(initializeOfflineDatabase()).resolves.toBe(false);
    await expect(initializeOfflineDatabase()).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
