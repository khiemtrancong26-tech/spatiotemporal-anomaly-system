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
import { createOfflineDataSource } from './offline/data-source';
import { initializeOfflineDatabase } from './offline/database';
import { createConnectivityService } from './offline/connectivity';
import './app/styles.css';

const router = createRouter({ routeTree, defaultPreload: 'intent' });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

async function bootstrap() {
  await initializeOfflineDatabase((error) => {
    console.warn('[offline-db] IndexedDB không khả dụng; ứng dụng sẽ tiếp tục ở chế độ online-only khi cần.', error);
  });
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
  session.store.subscribe((next, previous) => { if (next.revision !== previous.revision) { workspace.getState().clear(); datasets.clear(); try { sessionStorage.removeItem(`pm25.import.${config.mode}`); Object.keys(sessionStorage).filter(key => key.startsWith(`pm25.analysis.${config.mode}.`)).forEach(key => sessionStorage.removeItem(key)); } catch { /* Storage may be unavailable. */ } } });
  const guardedFetch: typeof fetch = async (input, init) => {
    const sent = new Headers(init?.headers).get('Authorization');
    const response = await transport(input, init);
    if (response.status === 401 && sent?.startsWith('Bearer ')) session.invalidate(sent.slice(7));
    return response;
  };
  const onlineData = createOnlineDataSource({
    baseUrl: config.apiBaseUrl,
    fetch: guardedFetch,
    getAccessToken: session.getToken,
  });
  const data = createOfflineDataSource({
    online: onlineData,
    getOwnerScope: () => session.store.getState().user?.id,
    onCacheError: (error) => console.warn('[offline-cache] Không thể lưu dữ liệu cục bộ:', error),
  });
  const connectivity = createConnectivityService(({ signal }) => onlineData.health({ signal }));
  connectivity.start();

  const services: Services = {
    session, workspace, datasets,
    config, mock, connectivity, preview: createPreviewStore(), data,
  };
  void session.restore(services.data);
  createRoot(document.getElementById('root')!).render(<StrictMode><ServicesProvider services={services}><RouterProvider router={router} /></ServicesProvider></StrictMode>);
}
void bootstrap().catch(() => {
  const root = document.getElementById('root');
  if (root) root.textContent = 'Không thể khởi tạo ứng dụng. Kiểm tra cấu hình API (/api/v1), chế độ dữ liệu và public Mapbox token.';
});
