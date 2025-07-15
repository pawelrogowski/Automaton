/**
 * @file captureWorker.js
 * @summary A dedicated worker for capturing screen frames from a specific window.
 *
 * @description
 * This worker is the primary data producer. It uses a native X11 capture module
 * to grab frames of a target window and write the image data and metadata into
 * shared memory (SharedArrayBuffers) for other workers to consume.
 *
 * Key Architectural Decisions:
 * 1.  **CPU-Friendly Throttling:** The main loop is architected to "work-then-sleep".
 *     It captures a frame and then calculates the precise delay needed to maintain
 *     the target FPS, ensuring it consumes minimal CPU while idle.
 *
 * 2.  **Robust Buffer Handling:** On each capture cycle, a new, perfectly-sized
 *     Buffer view is created from the SharedArrayBuffer. This ensures the native
 *     capture module always receives a clean, correctly-sized reference, preventing
 *     potential stale state issues or memory corruption within the native addon.
 *
 * 3.  **Atomic State Synchronization:** It uses Atomics to safely update and notify
 *     consumer workers about new frames, window dimensions, and running status,
 *     preventing race conditions.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import X11RegionCapture from 'x11-region-capture-native';

// --- Worker Configuration ---
const { sharedData } = workerData;

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[CaptureWorker] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4;

const captureInstance = X11RegionCapture ? new X11RegionCapture.X11RegionCapture() : null;
let targetFps = 20;
let isCapturing = false;

/**
 * A helper function to pause execution without busy-waiting.
 * @param {number} ms - The number of milliseconds to sleep.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The main execution loop for the worker.
 */
async function captureLoop() {
  if (!captureInstance) {
    console.error('[CaptureWorker] X11 native module is not available. Cannot start capture.');
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  const windowId = Atomics.load(syncArray, WINDOW_ID_INDEX);
  if (!windowId) {
    console.error('[CaptureWorker] No Window ID provided. Cannot start capture.');
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  try {
    captureInstance.startMonitorInstance(windowId, targetFps);
    isCapturing = true;
    console.log(`[CaptureWorker] Started monitoring window: ${windowId} at ${targetFps} FPS.`);
  } catch (err) {
    console.error('[CaptureWorker] Failed to start native capture instance:', err);
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  Atomics.store(syncArray, IS_RUNNING_INDEX, 1);

  while (Atomics.load(syncArray, IS_RUNNING_INDEX) === 1) {
    const loopStartTime = performance.now();

    try {
      // Create a fresh buffer view on each iteration. This is the robust "producer"
      // pattern, ensuring the native module gets a clean reference every time.
      // The overhead is negligible due to the throttled loop.
      const bufferView = Buffer.from(imageSAB);
      const frameResult = captureInstance.getLatestFrame(bufferView);

      if (frameResult?.success) {
        // Safely update the shared metadata for consumers.
        Atomics.store(syncArray, WIDTH_INDEX, frameResult.width);
        Atomics.store(syncArray, HEIGHT_INDEX, frameResult.height);

        // Increment the frame counter and notify all waiting consumer workers.
        Atomics.add(syncArray, FRAME_COUNTER_INDEX, 1);
        Atomics.notify(syncArray, FRAME_COUNTER_INDEX);
      }
    } catch (err) {
      console.error('[CaptureWorker] Error in capture loop, stopping:', err);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX); // Notify consumers that we've stopped.
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
  console.log('[CaptureWorker] Worker has finished its capture loop and is shutting down.');
}

start().catch((err) => {
  console.error('[CaptureWorker] A fatal, unhandled error occurred:', err);
  Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  Atomics.notify(syncArray, IS_RUNNING_INDEX);
});
