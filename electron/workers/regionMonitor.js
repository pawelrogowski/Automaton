// @electron/regionMonitor.js
import { workerData } from 'worker_threads';
import { start } from './region/core.js';
import { IS_RUNNING_INDEX } from './region/config.js';

start().catch((err) => {
  console.error('[RegionMonitor] Fatal error:', err);
  try {
    const { sharedData } = workerData;
    if (sharedData?.syncSAB) {
      const syncArray = new Int32Array(sharedData.syncSAB);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX);
    }
  } catch (e) {
    console.error('[RegionMonitor] Error signaling shutdown:', e);
  }
  process.exit(1);
});
