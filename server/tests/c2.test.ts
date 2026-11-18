const actor = { id: '507f1f77bcf86cd799439011', role: 'admin' as const };
import { describe, expect, it, vi } from 'vitest';
import { coverage, createExplorationService, parseExplorationScope } from '../src/modules/exploration/exploration.service.js';
import type { ExplorationRepository } from '../src/modules/exploration/exploration.types.js';
import { ExplorationMetadataInputSchema, explorationUtcTime, explorationLocalTime } from '@pm25/shared-core';
import { loadTestConfig } from './helpers.js';
const id = 'a'.repeat(24);
const metadata = { version: null, timeZone: '+07:00' as const, source: 'fallback' as const, provenance: null, sampling: null };
describe('C2 deadline/admission, visibility and time policies', () => {
  it('bounds concurrent operations, aborts stalled work and releases every slot after deadline/client abort', async () => {
    vi.useFakeTimers();
    try {
      const repo: ExplorationRepository = { sensors: async () => [], groups: async () => [], dataset: async (_id, ctx) => new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('Cancelled test repository work')), { once: true });
      }) };
      const config = { ...loadTestConfig().exploration, timeoutMs: 50 }, service = createExplorationService(repo, config);
      const a = expect(service.profile(id, {}, undefined, actor)).rejects.toMatchObject({ statusCode: 503, code: 'EXPLORATION_TIMEOUT' });
      const b = expect(service.profile(id, {}, undefined, actor)).rejects.toMatchObject({ statusCode: 503 });
      await expect(service.profile(id, {}, undefined, actor)).rejects.toMatchObject({ code: 'EXPLORATION_BUSY' });
      await vi.advanceTimersByTimeAsync(51); await Promise.all([a, b]);
      repo.dataset = async () => ({ status: 'imported', metadata });
      expect((await service.profile(id, {}, undefined, actor)).data.dataset.readingCount).toBe(0);
      const abort = new AbortController(); abort.abort();
      await expect(service.profile(id, {}, abort.signal, actor)).rejects.toMatchObject({ code: 'EXPLORATION_TIMEOUT' });
      expect((await service.profile(id, {}, undefined, actor)).data.complete).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('maps Mongo query resource exhaustion and rechecks publication after aggregating', async () => {
    const repo: ExplorationRepository = { sensors: async () => [], groups: async () => { throw Object.assign(new Error('Query timed out'), { code: 50 }); }, dataset: async () => ({ status: 'imported', metadata }) };
    const service = createExplorationService(repo, loadTestConfig().exploration);
    await expect(service.profile(id, {}, undefined, actor)).rejects.toMatchObject({ statusCode: 503 });
    repo.groups = async () => []; repo.dataset = vi.fn().mockResolvedValueOnce({ status: 'imported', metadata }).mockResolvedValueOnce({ status: 'failed', metadata });
    await expect(service.profile(id, {}, undefined, actor)).rejects.toMatchObject({ code: 'DATASET_NOT_READY' });
  });
  it('handles offset boundaries, invalid local calendars and mathematically explicit missing slots', () => {
    const utc = explorationUtcTime('2015-03-01T00:00', '+08:00'); expect(utc).toBe('2015-02-28T16:00:00.000Z');
    expect(explorationLocalTime(utc, 'UTC')).toBe('2015-02-28T16:00:00'); expect(explorationLocalTime(utc, '+07:00')).toBe('2015-02-28T23:00:00');
    expect(() => explorationUtcTime('2015-02-30T00:00', '+08:00')).toThrow();
    expect(ExplorationMetadataInputSchema.safeParse({ timeZone: '+08:00', provenance: 'explicit', sampling: { cadenceSeconds: 3600, anchor: utc, expectedFrom: utc, expectedTo: '2015-02-28T16:00:00Z' } }).success).toBe(true);
    expect(coverage({ cadenceSeconds: 3600, anchor: utc, expectedFrom: utc, expectedTo: '2015-02-28T18:00:00.000Z' }, 4, 3, 2)).toMatchObject({ expectedSlots: 6, observedSlots: 3, missingSlots: 3, unexpectedReadings: 1, ratio: 0.5 });
    expect(() => parseExplorationScope({ sensorIds: [] })).toThrow(); expect(() => parseExplorationScope({ bbox: ' ,0,1,1' })).toThrow();
    expect(() => loadTestConfig({ EXPLORATION_MAX_SERIES: '21' })).toThrow();
  });
});
