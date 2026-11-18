import { createReadingsCache, type ReadingsCache } from '../features/workspace/readings-cache';
import { createSession, type Session } from '../features/auth/session';
import { createWorkspaceStore } from '../features/workspace/state';
import type { Dataset } from '../shared/api/generated/wire';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { OnlineDataSource } from '../shared/data-source/types';
import type { MockControls } from '../mocks/transport';
import type { AppConfig } from './config';
import type { OfflineServices, OfflineState } from '../offline/services';

export interface PreviewState { role: 'analyst' | 'admin' }
export interface Services {
  readingsCache?: ReadingsCache;
  offline?: OfflineServices;
  session?: Session;
  workspace?: ReturnType<typeof createWorkspaceStore>;
  datasets?: Map<string, Dataset>;
  data: OnlineDataSource;
  config: AppConfig;
  mock?: MockControls;
  preview: ReturnType<typeof createPreviewStore>;
}
export function createPreviewStore() { return createStore<PreviewState>(() => ({ role: 'analyst' })); }
const Context = createContext<(Services & { session: Session; workspace: ReturnType<typeof createWorkspaceStore>; datasets: Map<string, Dataset>; readingsCache: ReadingsCache }) | null>(null);
export function ServicesProvider({ services, children }: PropsWithChildren<{ services: Services }>) {
  const [resolved] = useState(() => ({ ...services, readingsCache: services.readingsCache ?? createReadingsCache(services.data.readings.list), session: services.session ?? createSession(sessionStorage, 'pm25.test'), workspace: services.workspace ?? createWorkspaceStore(), datasets: services.datasets ?? new Map<string, Dataset>() }));
  useEffect(()=>resolved.session.store.subscribe((next,previous)=>{if(next.revision!==previous.revision) { resolved.readingsCache.clear(); resolved.workspace.getState().clear(); resolved.datasets.clear(); }}),[resolved]);
  return <Context.Provider value={resolved}>{children}</Context.Provider>;
}
export function useServices() {
  const services = useContext(Context);
  if (!services) throw new Error('ServicesProvider is missing.');
  return services;
}
export function usePreviewRole() {
  const { preview } = useServices();
  return useStore(preview, (state) => state.role);
}
const noOffline = createStore<OfflineState>(() => ({ offline: false, needsLogin: false, storageError: false, syncing: false,
  readingsRevision: 0, outbox: [], synced: {} }));
export function useOfflineState() {
  const { offline, session } = useServices();
  const state = useStore(offline?.store ?? noOffline);
  const localSession = useStore(session.store, value => value.status === 'offline');
  return { ...state, offline: state.offline || localSession };
}
