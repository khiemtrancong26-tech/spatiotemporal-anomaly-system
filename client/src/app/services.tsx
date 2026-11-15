import { createSession, type Session } from '../features/auth/session';
import { createWorkspaceStore } from '../features/workspace/state';
import type { Dataset } from '../shared/api/generated/wire';
import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { OnlineDataSource } from '../shared/data-source/types';
import type { MockControls } from '../mocks/transport';
import type { AppConfig } from './config';

export interface PreviewState { role: 'analyst' | 'admin' }
export interface Services {
  session?: Session;
  workspace?: ReturnType<typeof createWorkspaceStore>;
  datasets?: Map<string, Dataset>;
  data: OnlineDataSource;
  config: AppConfig;
  mock?: MockControls;
  preview: ReturnType<typeof createPreviewStore>;
}
export function createPreviewStore() { return createStore<PreviewState>(() => ({ role: 'analyst' })); }
const Context = createContext<(Services & { session: Session; workspace: ReturnType<typeof createWorkspaceStore>; datasets: Map<string, Dataset> }) | null>(null);
export function ServicesProvider({ services, children }: PropsWithChildren<{ services: Services }>) {
  const [resolved] = useState(() => ({ ...services, session: services.session ?? createSession(sessionStorage, 'pm25.test'), workspace: services.workspace ?? createWorkspaceStore(), datasets: services.datasets ?? new Map<string, Dataset>() }));
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
