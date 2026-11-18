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
import './app/styles.css';

const router = createRouter({ routeTree, defaultPreload: 'intent' });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

async function bootstrap() {
  const config = readConfig(import.meta.env);
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
  session.store.subscribe((next, previous) => { if (next.revision !== previous.revision) { try { sessionStorage.removeItem(`pm25.import.${config.mode}`); Object.keys(sessionStorage).filter(key => key.startsWith(`pm25.analysis.${config.mode}.`)).forEach(key => sessionStorage.removeItem(key)); } catch { /* Storage may be unavailable. */ } } });
  const guardedFetch: typeof fetch = async (input, init) => {
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
  } else void session.restore(online);
  const services: Services = {
    session, workspace, datasets, offline, data,
    config, mock, preview: createPreviewStore(),
    readingsCache: createReadingsCache(data.readings.list, undefined, offline?.isOffline),
  };
  createRoot(document.getElementById('root')!).render(<StrictMode><ServicesProvider services={services}><RouterProvider router={router} /></ServicesProvider></StrictMode>);
}
void bootstrap().catch(() => {
  const root = document.getElementById('root');
  if (root) root.textContent = 'Không thể khởi tạo ứng dụng. Kiểm tra cấu hình API (/api/v1), chế độ dữ liệu và public Mapbox token.';
});
