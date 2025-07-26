/**
 * @file minimap-monitor.js
 * @summary A dedicated worker for analyzing minimap data to determine player position.
 *
 * @description
 * This worker's sole responsibility is to process minimap image data to find the
 * player's (x, y, z) coordinates. It relies on the `region-monitor` worker to first
 * locate the necessary minimap regions on screen.
 *
 * Key Architectural Decisions:
 * 1.  **CPU-Friendly Throttling:** The main loop is architected to "work-then-sleep".
 *     After each analysis cycle, it calculates the time remaining until the next
 *     interval and puts the worker thread to sleep. This ensures the worker consumes
 *     virtually zero CPU while idle.
 *
 * 2.  **Dirty Region Optimization:** The worker leverages dirty region data from the
 *     capture module. It only processes image data if the minimap area has actually
 *     changed, significantly reducing CPU load.
 *
 * 3.  **Correct Data Extraction:** It uses a robust method to extract only the raw
 *     pixel data for the minimap and floor indicator regions into small, private
 *     buffers. This guarantees the subsequent processing logic receives data in the
 *     exact format it expects, preventing coordinate errors.
 *
 * 4.  **State-Driven:** The worker remains idle until it receives the necessary
 *     region coordinates from the main thread's global state. All operations are
 *     based on the last known good state.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { floorLevelIndicators } from '../constants/index.js';
import { PALETTE_DATA } from '../constants/palette.js';
import { createLogger } from '../utils/logger.js';
import {
  MinimapMatcher,
  setMinimapResourcesPath,
} from '../utils/minimapMatcher.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
const MAIN_LOOP_INTERVAL = 10; // Check for updates frequently, but dirty regions will prevent unnecessary work
const PERFORMANCE_LOG_INTERVAL = 10000; // Log performance every 10 seconds

// --- Shared Buffer Setup ---
const { sharedData, paths } = workerData;
if (!sharedData) throw new Error('[MinimapMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);

// --- Shared buffer indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4;
const DIRTY_REGION_COUNT_INDEX = 5;
const DIRTY_REGIONS_START_INDEX = 6;

const HEADER_SIZE = 8;
const sharedBufferView = Buffer.from(imageSAB);

// --- Worker State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;

// --- Performance Tracking ---
let operationCount = 0;
let totalOperationTime = 0;
let lastPerfReport = Date.now();
let lastProcessedFrameCounter = -1;

// --- Minimap Configuration ---
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
let minimapMatcher = null;

// Pre-build color lookup map for performance
const colorToIndexMap = new Map();
PALETTE_DATA.forEach((color, index) => {
  const intKey = (color.r << 16) | (color.g << 8) | color.b;
  colorToIndexMap.set(intKey, index);
});

// --- Region tracking for change detection ---
let lastKnownMinimapFull = null;
let lastKnownMinimapFloor = null;

// --- Logging ---
const logger = createLogger({ info: true, error: true, debug: false });

// --- Self-Contained Utilities ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Performance Monitoring ---
function logPerformanceStats() {
  const now = Date.now();
  const timeSinceLastReport = now - lastPerfReport;

  if (timeSinceLastReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgOpTime =
      operationCount > 0 ? (totalOperationTime / operationCount).toFixed(2) : 0;
    const opsPerSecond = (
      (operationCount / timeSinceLastReport) *
      1000
    ).toFixed(1);

    logger(
      'info',
      `[MinimapMonitor] Performance: ${opsPerSecond} ops/sec, avg: ${avgOpTime}ms`,
    );

    // Reset counters
    operationCount = 0;
    totalOperationTime = 0;
    lastPerfReport = now;
  }
}

// --- Worker-specific initialization ---
async function initializeWorker() {
  logger('info', '[MinimapMonitor] Initializing worker...');

  // Set minimap resources path
  if (paths?.minimapResources) {
    setMinimapResourcesPath(paths.minimapResources);
    logger(
      'info',
      `[MinimapMonitor] Minimap resources path set to: ${paths.minimapResources}`,
    );
  }

  // Initialize minimap matcher
  minimapMatcher = new MinimapMatcher();
  if (!minimapMatcher.isLoaded) {
    await minimapMatcher.loadMapData();
  }

  isInitialized = true;
  logger('info', '[MinimapMonitor] Worker initialized successfully');
}

// --- Helper function to check if two rectangles intersect ---
function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

/**
 * Extracts a region of raw BGRA pixel data from the main screen buffer.
 * This function is adapted from the original working code to ensure correctness.
 * @param {Buffer} sourceBuffer - The full shared screen buffer.
 * @param {number} sourceWidth - The width of the full screen buffer.
 * @param {object} rect - The {x, y, width, height} of the region to extract.
 * @returns {Buffer|null} A new Buffer containing only the raw pixel data, or null if invalid.
 */
function extractBGRA(sourceBuffer, sourceWidth, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const bytesPerPixel = 4;
  const targetSize = rect.width * rect.height * bytesPerPixel;
  const targetBuffer = Buffer.alloc(targetSize);

  for (let y = 0; y < rect.height; y++) {
    const sourceY = rect.y + y;
    const sourceRowStart =
      HEADER_SIZE + (sourceY * sourceWidth + rect.x) * bytesPerPixel;
    const targetRowStart = y * rect.width * bytesPerPixel;

    if (
      sourceRowStart < 0 ||
      sourceRowStart + rect.width * bytesPerPixel > sourceBuffer.length
    ) {
      return null;
    }

    sourceBuffer.copy(
      targetBuffer,
      targetRowStart,
      sourceRowStart,
      sourceRowStart + rect.width * bytesPerPixel,
    );
  }

  return targetBuffer;
}

/**
 * The core processing logic for analyzing the minimap.
 */
async function processMinimapData(minimapBuffer, floorIndicatorBuffer) {
  // Create a temporary buffer with a header for the native module call.
  const floorIndicatorSearchBuffer = Buffer.alloc(
    HEADER_SIZE + floorIndicatorBuffer.length,
  );
  floorIndicatorSearchBuffer.writeUInt32LE(2, 0); // width of floor indicator region
  floorIndicatorSearchBuffer.writeUInt32LE(63, 4); // height of floor indicator region
  floorIndicatorBuffer.copy(floorIndicatorSearchBuffer, HEADER_SIZE);

  try {
    const searchResults = await findSequences.findSequencesNativeBatch(
      floorIndicatorSearchBuffer,
      {
        floor: {
          sequences: floorLevelIndicators,
          searchArea: { x: 0, y: 0, width: 2, height: 63 },
          occurrence: 'first',
        },
      },
    );

    const foundFloor = searchResults.floor || {};
    const floorKey = Object.keys(foundFloor).reduce(
      (lowest, key) =>
        foundFloor[key] !== null && foundFloor[key].y < lowest.y
          ? { key, y: foundFloor[key].y }
          : lowest,
      { key: null, y: Infinity },
    ).key;
    const detectedZ = floorKey !== null ? parseInt(floorKey, 10) : null;

    if (detectedZ === null) {
      return; // Can't determine floor, cannot proceed.
    }

    // Convert minimap buffer to index data
    const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);
    for (let i = 0; i < minimapIndexData.length; i++) {
      const p = i * 4;
      const key =
        (minimapBuffer[p + 2] << 16) |
        (minimapBuffer[p + 1] << 8) |
        minimapBuffer[p];
      minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
    }

    // Cancel any previous search and find position
    minimapMatcher.cancelCurrentSearch();
    const result = await minimapMatcher.findPosition(
      minimapIndexData,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      detectedZ,
    );

    if (result?.position) {
      const cleanPayload = {
        x: result.position.x,
        y: result.position.y,
        z: result.position.z,
      };

      parentPort.postMessage({
        storeUpdate: true,
        type: 'gameState/setPlayerMinimapPosition',
        payload: cleanPayload,
      });
    }
  } catch (err) {
    logger('error', `[MinimapMonitor] Processing error: ${err.message}`);
  }
}

// --- Main worker operation ---
async function performOperation() {
  if (!isInitialized || !currentState) {
    return; // Wait for initialization and state
  }

  const opStart = performance.now();

  try {
    const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

    // Only process if we have a new frame and the necessary state
    if (
      newFrameCounter > lastProcessedFrameCounter &&
      currentState?.regionCoordinates?.regions
    ) {
      // Check if capture is running
      if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 0) {
        const { minimapFull, minimapFloorIndicatorColumn } =
          currentState.regionCoordinates.regions;
        const screenWidth = Atomics.load(syncArray, WIDTH_INDEX);

        if (minimapFull && minimapFloorIndicatorColumn && screenWidth > 0) {
          let needsProcessing = false;

          // 1. Force processing if the region definitions themselves have changed
          if (
            minimapFull !== lastKnownMinimapFull ||
            minimapFloorIndicatorColumn !== lastKnownMinimapFloor
          ) {
            needsProcessing = true;
            lastKnownMinimapFull = minimapFull;
            lastKnownMinimapFloor = minimapFloorIndicatorColumn;
          } else {
            // 2. Check dirty regions for updates within the known region bounds
            const dirtyRegionCount = Atomics.load(
              syncArray,
              DIRTY_REGION_COUNT_INDEX,
            );
            if (dirtyRegionCount > 0) {
              for (let i = 0; i < dirtyRegionCount; i++) {
                const offset = DIRTY_REGIONS_START_INDEX + i * 4;
                const dirtyRect = {
                  x: Atomics.load(syncArray, offset + 0),
                  y: Atomics.load(syncArray, offset + 1),
                  width: Atomics.load(syncArray, offset + 2),
                  height: Atomics.load(syncArray, offset + 3),
                };

                if (
                  rectsIntersect(minimapFull, dirtyRect) ||
                  rectsIntersect(minimapFloorIndicatorColumn, dirtyRect)
                ) {
                  needsProcessing = true;
                  break;
                }
              }
            }
          }

          if (needsProcessing) {
            lastProcessedFrameCounter = newFrameCounter;

            const minimapData = extractBGRA(
              sharedBufferView,
              screenWidth,
              minimapFull,
            );
            const floorIndicatorData = extractBGRA(
              sharedBufferView,
              screenWidth,
              minimapFloorIndicatorColumn,
            );

            if (minimapData && floorIndicatorData) {
              await processMinimapData(minimapData, floorIndicatorData);
            }
          }
        }
      }
    }
  } catch (error) {
    logger('error', '[MinimapMonitor] Error in operation:', error);
  } finally {
    const opEnd = performance.now();
    const opTime = opEnd - opStart;

    // Update performance stats
    operationCount++;
    totalOperationTime += opTime;

    // Log slow operations
    if (opTime > 50) {
      logger('info', `[MinimapMonitor] Slow operation: ${opTime.toFixed(2)}ms`);
    }
  }
}

// --- Main Loop ---
async function mainLoop() {
  logger('info', '[MinimapMonitor] Starting main loop...');

  while (!isShuttingDown) {
    const loopStart = performance.now();

    try {
      await performOperation();
      logPerformanceStats();
    } catch (error) {
      logger('error', '[MinimapMonitor] Error in main loop:', error);
      // Wait longer on error to avoid tight error loops
      await delay(Math.max(MAIN_LOOP_INTERVAL * 2, 100));
      continue;
    }

    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, MAIN_LOOP_INTERVAL - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }

  logger('info', '[MinimapMonitor] Main loop stopped.');
}

// --- Message Handler ---
parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      // Handle state updates from WorkerManager
      if (!currentState) {
        currentState = {};
      }

      // Apply state diff
      Object.assign(currentState, message.payload);
    } else if (message.type === 'shutdown') {
      logger('info', '[MinimapMonitor] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      // Handle full state updates (initial state from WorkerManager)
      currentState = message;

      if (!isInitialized) {
        initializeWorker().catch((error) => {
          logger(
            'error',
            '[MinimapMonitor] Failed to initialize worker:',
            error,
          );
          process.exit(1);
        });
      }
    } else {
      // Handle custom commands
      logger('info', '[MinimapMonitor] Received message:', message);
    }
  } catch (error) {
    logger('error', '[MinimapMonitor] Error handling message:', error);
  }
});

// --- Worker Startup ---
async function startWorker() {
  logger('info', '[MinimapMonitor] Worker starting up...');

  // Handle graceful shutdown signals
  process.on('SIGTERM', () => {
    logger('info', '[MinimapMonitor] Received SIGTERM, shutting down...');
    isShuttingDown = true;
  });

  process.on('SIGINT', () => {
    logger('info', '[MinimapMonitor] Received SIGINT, shutting down...');
    isShuttingDown = true;
  });

  // Start the main loop
  mainLoop().catch((error) => {
    logger('error', '[MinimapMonitor] Fatal error in main loop:', error);
    process.exit(1);
  });
}

// === WORKER-SPECIFIC HELPER FUNCTIONS ===

function validateWorkerData() {
  if (!workerData) {
    throw new Error('[MinimapMonitor] Worker data not provided');
  }

  if (!workerData.sharedData) {
    throw new Error('[MinimapMonitor] Shared data not provided in worker data');
  }

  if (!workerData.paths?.minimapResources) {
    throw new Error(
      '[MinimapMonitor] Minimap resources path not provided in worker data',
    );
  }
}

// Initialize and start the worker
try {
  validateWorkerData();
  startWorker();
} catch (error) {
  logger('error', '[MinimapMonitor] Failed to start worker:', error);
  process.exit(1);
}
