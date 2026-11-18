import type { ReviewConfig } from '../../config.js';
import { createCapacity } from '../../shared/import-capacity.js';

/** Locally reduce retries on the shared dataset fence. MongoDB still arbitrates across processes. */
export function createDatasetWriteScheduler(config: ReviewConfig) {
  const lanes = new Map<string, { capacity: ReturnType<typeof createCapacity>; users: number }>();
  let scheduled = 0;
  return async function schedule<T>(datasetId: string, work: () => Promise<T>): Promise<T> {
    if (!config.maxWaitingPerDataset || scheduled >= config.maxScheduled) return work();
    let lane = lanes.get(datasetId);
    if (!lane) {
      lane = { capacity: createCapacity(1, config.maxWaitingPerDataset), users: 0 };
      lanes.set(datasetId, lane);
    }
    lane.users++;
    scheduled++;
    const release = lane.capacity.acquire() ?? await lane.capacity.acquireOrWait(AbortSignal.timeout(config.waitMs));
    try {
      // Saturation falls through to the original transaction path and its driver deadline.
      if (release) return await work();
    } finally {
      release?.();
      scheduled--;
      if (--lane.users === 0) lanes.delete(datasetId);
    }
    return work();
  };
}

export type DatasetWriteScheduler = ReturnType<typeof createDatasetWriteScheduler>;
