// @electron/workers/region/core.js
import { parentPort, workerData } from 'worker_threads';
import { setAllRegions } from '../../../frontend/redux/slices/regionCoordinatesSlice.js';
import * as config from './config.js';
import { RegionProcessor } from './processing.js';

// --- Worker State & Setup ---
let isShuttingDown = false;
const regionProcessor = new RegionProcessor();

const { sharedData } = workerData;
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The main loop of the worker.
 */
async function mainLoop() {
  console.log('[RegionCore] Starting region detection loop.');

  while (!isShuttingDown) {
    try {
      // Ensure the capture process is running
      if (Atomics.load(syncArray, config.IS_RUNNING_INDEX) !== 1) {
        await delay(50);
        continue;
      }

      const width = Atomics.load(syncArray, config.WIDTH_INDEX);
      const height = Atomics.load(syncArray, config.HEIGHT_INDEX);

      if (width <= 0 || height <= 0) {
        await delay(50);
        continue;
      }

      // Get the current frame counter
      const frameCounter = Atomics.load(syncArray, config.FRAME_COUNTER_INDEX);

      // Read dirty rectangles from shared memory
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
        frameCounter,
        timestamp: Date.now(),
      };

      // Process the frame
      const newRegions = await regionProcessor.process(
        sharedBufferView,
        metadata,
        dirtyRects,
      );

      // Send updates if any
      if (newRegions) {
        parentPort.postMessage({
          storeUpdate: true,
          type: setAllRegions.type,
          payload: newRegions,
        });
      }
    } catch (err) {
      console.error('[RegionCore] Error:', err);
      await delay(100);
    }

    // Small delay to prevent excessive CPU usage
    await delay(10);
  }

  console.log('[RegionCore] Main loop stopped.');
}

/**
 * Handles messages from the main thread.
 */
function handleMessage(message) {
  if (message.type === 'shutdown') {
    console.log('[RegionCore] Received shutdown command.');
    isShuttingDown = true;
  }
}

/**
 * Initialize the worker.
 */
export async function start() {
  console.log('[RegionCore] Worker starting up...');
  if (!workerData?.sharedData)
    throw new Error('[RegionCore] Shared data not provided');

  parentPort.on('message', handleMessage);

  mainLoop().catch((err) => {
    console.error('[RegionCore] Fatal error:', err);
    process.exit(1);
  });
}
