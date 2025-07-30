// @electron/regionMonitor.js
/**
 * @file regionMonitor.js
 * @summary A dedicated worker for finding UI regions on screen.
 * @description This file is the entry point for the region monitor worker. It delegates
 * all logic to the modules in the /region sub-directory for maintainability.
 */
import { workerData } from 'worker_threads';
import { start } from './region/core.js';
import { IS_RUNNING_INDEX } from './region/config.js';

start().catch((err) => {
  console.error(
    '[RegionMonitor] A fatal, unhandled error occurred during startup:',
    err,
  );
  try {
    const { sharedData } = workerData;
    if (sharedData?.syncSAB) {
      const syncArray = new Int32Array(sharedData.syncSAB);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX);
      console.log(
        '[RegionMonitor] Successfully signaled shutdown to other workers.',
      );
    } else {
      console.error(
        '[RegionMonitor] Could not signal shutdown: sharedData or syncSAB not available.',
      );
    }
  } catch (e) {
    console.error(
      '[RegionMonitor] An error occurred while trying to signal shutdown:',
      e,
    );
  }
  process.exit(1);
});
