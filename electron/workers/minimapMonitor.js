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
import {
  MinimapMatcher,
  setMinimapResourcesPath,
} from '../utils/minimapMatcher.js';
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
// --- [MODIFIED] --- Renamed for clarity and consistency.
let state = null;

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
  logger('debug', 'extractBGRA called with:', { rect, sourceWidth });

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    logger('debug', 'extractBGRA: invalid rect', rect);
    return null;
  }

  const bytesPerPixel = 4;
  const targetSize = rect.width * rect.height * bytesPerPixel;
  const targetBuffer = Buffer.alloc(targetSize);

  logger('debug', 'extractBGRA: extracting', {
    targetSize,
    sourceBufferLength: sourceBuffer.length,
    expectedSourceEnd:
      HEADER_SIZE +
      (rect.y + rect.height - 1) * sourceWidth * bytesPerPixel +
      (rect.x + rect.width) * bytesPerPixel,
  });

  for (let y = 0; y < rect.height; y++) {
    const sourceY = rect.y + y;
    const sourceRowStart =
      HEADER_SIZE + (sourceY * sourceWidth + rect.x) * bytesPerPixel;
    const targetRowStart = y * rect.width * bytesPerPixel;

    if (
      sourceRowStart < 0 ||
      sourceRowStart + rect.width * bytesPerPixel > sourceBuffer.length
    ) {
      logger('debug', 'extractBGRA: out of bounds access', {
        sourceRowStart,
        requiredBytes: rect.width * bytesPerPixel,
      });
      return null;
    }

    sourceBuffer.copy(
      targetBuffer,
      targetRowStart,
      sourceRowStart,
      sourceRowStart + rect.width * bytesPerPixel,
    );
  }

  logger('debug', 'extractBGRA: successfully extracted', targetSize, 'bytes');
  return targetBuffer;
}

/**
 * The core processing logic for analyzing the minimap.
 */
async function processMinimapData(minimapBuffer, floorIndicatorBuffer) {
  logger('debug', '=== Starting minimap processing ===');

  // If the raw pixel data of the minimap hasn't changed, there's no work to do.
  if (lastMinimapFrameData && lastMinimapFrameData.equals(minimapBuffer)) {
    logger('debug', 'Minimap data unchanged, skipping processing');
    return;
  }
  lastMinimapFrameData = minimapBuffer;
  logger('debug', 'Processing new minimap data');

  // Create a temporary buffer with a header for the native module call.
  const floorIndicatorSearchBuffer = Buffer.alloc(
    HEADER_SIZE + floorIndicatorBuffer.length,
  );
  floorIndicatorSearchBuffer.writeUInt32LE(2, 0); // width of floor indicator region
  floorIndicatorSearchBuffer.writeUInt32LE(63, 4); // height of floor indicator region
  floorIndicatorBuffer.copy(floorIndicatorSearchBuffer, HEADER_SIZE);

  logger(
    'debug',
    'Created floor indicator search buffer, length:',
    floorIndicatorSearchBuffer.length,
  );

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

    logger(
      'debug',
      'Floor indicator search results:',
      JSON.stringify(searchResults),
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

    logger('debug', 'Detected floor level:', detectedZ, 'from key:', floorKey);

    if (detectedZ === null) {
      logger(
        'debug',
        'Cannot determine floor level, aborting minimap processing',
      );
      return; // Can't determine floor, cannot proceed.
    }

    logger(
      'debug',
      'Creating minimap index data, buffer size:',
      minimapBuffer.length,
    );
    const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);
    for (let i = 0; i < minimapIndexData.length; i++) {
      const p = i * 4;
      const key =
        (minimapBuffer[p + 2] << 16) |
        (minimapBuffer[p + 1] << 8) |
        minimapBuffer[p];
      minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
    }

    logger('debug', 'Minimap index data created, searching for position...');

    minimapMatcher.cancelCurrentSearch();
    const result = await minimapMatcher.findPosition(
      minimapIndexData,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      detectedZ,
    );
    logger('debug', 'Minimap search result:', JSON.stringify(result));

    if (result?.position) {
      const cleanPayload = {
        x: result.position.x,
        y: result.position.y,
        z: result.position.z,
      };
      logger('debug', 'Sending position update:', cleanPayload);
      parentPort.postMessage({
        storeUpdate: true,
        type: 'gameState/setPlayerMinimapPosition',
        payload: cleanPayload,
      });
    } else {
      logger('debug', 'No position found in minimap search result');
    }
  } catch (err) {
    logger('error', `Minimap processing error: ${err.message}`);
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

      if (
        newFrameCounter > lastProcessedFrameCounter &&
        state?.regionCoordinates?.regions
      ) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 0) {
          const { minimapFull, minimapFloorIndicatorColumn } =
            state.regionCoordinates.regions;
          const screenWidth = Atomics.load(syncArray, WIDTH_INDEX);

          if (minimapFull && minimapFloorIndicatorColumn && screenWidth > 0) {
            // Debug logging to verify regions are found
            logger(
              'debug',
              `Minimap regions found: minimapFull=${JSON.stringify(minimapFull)}, minimapFloorIndicatorColumn=${JSON.stringify(minimapFloorIndicatorColumn)}`,
            );
            lastProcessedFrameCounter = newFrameCounter;

            // --- Correct Data Extraction ---
            logger(
              'debug',
              'Extracting minimap data with region:',
              minimapFull,
            );
            const minimapData = extractBGRA(
              sharedBufferView,
              screenWidth,
              minimapFull,
            );
            logger(
              'debug',
              'Extracting floor indicator data with region:',
              minimapFloorIndicatorColumn,
            );
            const floorIndicatorData = extractBGRA(
              sharedBufferView,
              screenWidth,
              minimapFloorIndicatorColumn,
            );

            logger('debug', 'Data extraction results:', {
              minimapData: !!minimapData,
              minimapDataLength: minimapData?.length,
              floorIndicatorData: !!floorIndicatorData,
              floorIndicatorDataLength: floorIndicatorData?.length,
            });

            if (minimapData && floorIndicatorData) {
              logger(
                'debug',
                'Both data buffers extracted successfully, processing minimap...',
              );
              await processMinimapData(minimapData, floorIndicatorData);
            } else {
              logger(
                'debug',
                'Data extraction failed, skipping minimap processing',
              );
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

// --- [MODIFIED] --- Updated message handler for new state management model.
parentPort.on('message', (message) => {
  if (message.type === 'state_diff') {
    // Merge the incoming changed slices into the local state.
    state = { ...state, ...message.payload };
  } else if (message.type === undefined) {
    // This is the initial, full state object sent when the worker starts.
    state = message;
  }
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
