
import { createSession } from './features/auth/session';
import { createWorkspaceStore } from './features/workspace/state';
import type { Dataset } from './shared/api/generated/wire';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { readConfig } from './app/config';
import { ServicesProvider, createPreviewStore, type Services } from './app/services';
import { createOnlineDataSource } from './shared/data-source/online';
import { createOfflineServices } from './offline/services';
import { createReadingsCache } from './features/workspace/readings-cache';
import { installClientErrorHandlers, reportClientError } from './app/error-handling';
import './app/styles.css';

const removeErrorHandlers = installClientErrorHandlers(window);
import.meta.hot?.dispose(removeErrorHandlers);
const router = createRouter({ routeTree, defaultPreload: 'intent' });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

async function bootstrap(root: HTMLElement) {
  const loadedConfig = readConfig(import.meta.env);
  const config = {
    ...loadedConfig,
    apiBaseUrl: new URL(
      loadedConfig.apiBaseUrl,
      window.location.origin
    ).href.replace(/\/$/, ''),
  };

  let transport = globalThis.fetch.bind(globalThis);
  let mock: Services['mock'];
  // Keep this condition statically evaluable so online builds omit fixture transport.
  if ((import.meta.env.VITE_DATA_MODE ?? (import.meta.env.MODE === 'mock' ? 'mock' : 'online')) === 'mock') {
    const { createMockTransport } = await import('./mocks/transport');
    mock = { scenario: 'success', delayMs: 350, role: 'analyst' };
    transport = createMockTransport(mock);
  }
  const session = createSession(sessionStorage, `pm25.auth.${config.mode}`);
  const workspace = createWorkspaceStore();
  const datasets = new Map<string, Dataset>();
  session.store.subscribe((next, previous) => {
    if (next.revision === previous.revision) return;
    try {
      sessionStorage.removeItem(`pm25.import.${config.mode}`);
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith(`pm25.analysis.${config.mode}.`)) sessionStorage.removeItem(key);
      }
    } catch (error) { reportClientError('session-context-cleanup', error); }
  });
  const guardedFetch: typeof fetch = async (input, init) => {
    if (config.mode === 'online' && !navigator.onLine) throw new TypeError('Browser is offline');
    const sent = new Headers(init?.headers).get('Authorization');
    const authCheck = config.mode === 'online' && String(input).endsWith('/users/me');
    const signal = authCheck ? AbortSignal.any([AbortSignal.timeout(5000), ...(init?.signal ? [init.signal] : [])]) : init?.signal;
    const response = await transport(input, { ...init, signal });
    if (response.status === 401 && sent?.startsWith('Bearer ')) session.invalidate(sent.slice(7));
    return response;
  };
  const online = createOnlineDataSource({ baseUrl: config.apiBaseUrl, fetch: guardedFetch, getAccessToken: session.getToken, getSessionRevision: () => session.store.getState().revision });
  const offline = config.mode === 'online' ? createOfflineServices(new URL(config.apiBaseUrl).href.replace(/\/$/, ''), online, session, workspace) : undefined;
  const data = offline?.data ?? online;
  if (offline) {
    if (import.meta.env.PROD) {
      const shellFailed = () => offline.store.setState({ shellError: true });
      if (!('serviceWorker' in navigator)) shellFailed();
      else if (navigator.onLine || !navigator.serviceWorker.controller) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}offline-worker.js`).then(registration => {
        const worker = registration.installing;
        const check = () => { if (worker?.state === 'redundant' && !navigator.serviceWorker.controller) shellFailed(); };
        worker?.addEventListener('statechange', check);
        check();
      }).catch(() => { if (!navigator.serviceWorker.controller) shellFailed(); });
    }
    await offline.initialize();
    offline.start();
  } else await session.restore(online);
  const services: Services = {
    session, workspace, datasets, offline, data,
    config, mock, preview: createPreviewStore(),
    readingsCache: createReadingsCache(data.readings.list, undefined, offline?.isOffline),
  };
  createRoot(root, {
    onCaughtError: error => reportClientError('react-error-boundary', error),
    onUncaughtError: error => {
      reportClientError('react-root', error);
      root.textContent = 'Giao diện gặp sự cố. Vui lòng tải lại trang.';
    },
  }).render(<StrictMode><ServicesProvider services={services}><RouterProvider router={router} /></ServicesProvider></StrictMode>);
}
const root = document.getElementById('root');
if (root) {
  bootstrap(root).catch((error: unknown) => {
    reportClientError('startup', error);
    root.textContent = 'Không thể khởi tạo ứng dụng. Kiểm tra cấu hình API (/api/v1), chế độ dữ liệu và public Mapbox token.';
  });
} else reportClientError('startup', new Error('Application root is missing'));
