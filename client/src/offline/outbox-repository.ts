import Dexie from 'dexie';
import type { Anomaly } from '../shared/api/generated/wire';
import { offlineDb, type OfflineReviewChanges, type OutboxRecord } from './database';

const REVIEW_STATUSES: readonly Anomaly['status'][] = ['open', 'confirmed', 'false_positive'];

function validateChanges(changes: OfflineReviewChanges): void {
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => key !== 'status' && key !== 'note')) {
    throw new TypeError('Mutation chỉ được thay đổi status và/hoặc note.');
  }
  if (changes.status !== undefined && !REVIEW_STATUSES.includes(changes.status)) {
    throw new TypeError('Review status không hợp lệ.');
  }
  if (changes.note !== undefined && typeof changes.note !== 'string') {
    throw new TypeError('Review note phải là chuỗi.');
  }
}

/**
 * Persist a local review before the caller reports it as saved.
 * A mutation that may already have reached the server is immutable and cannot be re-used with a new payload.
 */
export async function queueOfflineReviewMutation(
  ownerScope: string,
  anomalyId: string,
  changes: OfflineReviewChanges,
): Promise<Pick<OutboxRecord, 'clientMutationId' | 'anomalyId' | 'baseVersion' | 'changes' | 'createdAt'>> {
  if (!ownerScope.trim() || !anomalyId.trim()) throw new TypeError('Thiếu tài khoản hoặc anomaly ID.');
  validateChanges(changes);

  return offlineDb.transaction('rw', offlineDb.anomalies, offlineDb.outbox, async () => {
    const cached = await offlineDb.anomalies.get([ownerScope, anomalyId]);
    if (!cached) throw new Error('Anomaly chưa có trong IndexedDB; không thể chỉnh sửa offline.');

    const existingMutations = await offlineDb.outbox
      .where('[ownerScope+anomalyId]')
      .equals([ownerScope, anomalyId])
      .toArray();
    const unresolved = existingMutations.find((mutation) => mutation.state !== 'pending');
    if (unresolved) {
      throw new Error('Review này đang có conflict/rejected chưa được xử lý. Hãy giải quyết mutation cũ trước.');
    }
    const existing = existingMutations.find((mutation) => mutation.state === 'pending');

    let mutation: OutboxRecord;
    if (existing) {
      if (existing.attempts > 0) {
        throw new Error('Mutation này đã từng được gửi. Hãy đồng bộ hoặc xử lý kết quả trước khi sửa tiếp.');
      }
      mutation = {
        ...existing,
        changes: { ...existing.changes, ...changes },
        lastError: undefined,
      };
    } else {
      mutation = {
        ownerScope,
        clientMutationId: crypto.randomUUID(),
        anomalyId,
        baseVersion: cached.data.version,
        changes,
        createdAt: new Date().toISOString(),
        attempts: 0,
        state: 'pending',
      };
    }

    await offlineDb.outbox.put(mutation);
    const data = { ...cached.data, ...changes };
    await offlineDb.anomalies.put({ ...cached, data, status: data.status, note: data.note, reviewSyncState: 'pending' });

    return {
      clientMutationId: mutation.clientMutationId,
      anomalyId: mutation.anomalyId,
      baseVersion: mutation.baseVersion,
      changes: mutation.changes,
      createdAt: mutation.createdAt,
    };
  });
}

export async function listPendingOutbox(ownerScope: string): Promise<OutboxRecord[]> {
  return offlineDb.outbox
    .where('[ownerScope+state+createdAt]')
    .between([ownerScope, 'pending', Dexie.minKey], [ownerScope, 'pending', Dexie.maxKey])
    .toArray();
}

export async function recordOutboxAttempt(ownerScope: string, clientMutationId: string): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.outbox, async () => {
    const record = await offlineDb.outbox.get([ownerScope, clientMutationId]);
    if (!record || record.state !== 'pending') return;
    await offlineDb.outbox.put({
      ...record,
      attempts: record.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
    });
  });
}

export async function markOutboxOutcome(
  ownerScope: string,
  clientMutationId: string,
  state: 'conflict' | 'rejected',
  lastError: string,
): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.outbox, offlineDb.anomalies, async () => {
    const mutation = await offlineDb.outbox.get([ownerScope, clientMutationId]);
    if (!mutation || mutation.state !== 'pending') return;
    await offlineDb.outbox.put({ ...mutation, state, lastError });
    const anomaly = await offlineDb.anomalies.get([ownerScope, mutation.anomalyId]);
    if (anomaly) await offlineDb.anomalies.put({ ...anomaly, reviewSyncState: state });
  });
}

export async function listUnresolvedOutbox(ownerScope: string): Promise<OutboxRecord[]> {
  return offlineDb.outbox.where('ownerScope').equals(ownerScope).filter((record) => record.state !== 'pending').toArray();
}

/**
 * Acknowledge a mutation only after the server confirms
 * that it was applied or already processed (duplicate).
 *
 * The outbox deletion and cached anomaly update are atomic.
 */
export async function acknowledgeOutboxMutation(
  ownerScope: string,
  clientMutationId: string,
  serverAnomaly?: Anomaly,
): Promise<void> {
  await offlineDb.transaction(
    'rw',
    offlineDb.outbox,
    offlineDb.anomalies,
    async () => {
      const mutation = await offlineDb.outbox.get([
        ownerScope,
        clientMutationId,
      ]);

      if (!mutation || mutation.state !== 'pending') return;

      if (
        serverAnomaly &&
        serverAnomaly.id !== mutation.anomalyId
      ) {
        throw new TypeError(
          'Server anomaly ID does not match the acknowledged mutation.',
        );
      }

      const anomaly = await offlineDb.anomalies.get([
        ownerScope,
        mutation.anomalyId,
      ]);

      await offlineDb.outbox.delete([
        ownerScope,
        clientMutationId,
      ]);

      if (!anomaly) return;

      const remaining = await offlineDb.outbox
        .where('[ownerScope+anomalyId]')
        .equals([ownerScope, mutation.anomalyId])
        .toArray();

      const unresolved = remaining.find(
        (record) => record.state !== 'pending',
      );

      const stillPending = remaining.some(
        (record) => record.state === 'pending',
      );

      const nextReviewSyncState =
        unresolved?.state ??
        (stillPending ? 'pending' : undefined);

      const nextData = serverAnomaly ?? anomaly.data;

      await offlineDb.anomalies.put({
        ...anomaly,
        ...(serverAnomaly ?? {}),
        ownerScope,
        cachedAt: new Date().toISOString(),
        data: nextData,
        reviewSyncState: nextReviewSyncState,
      });
    },
  );
}
