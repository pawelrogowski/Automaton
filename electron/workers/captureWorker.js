/**
 * @file captureWorker.js
 * @summary A dedicated worker for capturing screen frames from a specific window.
 * @description This file is the entry point for the capture worker. It delegates
 * all logic to the modules in the /capture sub-directory for maintainability.
 */

import { workerData } from 'worker_threads';
import { start } from './capture/core.js';
import { IS_RUNNING_INDEX } from './capture/config.js';

start().catch((err) => {
  console.error(
    '[CaptureWorker] A fatal, unhandled error occurred during startup:',
    err,
  );

  // Attempt to notify other workers that we are not running.
  // This is a "best effort" signal in case of a catastrophic startup failure.
  try {
    // workerData is available synchronously at the top level of a worker module.
    const { sharedData } = workerData;
    if (sharedData?.syncSAB) {
      const syncArray = new Int32Array(sharedData.syncSAB);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX);
      console.log(
        '[CaptureWorker] Successfully signaled shutdown to other workers.',
      );
    } else {
      console.error(
        '[CaptureWorker] Could not signal shutdown: sharedData or syncSAB not available.',
      );
    }
  } catch (e) {
    console.error(
      '[CaptureWorker] An error occurred while trying to signal shutdown:',
      e,
    );
  }

  process.exit(1);
});
