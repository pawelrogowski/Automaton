// @electron/workers/region/core.js
import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { setAllRegions } from '../../../frontend/redux/slices/regionCoordinatesSlice.js';
import * as config from './config.js';
import { PerformanceTracker } from './performanceTracker.js';
import { RegionProcessor } from './processing.js';

// --- Worker State & Setup ---
let isShuttingDown = false;
let lastProcessedFrameCounter = -1;
const perfTracker = new PerformanceTracker();
const regionProcessor = new RegionProcessor();
let lastPerfReportTime = Date.now();

const { sharedData } = workerData;
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Logs a performance report to the console at a regular interval.
 */
function logPerformanceReport() {
  if (!config.PERFORMANCE_LOGGING_ENABLED) return;
  const now = Date.now();
  if (now - lastPerfReportTime >= config.PERFORMANCE_LOG_INTERVAL_MS) {
    console.log(perfTracker.getReport());
    perfTracker.reset();
    lastPerfReportTime = now;
  }
}

/**
 * The main loop of the worker. It feeds new frames and dirty rects to the RegionProcessor.
 */
async function mainLoop() {
  console.log(
    '[RegionCore] Starting main loop with optimized region detection.',
  );

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      // Wait for a new frame from the capture worker.
      const newFrameCounter = Atomics.load(
        syncArray,
        config.FRAME_COUNTER_INDEX,
      );

      if (newFrameCounter <= lastProcessedFrameCounter) {
        await delay(config.SCAN_INTERVAL_MS);
        continue;
      }

      lastProcessedFrameCounter = newFrameCounter;

      // Ensure the capture process is running and the window has valid dimensions.
      if (Atomics.load(syncArray, config.IS_RUNNING_INDEX) !== 1) {
        await delay(config.SCAN_INTERVAL_MS);
        continue;
      }

      const width = Atomics.load(syncArray, config.WIDTH_INDEX);
      const height = Atomics.load(syncArray, config.HEIGHT_INDEX);

      if (width <= 0 || height <= 0) {
        await delay(config.SCAN_INTERVAL_MS);
        continue;
      }

      // Read the latest dirty rectangles from shared memory.
      const dirtyRegionCount = Atomics.load(
        syncArray,
        config.DIRTY_REGION_COUNT_INDEX,
      );

      const dirtyRects = [];
      for (let i = 0; i < dirtyRegionCount; i++) {
        const offset = config.DIRTY_REGIONS_START_INDEX + i * 4;
        dirtyRects.push({
          x: Atomics.load(syncArray, offset + 0),
          y: Atomics.load(syncArray, offset + 1),
          width: Atomics.load(syncArray, offset + 2),
          height: Atomics.load(syncArray, offset + 3),
        });
      }

      const metadata = {
        width,
        height,
        frameCounter: newFrameCounter,
        timestamp: performance.now(),
      };

      const scanStart = performance.now();

      // Delegate all complex logic to the processor.
      const newRegions = await regionProcessor.process(
        sharedBufferView,
        metadata,
        dirtyRects,
      );

      perfTracker.addScan(performance.now() - scanStart);

      // The processor returns null if no state change occurred.
      if (newRegions) {
        parentPort.postMessage({
          storeUpdate: true,
          type: setAllRegions.type,
          payload: newRegions,
        });
      }

      logPerformanceReport();
    } catch (err) {
      console.error('[RegionCore] Error in main loop:', err);
      await delay(Math.max(config.SCAN_INTERVAL_MS * 2, 100));
    }

    // Ensure the loop runs at the desired interval.
    const elapsedTime = performance.now() - loopStartTime;
    const delayTime = Math.max(0, config.SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }

  console.log('[RegionCore] Main loop stopped.');
}

/**
 * Handles messages from the main thread. In this mode, it only listens for shutdown.
 */
function handleMessage(message) {
  if (message.type === 'shutdown') {
    console.log('[RegionCore] Received shutdown command.');
    isShuttingDown = true;
  }
}

/**
 * Initializes the worker and starts the main loop.
 */
export async function start() {
  console.log('[RegionCore] Worker starting up...');
  if (!workerData?.sharedData)
    throw new Error('[RegionCore] Shared data not provided');

  parentPort.on('message', handleMessage);

  mainLoop().catch((err) => {
    console.error('[RegionCore] Fatal error in main loop:', err);
    process.exit(1);
  });
}
