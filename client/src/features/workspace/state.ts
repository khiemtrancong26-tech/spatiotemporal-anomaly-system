import type { AnalysisRun, Anomaly, Reading } from '../../shared/api/generated/wire';
import { createStore } from 'zustand/vanilla';
import type { Bbox } from '../../shared/data-source/types';
import type { ExplorationTimeZone } from '@pm25/shared-core';
import type { AnalysisScope } from './analyst';
import type { InvestigationTarget } from './investigation';

export interface WorkspaceFilters {
  sensorId?: string;
  bbox?: Bbox;
  from?: string;
  to?: string;
}
export type WorkspaceTab = 'exploration' | 'visualization' | 'analysis' | 'anomalies';
export interface WorkspaceState {
  datasetId?: string;
  filters: WorkspaceFilters;
  visualReading?: Reading;
  rememberVisualReading:(reading:Reading)=>void;
  visualTime?: string;
  focusedSensorId?: string;
  cubeScope?: {from:string;to:string};
  cubeWindowMs?:number;
  setVisualTime: (ts:string)=>void;
  focusSensor: (id?:string)=>void;
  setCubeScope: (scope:{from:string;to:string},durationMs?:number)=>void;
  tab: WorkspaceTab;
  timeZone: ExplorationTimeZone;
  timeZoneChosen: boolean;
  setTimeZone: (zone: ExplorationTimeZone, chosen?: boolean) => void;
  selectedReadingId?: string;
  analysisDraft?: { scope: AnalysisScope; source: string; revision: number };
  prepareAnalysis: (scope: AnalysisScope, source: string) => void;
  anomalyContext?: { runId?: string; anomalyId?: string; review?: boolean; revision: number };
  openAnomalies: (runId?: string, anomalyId?: string, review?: boolean) => void;
  investigation?: { target: InvestigationTarget; returnFilters: WorkspaceFilters; returnTab: WorkspaceTab };
  investigate: (target: InvestigationTarget) => void;
  returnFromInvestigation: () => void;
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
    rememberVisualReading:visualReading=>set({visualReading}),
    setVisualTime: visualTime=>set({visualTime}),
    focusSensor: focusedSensorId=>set({focusedSensorId}),
    setCubeScope: (cubeScope,durationMs)=>set({cubeScope,cubeWindowMs:durationMs??Date.parse(cubeScope.to)-Date.parse(cubeScope.from)+1}),
    timeZone: '+07:00', timeZoneChosen: false,
    setTimeZone: (timeZone, chosen = true) => set({ timeZone, timeZoneChosen: chosen }),
    tab: 'visualization',
    anomalies: [],
    reviewDirty: false,
    setReviewDirty: reviewDirty => set({ reviewDirty }),
    prepareAnalysis: (scope, source) => set({ analysisDraft: { scope: structuredClone(scope), source, revision: (get().analysisDraft?.revision ?? 0) + 1 }, tab: 'analysis' }),
    openAnomalies: (runId, anomalyId, review = false) => set({ anomalyContext: { runId, anomalyId, review, revision: (get().anomalyContext?.revision ?? 0) + 1 }, tab: 'anomalies' }),
    investigate(target) {
      if (target.datasetId !== get().datasetId) throw new Error('Không thể dùng lựa chọn từ dataset khác.');
      set({ investigation: { target, returnFilters: structuredClone(get().filters), returnTab: get().tab }, selectedReadingId: undefined, visualTime:target.ts, focusedSensorId:target.sensorId, tab: 'visualization' });
    },
    returnFromInvestigation() {
      const current = get().investigation; if (!current) return;
      set({ filters: current.returnFilters, tab: current.returnTab, selectedReadingId: current.target.readingId, investigation: undefined });
    },
    setResults: (resultRun, anomalies = []) => set({ resultRun, anomalies }),
    openDataset(id) {
      if (!id.trim()) throw new TypeError('Dataset ID is required.');
      if (get().datasetId === id) return;
      set({ datasetId: id, filters: {}, visualTime:undefined,visualReading:undefined,focusedSensorId:undefined,cubeScope:undefined,cubeWindowMs:undefined, timeZone: '+07:00', timeZoneChosen: false, selectedReadingId: undefined, tab: 'visualization', resultRun: undefined, anomalies: [], reviewDirty: false, analysisDraft: undefined, anomalyContext: undefined, investigation: undefined });
    },
    applyFilters(filters) {
      set({ filters: { ...filters, bbox: filters.bbox ? [...filters.bbox] as Bbox : undefined }, selectedReadingId: undefined });
    },
    selectTab: (tab) => set({ tab }),
    selectReading: (selectedReadingId) => set({ selectedReadingId }),
    clear: () => set({ datasetId: undefined, filters: {}, visualTime:undefined,visualReading:undefined,focusedSensorId:undefined,cubeScope:undefined,cubeWindowMs:undefined, timeZone: '+07:00', timeZoneChosen: false, tab: 'visualization', selectedReadingId: undefined, resultRun: undefined, anomalies: [], reviewDirty: false, analysisDraft: undefined, anomalyContext: undefined, investigation: undefined }),
  }));
}
