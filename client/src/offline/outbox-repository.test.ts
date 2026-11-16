
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anomaly } from '../shared/api/generated/wire';
import {
  offlineDb,
  type OutboxRecord,
} from './database';
import {
  acknowledgeOutboxMutation,
  listPendingOutbox,
  listUnresolvedOutbox,
  markOutboxOutcome,
  queueOfflineReviewMutation,
  recordOutboxAttempt,
} from './outbox-repository';

const OWNER = 'user-1';
const ANOMALY_ID = 'anomaly-1';
const MUTATION_ID = 'mutation-1';

function makeAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: ANOMALY_ID,
    datasetId: 'dataset-1',
    sensorId: 'sensor-1',
    readingId: 'reading-1',
    analysisRunId: 'analysis-1',
    ts: '2026-11-16T10:00:00.000Z',
    location: {
      type: 'Point',
      coordinates: [106.7, 10.8],
    },
    family: 'statistical',
    method: 'z_score',
    score: 3.5,
    severity: 'high',
    status: 'open',
    note: '',
    version: 1,
    updatedAt: '2026-11-16T10:00:00.000Z',
    ...overrides,
  };
}

function makeOutbox(
  overrides: Partial<OutboxRecord> = {},
): OutboxRecord {
  return {
    ownerScope: OWNER,
    clientMutationId: MUTATION_ID,
    anomalyId: ANOMALY_ID,
    baseVersion: 1,
    changes: { status: 'confirmed' },
    createdAt: '2026-11-16T10:01:00.000Z',
    attempts: 0,
    state: 'pending',
    ...overrides,
  };
}

async function seedAnomaly(anomaly = makeAnomaly()): Promise<void> {
  await offlineDb.anomalies.put({
    ...anomaly,
    ownerScope: OWNER,
    cachedAt: '2026-11-16T10:00:00.000Z',
    data: anomaly,
  });
}

async function seedMutation(
  overrides: Partial<OutboxRecord> = {},
): Promise<void> {
  const mutation = makeOutbox(overrides);

  await offlineDb.outbox.put(mutation);
}


beforeEach(async () => {
  await offlineDb.open();
  await offlineDb.transaction(
    'rw',
    [
      offlineDb.datasets,
      offlineDb.sensors,
      offlineDb.readings,
      offlineDb.analysisRuns,
      offlineDb.anomalies,
      offlineDb.coverage,
      offlineDb.outbox,
      offlineDb.workspace,
      offlineDb.meta,
    ],
    async () => {
      await Promise.all([
        offlineDb.datasets.clear(),
        offlineDb.sensors.clear(),
        offlineDb.readings.clear(),
        offlineDb.analysisRuns.clear(),
        offlineDb.anomalies.clear(),
        offlineDb.coverage.clear(),
        offlineDb.outbox.clear(),
        offlineDb.workspace.clear(),
        offlineDb.meta.clear(),
      ]);
    },
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await offlineDb.close();
});

describe('queueOfflineReviewMutation', () => {
  it('queues a review and optimistically updates the cached anomaly', async () => {
    await seedAnomaly();

    const result = await queueOfflineReviewMutation(
      OWNER,
      ANOMALY_ID,
      { status: 'confirmed', note: 'Đã kiểm tra' },
    );

    expect(result.anomalyId).toBe(ANOMALY_ID);
    expect(result.baseVersion).toBe(1);
    expect(result.changes).toEqual({
      status: 'confirmed',
      note: 'Đã kiểm tra',
    });
    expect(result.clientMutationId).toBeTruthy();

    const mutation = await offlineDb.outbox.get([
      OWNER,
      result.clientMutationId,
    ]);
    expect(mutation?.state).toBe('pending');
    expect(mutation?.attempts).toBe(0);

    const cached = await offlineDb.anomalies.get([
      OWNER,
      ANOMALY_ID,
    ]);
    expect(cached?.data.status).toBe('confirmed');
    expect(cached?.data.note).toBe('Đã kiểm tra');
    expect(cached?.reviewSyncState).toBe('pending');
  });

  it('merges changes into a pending mutation that has never been sent', async () => {
    await seedAnomaly();

    const first = await queueOfflineReviewMutation(
      OWNER,
      ANOMALY_ID,
      { status: 'confirmed' },
    );

    const second = await queueOfflineReviewMutation(
      OWNER,
      ANOMALY_ID,
      { note: 'Đã xác minh' },
    );

    expect(second.clientMutationId).toBe(first.clientMutationId);
    expect(second.changes).toEqual({
      status: 'confirmed',
      note: 'Đã xác minh',
    });

    expect(await offlineDb.outbox.count()).toBe(1);
  });

  it('does not allow changing a mutation after a send attempt', async () => {
    await seedAnomaly();
    const queued = await queueOfflineReviewMutation(
      OWNER,
      ANOMALY_ID,
      { status: 'confirmed' },
    );

    await recordOutboxAttempt(OWNER, queued.clientMutationId);

    await expect(
      queueOfflineReviewMutation(
        OWNER,
        ANOMALY_ID,
        { note: 'Thay đổi sau khi gửi' },
      ),
    ).rejects.toThrow('đã từng được gửi');

    const records = await offlineDb.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].attempts).toBe(1);
  });

  it('rejects a review when the anomaly is not cached', async () => {
    await expect(
      queueOfflineReviewMutation(
        OWNER,
        ANOMALY_ID,
        { status: 'confirmed' },
      ),
    ).rejects.toThrow('chưa có trong IndexedDB');
  });

  it('rejects unsupported review fields', async () => {
    await seedAnomaly();

    await expect(
      queueOfflineReviewMutation(
        OWNER,
        ANOMALY_ID,
        { status: 'confirmed', extra: 'invalid' } as never,
      ),
    ).rejects.toThrow('chỉ được thay đổi status');
  });

  it('does not queue another mutation while an unresolved conflict exists', async () => {
    await seedAnomaly();
    await seedMutation({ state: 'conflict' });

    await expect(
      queueOfflineReviewMutation(
        OWNER,
        ANOMALY_ID,
        { status: 'confirmed' },
      ),
    ).rejects.toThrow('conflict/rejected');
  });
});

describe('Outbox state transitions', () => {
  it('lists pending mutations only for the requested owner', async () => {
    await seedMutation();
    await seedMutation({
      clientMutationId: 'other-user-mutation',
      ownerScope: 'user-2',
    });

    const pending = await listPendingOutbox(OWNER);

    expect(pending).toHaveLength(1);
    expect(pending[0].clientMutationId).toBe(MUTATION_ID);
  });

  it('records an attempt for a pending mutation', async () => {
    await seedMutation();

    await recordOutboxAttempt(OWNER, MUTATION_ID);

    const mutation = await offlineDb.outbox.get([
      OWNER,
      MUTATION_ID,
    ]);

    expect(mutation?.attempts).toBe(1);
    expect(mutation?.lastAttemptAt).toBeTruthy();
  });

  it('marks a mutation as conflict and updates its cached anomaly', async () => {
    await seedAnomaly();
    await seedMutation();

    await markOutboxOutcome(
      OWNER,
      MUTATION_ID,
      'conflict',
      'Version không khớp',
    );

    const mutation = await offlineDb.outbox.get([
      OWNER,
      MUTATION_ID,
    ]);
    const anomaly = await offlineDb.anomalies.get([
      OWNER,
      ANOMALY_ID,
    ]);

    expect(mutation?.state).toBe('conflict');
    expect(mutation?.lastError).toBe('Version không khớp');
    expect(anomaly?.reviewSyncState).toBe('conflict');
  });

  it('lists unresolved conflict and rejected mutations', async () => {
    await seedMutation();
    await seedMutation({
      clientMutationId: 'rejected-mutation',
      state: 'rejected',
    });

    const unresolved = await listUnresolvedOutbox(OWNER);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].state).toBe('rejected');
  });
});

describe('acknowledgeOutboxMutation', () => {
  it('deletes an acknowledged pending mutation and stores server data', async () => {
    await seedAnomaly();
    await seedMutation();

    const serverAnomaly = makeAnomaly({
      status: 'confirmed',
      note: 'Đã đồng bộ',
      version: 2,
      updatedAt: '2026-11-16T10:05:00.000Z',
    });

    await acknowledgeOutboxMutation(
      OWNER,
      MUTATION_ID,
      serverAnomaly,
    );

    expect(
      await offlineDb.outbox.get([OWNER, MUTATION_ID]),
    ).toBeUndefined();

    const cached = await offlineDb.anomalies.get([
      OWNER,
      ANOMALY_ID,
    ]);

    expect(cached?.data.version).toBe(2);
    expect(cached?.data.note).toBe('Đã đồng bộ');
    expect(cached?.reviewSyncState).toBeUndefined();
  });

  it.each(['conflict', 'rejected'] as const)(
    'does not delete a %s mutation when acknowledged accidentally',
    async (state) => {
      await seedAnomaly();
      await seedMutation({ state });

      await acknowledgeOutboxMutation(
        OWNER,
        MUTATION_ID,
      );

      const mutation = await offlineDb.outbox.get([
        OWNER,
        MUTATION_ID,
      ]);

      expect(mutation?.state).toBe(state);
    },
  );

  it('rejects a server anomaly with a different ID without deleting the mutation', async () => {
    await seedAnomaly();
    await seedMutation();

    await expect(
      acknowledgeOutboxMutation(
        OWNER,
        MUTATION_ID,
        makeAnomaly({ id: 'another-anomaly' }),
      ),
    ).rejects.toThrow('does not match');

    expect(
      await offlineDb.outbox.get([OWNER, MUTATION_ID]),
    ).toBeDefined();
  });

  it('clears review sync state only after the final pending mutation is acknowledged', async () => {
    await seedAnomaly();

    await seedMutation();
    await seedMutation({
      clientMutationId: 'mutation-2',
      changes: { note: 'Second update' },
    });

    await offlineDb.anomalies.update(
      [OWNER, ANOMALY_ID],
      { reviewSyncState: 'pending' },
    );

    await acknowledgeOutboxMutation(OWNER, MUTATION_ID);

    let cached = await offlineDb.anomalies.get([
      OWNER,
      ANOMALY_ID,
    ]);
    expect(cached?.reviewSyncState).toBe('pending');

    await acknowledgeOutboxMutation(
      OWNER,
      'mutation-2',
    );

    cached = await offlineDb.anomalies.get([
      OWNER,
      ANOMALY_ID,
    ]);
    expect(cached?.reviewSyncState).toBeUndefined();
  });
});
