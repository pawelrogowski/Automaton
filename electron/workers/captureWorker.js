// @captureWorker.js

/**
 * @file captureWorker.js
 * @summary A dedicated worker for capturing screen frames from a specific window.
 * It uses a native C++ module for high-performance screen capture via X11 and SHM.
 * The captured frame data and metadata (like dirty regions) are written to
 * SharedArrayBuffers to be consumed by other workers with minimal overhead.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import X11RegionCapture from 'x11-region-capture-native';

// --- Worker Configuration ---
const { sharedData, display } = workerData;

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[CaptureWorker] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const imageBuffer = Buffer.from(imageSAB);

// --- MODIFIED: Added indices for dirty regions ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4;
const DIRTY_REGION_COUNT_INDEX = 5; // New!
const DIRTY_REGIONS_START_INDEX = 6; // New!
const MAX_DIRTY_REGIONS = 64; // Must match workerManager.js
// --- END MODIFICATION ---

const captureInstance = X11RegionCapture
  ? new X11RegionCapture.X11RegionCapture(display)
  : null;
let targetFps = 30;
let isCapturing = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureLoop() {
  if (!captureInstance) {
    console.error(
      '[CaptureWorker] X11 native module is not available. Cannot start capture.',
    );
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  const windowId = Atomics.load(syncArray, WINDOW_ID_INDEX);
  if (!windowId) {
    console.error(
      '[CaptureWorker] No Window ID provided. Cannot start capture.',
    );
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  try {
    captureInstance.startMonitorInstance(windowId, targetFps);
    isCapturing = true;
    console.log(
      `[CaptureWorker] Started monitoring window: ${windowId} at ${targetFps} FPS.`,
    );
  } catch (err) {
    console.error(
      '[CaptureWorker] Failed to start native capture instance:',
      err,
    );
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  Atomics.store(syncArray, IS_RUNNING_INDEX, 1);

  while (Atomics.load(syncArray, IS_RUNNING_INDEX) === 1) {
    const loopStartTime = performance.now();

    try {
      const frameResult = captureInstance.getLatestFrame(imageBuffer);

      if (frameResult?.success) {
        // --- MODIFIED: Write dirty regions to syncSAB ---
        // This block must execute BEFORE the frame counter is incremented to ensure data consistency.
        const numRegions = frameResult.changedRegions.length;
        const regionsToWrite = Math.min(numRegions, MAX_DIRTY_REGIONS);

        // Log the regions for debugging if needed
        if (regionsToWrite > 0) {
          // console.log(
          //   `[CaptureWorker] Frame has ${regionsToWrite} dirty regions.`
          // );
        }

        Atomics.store(syncArray, DIRTY_REGION_COUNT_INDEX, regionsToWrite);

        for (let i = 0; i < regionsToWrite; i++) {
          const rect = frameResult.changedRegions[i];
          const offset = DIRTY_REGIONS_START_INDEX + i * 4;
          Atomics.store(syncArray, offset + 0, rect.x);
          Atomics.store(syncArray, offset + 1, rect.y);
          Atomics.store(syncArray, offset + 2, rect.width);
          Atomics.store(syncArray, offset + 3, rect.height);
        }
        // --- END MODIFICATION ---

        // Update shared metadata for consumers.
        Atomics.store(syncArray, WIDTH_INDEX, frameResult.width);
        Atomics.store(syncArray, HEIGHT_INDEX, frameResult.height);

        // Increment the frame counter and notify all waiting consumer workers.
        // This is the LAST atomic operation to signal a new, complete frame is ready.
        Atomics.add(syncArray, FRAME_COUNTER_INDEX, 1);
        Atomics.notify(syncArray, FRAME_COUNTER_INDEX);
      }
    } catch (err) {
      console.error('[CaptureWorker] Error in capture loop, stopping:', err);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX);
      break;
    }

    const loopDuration = performance.now() - loopStartTime;
    const delayTime = Math.max(0, 1000 / targetFps - loopDuration);
    await delay(delayTime);
  }

  if (isCapturing) {
    captureInstance.stopMonitorInstance();
    isCapturing = false;
    console.log('[CaptureWorker] Stopped capture instance.');
  }
}

parentPort.on('message', (message) => {
  if (message.command === 'stop') {
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  }
});

async function start() {
  console.log('[CaptureWorker] Worker starting up...');
  await captureLoop();
  console.log(
    '[CaptureWorker] Worker has finished its capture loop and is shutting down.',
  );
}

start().catch((err) => {
  console.error('[CaptureWorker] A fatal, unhandled error occurred:', err);
  Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  Atomics.notify(syncArray, IS_RUNNING_INDEX);
});
