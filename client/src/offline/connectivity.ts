import type { HealthResponse } from '../shared/api/generated/wire';

export type ConnectivityStatus = 'online' | 'degraded' | 'offline';

export interface ConnectivitySnapshot {
  status: ConnectivityStatus;
  consecutiveFailures: number;
  checkedAt?: string;
  backendStatus?: HealthResponse['status'];
  lastError?: unknown;
}

export interface ConnectivityService {
  getSnapshot(): ConnectivitySnapshot;
  subscribe(listener: () => void): () => void;
  check(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createConnectivityService(
  health: (options: { signal: AbortSignal }) => Promise<HealthResponse>,
  options: { intervalMs?: number; timeoutMs?: number; failureThreshold?: number } = {},
): ConnectivityService {
  const intervalMs = options.intervalMs ?? 12_000;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const failureThreshold = options.failureThreshold ?? 2;
  const listeners = new Set<() => void>();
  let snapshot: ConnectivitySnapshot = { status: 'degraded', consecutiveFailures: 0 };
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  let rerunRequested = false;
  let abort: AbortController | undefined;

  const publish = (next: ConnectivitySnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const onBrowserOffline = () => {
    abort?.abort();
    publish({ ...snapshot, status: 'offline', lastError: undefined });
  };

  const onBrowserOnline = () => {
    if (checking) {
      rerunRequested = true;
      return;
    }
    void check();
  };

  async function check(): Promise<void> {
    if (checking) return checking;
    checking = (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        publish({ ...snapshot, status: 'offline', lastError: undefined });
        return;
      }
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      try {
        const response = await health({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]) });
        if (controller.signal.aborted) return;
        const checkedAt = new Date().toISOString();
        if (response.status === 'ok') {
          publish({ status: 'online', consecutiveFailures: 0, checkedAt, backendStatus: response.status });
        } else {
          publish({ status: 'degraded', consecutiveFailures: 0, checkedAt, backendStatus: response.status });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const failures = snapshot.consecutiveFailures + 1;
        const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        publish({
          status: browserOffline || failures >= failureThreshold ? 'offline' : 'degraded',
          consecutiveFailures: failures,
          checkedAt: new Date().toISOString(),
          lastError: error,
        });
      }
    })().finally(() => {
      checking = undefined;
      if (rerunRequested) {
        rerunRequested = false;
        void check();
      }
    });
    return checking;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check,
    start() {
      if (timer) return;
      globalThis.addEventListener?.('offline', onBrowserOffline);
      globalThis.addEventListener?.('online', onBrowserOnline);
      void check();
      timer = setInterval(() => { void check(); }, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      abort?.abort();
      globalThis.removeEventListener?.('offline', onBrowserOffline);
      globalThis.removeEventListener?.('online', onBrowserOnline);
    },
  };
}
