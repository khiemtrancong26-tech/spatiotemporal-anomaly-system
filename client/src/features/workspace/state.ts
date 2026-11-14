import type { AnalysisRun, Anomaly } from '../../shared/api/generated/wire';
import { createStore } from 'zustand/vanilla';
import type { Bbox } from '../../shared/data-source/types';

export interface WorkspaceFilters {
  sensorId?: string;
  bbox?: Bbox;
  from?: string;
  to?: string;
}
export type WorkspaceTab = 'visualization' | 'analysis' | 'anomalies';
export interface WorkspaceState {
  datasetId?: string;
  filters: WorkspaceFilters;
  tab: WorkspaceTab;
  selectedReadingId?: string;
  reviewDirty: boolean;
  setReviewDirty: (dirty: boolean) => void;
  resultRun?: AnalysisRun;
  anomalies: Anomaly[];
  setResults: (run?: AnalysisRun, anomalies?: Anomaly[]) => void;
  openDataset: (id: string) => void;
  applyFilters: (filters: WorkspaceFilters) => void;
  selectTab: (tab: WorkspaceTab) => void;
  selectReading: (id?: string) => void;
  clear: () => void;
}

/** A separate instance per application session; never persisted to browser storage. */
export function createWorkspaceStore() {
  return createStore<WorkspaceState>((set, get) => ({
    filters: {},
    tab: 'visualization',
    anomalies: [],
    reviewDirty: false,
    setReviewDirty: reviewDirty => set({ reviewDirty }),
    setResults: (resultRun, anomalies = []) => set({ resultRun, anomalies }),
    openDataset(id) {
      if (!id.trim()) throw new TypeError('Dataset ID is required.');
      if (get().datasetId === id) return;
      set({ datasetId: id, filters: {}, selectedReadingId: undefined, tab: 'visualization', resultRun: undefined, anomalies: [], reviewDirty: false });
    },
    applyFilters(filters) {
      set({ filters: { ...filters, bbox: filters.bbox ? [...filters.bbox] as Bbox : undefined }, selectedReadingId: undefined });
    },
    selectTab: (tab) => set({ tab }),
    selectReading: (selectedReadingId) => set({ selectedReadingId }),
    clear: () => set({ datasetId: undefined, filters: {}, tab: 'visualization', selectedReadingId: undefined, resultRun: undefined, anomalies: [], reviewDirty: false }),
  }));
}
