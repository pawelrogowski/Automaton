import { workerData } from 'worker_threads';
import { start } from './ocr/core.js';
import { IS_RUNNING_INDEX } from './ocr/config.js';

start().catch((err) => {
  console.error(
    '[OcrWorker] A fatal, unhandled error occurred during startup:',
    err,
  );

  try {
    const { sharedData } = workerData;
    if (sharedData?.syncSAB) {
      const syncArray = new Int32Array(sharedData.syncSAB);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX);
      console.log(
        '[OcrWorker] Successfully signaled shutdown to other workers.',
      );
    } else {
      console.error(
        '[OcrWorker] Could not signal shutdown: sharedData or syncSAB not available.',
      );
    }
  } catch (e) {
    console.error(
      '[OcrWorker] An error occurred while trying to signal shutdown:',
      e,
    );
  }

  process.exit(1);
});
