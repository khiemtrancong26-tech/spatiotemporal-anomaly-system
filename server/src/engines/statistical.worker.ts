import { parentPort, workerData } from 'node:worker_threads';
import { runStatisticalAdapter } from './statistical.js';
import { onlineStatisticalPolicy } from './statistical.policy.js';

try {
  const result = runStatisticalAdapter(workerData, onlineStatisticalPolicy(workerData.method));
  parentPort!.postMessage(result);
} catch {
  parentPort!.postMessage({ error: 'ENGINE_OUTPUT_INVALID' });
}
