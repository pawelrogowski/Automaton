import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import findHealthBars from 'find-health-bars-native';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 500;

if (!sharedData) {
  throw new Error('[EntityMonitor] Shared data not provided.');
}

const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- SharedArrayBuffer Indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;

// --- State ---
let lastProcessedFrameCounter = -1;
let isShuttingDown = false;
let isScanning = false;
let gameWorld = null; // To store the gameWorld region

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mainLoop() {
  console.log('[EntityMonitor] Starting main loop...');

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      if (isScanning) {
        await delay(100);
        continue;
      }

      // Do not scan if gameWorld is not found or is invalid
      if (!gameWorld || gameWorld.width <= 0 || gameWorld.height <= 0) {
        await delay(SCAN_INTERVAL_MS);
        continue;
      }

      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      if (newFrameCounter > lastProcessedFrameCounter) {
        lastProcessedFrameCounter = newFrameCounter;

        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
          await delay(SCAN_INTERVAL_MS);
          continue;
        }

        const width = Atomics.load(syncArray, WIDTH_INDEX);
        const height = Atomics.load(syncArray, HEIGHT_INDEX);

        if (width > 0 && height > 0) {
          isScanning = true;
          try {
            // Pass the gameWorld region as the search area.
            // I am assuming the native module accepts a searchArea object as the second argument.
            const results = await findHealthBars.findHealthBars(
              sharedBufferView,
              gameWorld,
            );

            if (results && results.length > 0) {
              console.log(
                `[EntityMonitor] Found ${results.length} entities:`,
                results.map((r) => `(${r.x}, ${r.y})`).join(' '),
              );
            }
          } finally {
            isScanning = false;
          }
        }
      }
    } catch (err) {
      console.error('[EntityMonitor] Error in main loop:', err);
      isScanning = false; // Reset scanning flag on error
    }

    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
  console.log('[EntityMonitor] Main loop stopped.');
}

parentPort.on('message', (message) => {
  if (message.type === 'shutdown') {
    console.log('[EntityMonitor] Received shutdown command.');
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (message.payload.regionCoordinates) {
      gameWorld = message.payload.regionCoordinates.regions?.gameWorld;
    }
  } else if (typeof message === 'object' && !message.type && !message.command) {
    // Handle full state update on init
    if (message.regionCoordinates) {
      gameWorld = message.regionCoordinates.regions?.gameWorld;
    }
  }
});

mainLoop().catch((err) => {
  console.error('[EntityMonitor] Fatal error in main loop:', err);
  process.exit(1);
});
