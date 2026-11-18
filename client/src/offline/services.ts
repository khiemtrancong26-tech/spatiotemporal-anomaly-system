import { createStore } from 'zustand/vanilla';
import type { Session } from '../features/auth/session';
import type { createWorkspaceStore } from '../features/workspace/state';
import type { Anomaly, DatasetPage, ReviewChanges, UserPublic } from '../shared/api/generated/wire';
import { DataSourceError, errorMessage } from '../shared/api/errors';
import type { OnlineDataSource, ReadingsQuery } from '../shared/data-source/types';
import { cachedAnomalies, cachedReadings, createCachedDataSource, unavailable } from './data';
import { createOfflineStorage, type OutboxItem, type WorkspaceSnapshot } from './storage';

export interface OfflineState {
  offline: boolean;
  needsLogin: boolean;
  storageError: boolean;
  shellError?: boolean;
  syncing: boolean;
  syncError?: string;
  readingsRevision: number;
  outbox: OutboxItem[];
  synced: Record<string, Anomaly>;
  lastWorkspace?: WorkspaceSnapshot;
}

export function createOfflineServices(namespace: string, api: OnlineDataSource, session: Session, workspace: ReturnType<typeof createWorkspaceStore>) {
  const storage = createOfflineStorage(namespace);
  const identityKey = `pm25.offline.identity:${namespace}`;
  const store = createStore<OfflineState>(() => ({ offline: !navigator.onLine, needsLogin: false, storageError: false, syncing: false,
    readingsRevision: 0, outbox: [], synced: {} }));
  const account = () => {
    const { status, user, revision } = session.store.getState();
    return user && (status === 'authenticated' || status === 'offline') ? { id: user.id, revision } : undefined;
  };
  const same = (user?: ReturnType<typeof account>) => Boolean(user && account()?.id === user.id && account()?.revision === user.revision);
  const storageFailed = () => store.setState({ storageError: true });
  const isOffline = () => store.getState().offline || session.store.getState().status === 'offline';
  const connectionLost = () => store.setState({ offline: true });
  const data = createCachedDataSource(api, storage, { account, isOffline, connectionLost, storageFailed,
    readingsStored: () => store.setState(state => ({ readingsRevision: state.readingsRevision + 1 })),
  });
  let probe: Promise<boolean> | undefined;
  let syncing = false, checking = false, retryAt = 0, retryDelay = 5000;
  let lastSnapshot = '';
  const timeout = () => AbortSignal.timeout(5000);

  function rememberedUser(): UserPublic | undefined {
    try {
      const user = JSON.parse(localStorage.getItem(identityKey) ?? 'null') as UserPublic | null;
      return user?.id && user.username && user.isActive === true && ['analyst', 'admin'].includes(user.role) ? user : undefined;
    } catch { return undefined; }
  }
  function forget(id?: string) {
    try {
      if (id && rememberedUser()?.id === id) localStorage.removeItem(identityKey);
      sessionStorage.removeItem(identityKey);
    } catch { storageFailed(); }
  }
  function tabOwner() {
    try { return sessionStorage.getItem(identityKey) ?? undefined; }
    catch { storageFailed(); return undefined; }
  }
  function checkBackend() {
    if (!navigator.onLine) { connectionLost(); return Promise.resolve(false); }
    if (probe) return probe;
    probe = api.health({ signal: timeout() }).then(health => health.status === 'ok', () => false).then(ready => {
      store.setState({ offline: !ready });
      return ready;
    }).finally(() => { probe = undefined; });
    return probe;
  }

  async function refreshOutbox() {
    const user = account();
    if (!user) return [];
    const items = await storage.outbox(user.id);
    if (!same(user)) return [];
    store.setState({ outbox: items });
    return items;
  }

  async function cacheSynced(user: string, anomaly: Anomaly) {
    try { await storage.put(user, 'anomaly', anomaly.datasetId, { id: anomaly.id }, anomaly); }
    catch { storageFailed(); }
  }

  async function latest(item: OutboxItem) {
    const server = await api.anomalies.get(item.anomalyId, { signal: timeout() });
    if (server.id !== item.anomalyId || server.datasetId !== item.datasetId) throw new Error('Anomaly không khớp dataset đã lưu.');
    return server;
  }

  async function sync(alreadyVerified = false) {
    const user = account();
    if (!user || isOffline() || !session.getToken() || syncing || Date.now() < retryAt || !api.pushReviews) return;
    syncing = true;
    try {
      const pending = (await refreshOutbox()).filter(item => item.state === 'pending');
      if (!pending.length || !same(user)) return;
      store.setState({ syncing: true, syncError: undefined });
      if (!alreadyVerified && !await session.verify(api, timeout())) return;
      for (const item of pending) {
        if (!same(user) || isOffline()) break;
        const { anomalyId, clientMutationId, baseVersion, changes, createdAt } = item;
        const { results } = await api.pushReviews({ mutations: [{ clientMutationId, anomalyId, baseVersion, changes, createdAt }] }, { signal: timeout() });
        if (!same(user)) break;
        const [result] = results;
        if (results.length !== 1 || result.clientMutationId !== clientMutationId) throw new Error('Kết quả đồng bộ không khớp bản lưu.');
        if (result.outcome === 'applied' || result.outcome === 'duplicate') {
          const server = result.anomaly ?? await latest(item);
          if (server.id !== anomalyId || server.datasetId !== item.datasetId || server.version <= baseVersion)
            throw new Error('Phiên bản đã đồng bộ không hợp lệ.');
          if (!same(user)) break;
          await cacheSynced(user.id, server);
          await storage.settle(item);
          if (same(user)) store.setState(state => ({ synced: { ...state.synced, [server.id]: server } }));
        } else if (result.outcome === 'conflict') {
          const conflict: OutboxItem = { ...item, state: 'conflict' };
          await storage.settle(item, conflict);
          try {
            const server = await latest(item);
            if (same(user)) {
              await cacheSynced(user.id, server);
              await storage.settle(conflict, { ...conflict, server });
            }
          } catch (error) {
            if (unavailable(error)) connectionLost();
          }
        } else {
          await storage.settle(item, { ...item, state: 'error', message: result.error?.error.message });
        }
      }
      retryAt = 0;
      retryDelay = 5000;
    } catch (error) {
      if (unavailable(error)) connectionLost();
      if (same(user)) store.setState({ syncError: errorMessage(error) });
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(30000, retryDelay * 2);
    } finally {
      syncing = false;
      if (same(user)) store.setState({ syncing: false });
      await refreshOutbox().catch(storageFailed);
    }
  }

  async function check() {
    if (checking || syncing || !account()) return;
    checking = true;
    const user = account();
    try {
      if (!await checkBackend() || !same(user)) return;
      if (!session.getToken()) { store.setState({ needsLogin: true }); return; }
      let verified = false;
      if (session.store.getState().status === 'offline') {
        verified = await session.verify(api, timeout());
        if (!verified) return;
      }
      store.setState({ needsLogin: false });
      await sync(verified);
    } catch (error) {
      if (unavailable(error)) connectionLost();
      else if (same(user)) store.setState({ needsLogin: true });
    } finally { checking = false; }
  }

  async function restoreWorkspace(user: NonNullable<ReturnType<typeof account>>) {
    try {
      const snapshot = await storage.workspace(user.id);
      if (!same(user) || !snapshot) return;
      store.setState({ lastWorkspace: snapshot });
      const { path, ...state } = snapshot;
      if (location.pathname === new URL(path, location.origin).pathname && (!workspace.getState().datasetId || workspace.getState().datasetId === state.datasetId))
        workspace.setState(state);
    } catch { storageFailed(); }
  }

  function rememberWorkspace() {
    const user = account();
    const { datasetId, filters, tab, timeZone, timeZoneChosen, visualMode, cubeMode, cubeCamera, cubeRunId,
      visualTime, cubeScope, cubeWindowMs, focusedSensorId, anomalyContext } = workspace.getState();
    if (!user || !datasetId || location.pathname !== `/workspace/${encodeURIComponent(datasetId)}`) return;
    const snapshot = { datasetId, filters, tab, timeZone, timeZoneChosen, visualMode, cubeMode, cubeCamera, cubeRunId, visualTime, cubeScope, cubeWindowMs,
      focusedSensorId, anomalyContext, path: location.pathname + location.search };
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    void storage.saveWorkspace(user.id, snapshot).then(() => {
      if (same(user) && lastSnapshot === serialized) store.setState({ lastWorkspace: snapshot });
    }).catch(storageFailed);
  }

  function makeMutation(userId: string, base: Anomaly, changes: ReviewChanges): OutboxItem {
    if (!Number.isSafeInteger(base.version) || base.version < 1 || !base.id || !base.datasetId ||
        (changes.note === undefined && changes.status === undefined) ||
        (changes.note !== undefined && typeof changes.note !== 'string') ||
        (changes.status !== undefined && !['open', 'confirmed', 'false_positive'].includes(changes.status)))
      throw new Error('Đánh giá không hợp lệ hoặc chưa có version từ Server.');
    return { userId, datasetId: base.datasetId, anomalyId: base.id, baseVersion: base.version, base, changes,
      clientMutationId: crypto.randomUUID(), createdAt: new Date().toISOString(), state: 'pending' };
  }

  session.store.subscribe((next, previous) => {
    if (next.status === 'authenticated' && (previous.status !== 'authenticated' || next.revision !== previous.revision) && next.user) {
      const oldId = rememberedUser()?.id;
      try {
        localStorage.setItem(identityKey, JSON.stringify(next.user));
        sessionStorage.setItem(identityKey, next.user.id);
      } catch { storageFailed(); }
      if (oldId && oldId !== next.user.id) void storage.clearCache(oldId).catch(storageFailed);
      if (next.revision !== previous.revision) {
        lastSnapshot = '';
        retryAt = 0;
        store.setState({ offline: !navigator.onLine, needsLogin: false, outbox: [], synced: {}, lastWorkspace: undefined, syncError: undefined, syncing: false });
      } else store.setState({ needsLogin: false });
      void refreshOutbox().catch(storageFailed);
      if (previous.user && previous.user.id !== next.user.id) workspace.getState().clear();
      const user = account();
      if (user) void restoreWorkspace(user);
      void check();
    }
    if (next.revision !== previous.revision && next.status === 'anonymous') {
      const previousId = previous.user?.id ?? tabOwner();
      forget(previousId);
      lastSnapshot = '';
      retryAt = 0;
      store.setState({ outbox: [], synced: {}, syncing: false, syncError: undefined, needsLogin: false, lastWorkspace: undefined });
      if (previousId) void storage.clearCache(previousId).catch(storageFailed);
    }
  });
  workspace.subscribe(rememberWorkspace);

  return {
    data, store, isOffline, checkBackend, rememberWorkspace,
    openDataset(id: string) {
      if (workspace.getState().datasetId === id) return;
      const snapshot = store.getState().lastWorkspace;
      if (snapshot?.datasetId === id) {
        const { path: _, ...state } = snapshot;
        workspace.setState(state);
      } else workspace.getState().openDataset(id);
    },
    async initialize() {
      const remembered = rememberedUser();
      if (session.getToken()) {
        await session.restore(api);
        const state = session.store.getState();
        if (state.status === 'error' && remembered && unavailable(state.error) && tabOwner() === remembered.id) {
          connectionLost();
          session.useOffline(remembered);
        }
      } else if (remembered && !await checkBackend()) {
        session.useOffline(remembered);
      }
      const user = account();
      if (user) await Promise.all([restoreWorkspace(user), refreshOutbox().catch(storageFailed)]);
    },
    start() {
      window.addEventListener('offline', connectionLost);
      window.addEventListener('online', () => { retryAt = 0; void check(); });
      window.addEventListener('storage', event => {
        const user = account();
        if (event.key === identityKey && user && rememberedUser()?.id !== user.id) session.logout();
      });
      window.setInterval(() => { if (!document.hidden) void check(); }, 10000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
      void check();
    },
    async coverage(query: ReadingsQuery) {
      const user = account();
      if (!user) return;
      try {
        const entries = await storage.list(user.id, 'readings', query.datasetId);
        if (same(user)) {
          const { rows, pages, coverage } = cachedReadings(entries, query);
          return { count: rows.length, pages, coverage };
        }
      } catch { storageFailed(); }
    },
    async dataset(id: string) {
      const user = account();
      if (!user) return;
      try {
        const pages = await storage.list(user.id, 'datasets', '');
        if (same(user)) return pages.flatMap(entry => (entry.value as DatasetPage).data).find(item => item.id === id);
      } catch { storageFailed(); }
    },
    async enqueue(base: Anomaly, changes: ReviewChanges) {
      const user = account();
      if (!user) throw new Error('Cần phiên đã đăng nhập để lưu đánh giá.');
      try {
        const cached = (await cachedAnomalies(storage, user.id, base.datasetId)).find(item => item.id === base.id);
        if (!same(user) || !cached || cached.version < base.version)
          throw new DataSourceError('offline', 'Chưa lưu được phiên bản anomaly này trong IndexedDB.');
        await storage.enqueue(makeMutation(user.id, base, changes));
        await refreshOutbox();
        void check();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'ConstraintError') {
          await refreshOutbox().catch(storageFailed);
          throw new Error('Anomaly này đã có một đánh giá trong Outbox.');
        }
        if (error instanceof DataSourceError) throw error;
        storageFailed();
        throw new Error('Không lưu được đánh giá trong IndexedDB. Bản sửa vẫn đang mở.');
      }
    },
    async compare(item: OutboxItem) {
      const user = account();
      if (!user || user.id !== item.userId || !await checkBackend() || !same(user) || !await session.verify(api, timeout()))
        throw new Error('Cần kết nối Backend và đăng nhập để đọc bản Server.');
      const server = await latest(item);
      if (!same(user)) return;
      await cacheSynced(user.id, server);
      await storage.settle(item, { ...item, server });
      await refreshOutbox();
    },
    async resolve(item: OutboxItem, reapply: boolean) {
      const user = account();
      if (!user || user.id !== item.userId || item.state === 'pending') return;
      if (reapply && !item.server) return;
      const replacement = reapply && item.server ? makeMutation(user.id, item.server, item.changes) : undefined;
      await storage.settle(item, replacement);
      await refreshOutbox();
      if (replacement) void check();
    },
    async logout() {
      const user = account();
      if (!user) { session.logout(); return; }
      const items = await refreshOutbox().catch(() => undefined);
      if (!same(user)) return;
      if ((!items || items.length) && !window.confirm('Có thể còn đánh giá chưa đồng bộ. Đăng xuất và giữ Outbox cho tài khoản này?')) return;
      session.logout();
    },
  };
}

export type OfflineServices = ReturnType<typeof createOfflineServices>;
