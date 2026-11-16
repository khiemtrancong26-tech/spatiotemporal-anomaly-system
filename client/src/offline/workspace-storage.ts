import { offlineDb, type StoredWorkspaceSnapshot } from './database';
import type { WorkspaceState } from '../features/workspace/state';

export async function loadWorkspaceSnapshot(ownerScope: string, datasetId: string): Promise<StoredWorkspaceSnapshot | undefined> {
  return offlineDb.workspace.get([ownerScope, datasetId]);
}

export async function saveWorkspaceSnapshot(
  ownerScope: string,
  state: Pick<WorkspaceState, 'datasetId' | 'filters' | 'tab' | 'selectedReadingId'>,
): Promise<void> {
  if (!ownerScope || !state.datasetId) return;
  const snapshot: StoredWorkspaceSnapshot = {
    ownerScope,
    datasetId: state.datasetId,
    savedAt: new Date().toISOString(),
    filters: {
      ...(state.filters.sensorId ? { sensorId: state.filters.sensorId } : {}),
      ...(state.filters.bbox ? { bbox: [...state.filters.bbox] as [number, number, number, number] } : {}),
      ...(state.filters.from ? { from: state.filters.from } : {}),
      ...(state.filters.to ? { to: state.filters.to } : {}),
    },
    tab: state.tab,
    ...(state.selectedReadingId ? { selectedReadingId: state.selectedReadingId } : {}),
  };
  await offlineDb.workspace.put(snapshot);
}
