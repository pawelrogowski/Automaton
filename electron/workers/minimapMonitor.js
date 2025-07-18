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
 * 2.  **Correct Data Extraction:** It uses a robust method to extract only the raw
 *     pixel data for the minimap and floor indicator regions into small, private
 *     buffers. This guarantees the subsequent processing logic receives data in the
 *     exact format it expects, preventing coordinate errors.
 *
 * 3.  **State-Driven:** The worker remains idle until it receives the necessary
 *     region coordinates from the main thread's global state. All operations are
 *     based on the last known good state.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { floorLevelIndicators } from '../constants/index.js';
import { PALETTE_DATA } from '../constants/palette.js';
import { createLogger } from '../utils/logger.js';
import { MinimapMatcher, setMinimapResourcesPath } from '../utils/minimapMatcher.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
const { sharedData, paths } = workerData;
const SCAN_INTERVAL_MS = 1; // Minimap position doesn't need to update as frequently.
const logger = createLogger({ info: true, error: true, debug: false });

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[MinimapMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;

const sharedBufferView = Buffer.from(imageSAB);

// --- Configuration ---
const MINIMAP_WIDTH = 106,
  MINIMAP_HEIGHT = 109;
const minimapMatcher = new MinimapMatcher();

const colorToIndexMap = new Map();
PALETTE_DATA.forEach((color, index) => {
  const intKey = (color.r << 16) | (color.g << 8) | color.b;
  colorToIndexMap.set(intKey, index);
});

// --- Worker State ---
let lastProcessedFrameCounter = -1;
let lastMinimapFrameData = null;
let workerState = null; // Will hold the entire Redux state object.

// --- Self-Contained Utilities ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extracts a region of raw BGRA pixel data from the main screen buffer.
 * This function is adapted from the original working code to ensure correctness.
 * @param {Buffer} sourceBuffer - The full shared screen buffer.
 * @param {number} sourceWidth - The width of the full screen buffer.
 * @param {object} rect - The {x, y, width, height} of the region to extract.
 * @returns {Buffer|null} A new Buffer containing only the raw pixel data, or null if invalid.
 */
function extractBGRA(sourceBuffer, sourceWidth, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const bytesPerPixel = 4;
  const targetSize = rect.width * rect.height * bytesPerPixel;
  const targetBuffer = Buffer.alloc(targetSize);

  for (let y = 0; y < rect.height; y++) {
    const sourceY = rect.y + y;
    const sourceRowStart = HEADER_SIZE + (sourceY * sourceWidth + rect.x) * bytesPerPixel;
    const targetRowStart = y * rect.width * bytesPerPixel;
    sourceBuffer.copy(targetBuffer, targetRowStart, sourceRowStart, sourceRowStart + rect.width * bytesPerPixel);
  }
  return targetBuffer;
}

/**
 * The core processing logic for analyzing the minimap.
 */
async function processMinimapData(minimapBuffer, floorIndicatorBuffer) {
  // If the raw pixel data of the minimap hasn't changed, there's no work to do.
  if (lastMinimapFrameData && lastMinimapFrameData.equals(minimapBuffer)) {
    return;
  }
  lastMinimapFrameData = minimapBuffer;

  // Create a temporary buffer with a header for the native module call.
  const floorIndicatorSearchBuffer = Buffer.alloc(HEADER_SIZE + floorIndicatorBuffer.length);
  floorIndicatorSearchBuffer.writeUInt32LE(2, 0); // width of floor indicator region
  floorIndicatorSearchBuffer.writeUInt32LE(63, 4); // height of floor indicator region
  floorIndicatorBuffer.copy(floorIndicatorSearchBuffer, HEADER_SIZE);

  const searchResults = findSequences.findSequencesNativeBatch(floorIndicatorSearchBuffer, {
    floor: { sequences: floorLevelIndicators, searchArea: { x: 0, y: 0, width: 2, height: 63 }, occurrence: 'first' },
  });

  const foundFloor = searchResults.floor || {};
  const floorKey = Object.keys(foundFloor).reduce(
    (lowest, key) => (foundFloor[key] !== null && foundFloor[key].y < lowest.y ? { key, y: foundFloor[key].y } : lowest),
    { key: null, y: Infinity },
  ).key;
  const detectedZ = floorKey !== null ? parseInt(floorKey, 10) : null;

  if (detectedZ === null) {
    return; // Can't determine floor, cannot proceed.
  }

  const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);
  for (let i = 0; i < minimapIndexData.length; i++) {
    const p = i * 4;
    const key = (minimapBuffer[p + 2] << 16) | (minimapBuffer[p + 1] << 8) | minimapBuffer[p];
    minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
  }

  minimapMatcher.cancelCurrentSearch();
  try {
    const result = await minimapMatcher.findPosition(minimapIndexData, MINIMAP_WIDTH, MINIMAP_HEIGHT, detectedZ);
    if (result?.position) {
      const cleanPayload = { x: result.position.x, y: result.position.y, z: result.position.z };
      parentPort.postMessage({ storeUpdate: true, type: 'gameState/setPlayerMinimapPosition', payload: cleanPayload });
    }
  } catch (err) {
    if (err.message !== 'Search cancelled') logger('error', `Minimap search failed: ${err.message}`);
  }
}

/**
 * The main execution loop for the worker.
 */
async function mainLoop() {
  while (true) {
    const loopStartTime = performance.now();

    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      if (newFrameCounter > lastProcessedFrameCounter && workerState?.regionCoordinates?.regions) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 0) {
          const { minimapFull, minimapFloorIndicatorColumn } = workerState.regionCoordinates.regions;
          const screenWidth = Atomics.load(syncArray, WIDTH_INDEX);

          if (minimapFull && minimapFloorIndicatorColumn && screenWidth > 0) {
            lastProcessedFrameCounter = newFrameCounter;

            // --- Correct Data Extraction ---
            const minimapData = extractBGRA(sharedBufferView, screenWidth, minimapFull);
            const floorIndicatorData = extractBGRA(sharedBufferView, screenWidth, minimapFloorIndicatorColumn);

            if (minimapData && floorIndicatorData) {
              await processMinimapData(minimapData, floorIndicatorData);
            }
          }
        }
      }
    } catch (err) {
      logger('error', `Fatal error in mainLoop: ${err.stack}`);
    }

    // --- CPU-Friendly Throttling Logic ---
    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

parentPort.on('message', (newState) => {
  workerState = newState;
});

async function start() {
  logger('info', 'Minimap monitor worker started. Waiting for global state...');

  // Set the minimap resources path from workerData
  if (paths?.minimapResources) {
    setMinimapResourcesPath(paths.minimapResources);
    logger('info', `Minimap resources path set to: ${paths.minimapResources}`);
  }

  if (!minimapMatcher.isLoaded) {
    await minimapMatcher.loadMapData();
  }
  mainLoop();
}

start();
