// minimapMonitor.js

import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { regionColorSequences, floorLevelIndicators } from '../constants/index.js';
import { PALETTE_DATA } from '../constants/palette.js';
import { createLogger } from '../utils/logger.js';
import { delay, calculateDelayTime, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';
import { MinimapMatcher } from '../utils/minimapMatcher.js';

const paths = workerData?.paths || {};
const logger = createLogger({ info: true, error: true, debug: false });

const require = createRequire(import.meta.url);

// --- Native Modules & Configuration ---
let X11RegionCapture, findSequencesNative, minimapMatcher;

try {
  if (!paths.x11capture || !paths.findSequences || !paths.minimapMatcher) {
    throw new Error('One or more native module paths are missing from workerData.');
  }
  ({ X11RegionCapture } = require(paths.x11capture));
  ({ findSequencesNative } = require(paths.findSequences));
  minimapMatcher = new MinimapMatcher(paths.minimapMatcher);
} catch (e) {
  const errorMessage = `Failed to load native modules or initialize minimapMatcher: ${e.message}`;
  logger('error', errorMessage);
  if (parentPort) parentPort.postMessage({ fatalError: errorMessage });
  else process.exit(1);
}

const TARGET_FPS = 60;
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
const REPROCESS_INTERVAL_MS = 50;

// --- MODIFIED: Palette initialization is now synchronous and immediate ---
logger('info', 'Processing hardcoded palette data...');
const colorToIndexMap = new Map();
PALETTE_DATA.forEach((color, index) => {
  // Use a single integer key for the fastest possible lookups in the main loop
  const intKey = (color.r << 16) | (color.g << 8) | color.b;
  colorToIndexMap.set(intKey, index);
});
logger('info', 'Palette data successfully processed.');

// --- Worker State ---
let state = null;
let initialized = false;
let shouldRestart = false;
let regionBuffers = new Map();
const captureInstance = new X11RegionCapture();
let lastMinimapFrameBuffer = null;
let lastProcessTime = 0;

// --- Helper Functions ---

/** Resets region definitions and clears associated buffers. */
function resetRegions() {
  regionBuffers.clear();
}

/** Adds a region to the X11 capture instance and tracks its buffer. */
function addAndTrackRegion(name, x, y, width, height) {
  const regionConfig = { regionName: name, winX: x, winY: y, regionWidth: width, regionHeight: height };
  try {
    captureInstance.addRegionToMonitor(regionConfig);
    const bufferSize = width * height * 3 + 8;
    const buffer = Buffer.alloc(bufferSize);
    regionBuffers.set(name, { buffer });
    return regionConfig;
  } catch (e) {
    logger('error', `Failed to add/track region ${name}: ${e.message}`);
    return null;
  }
}

/** Finds minimap regions on screen and sets up capture for them. */
async function initializeRegions() {
  if (!state?.global?.windowId) {
    initialized = false;
    shouldRestart = true;
    return;
  }
  resetRegions();
  try {
    captureInstance.startMonitorInstance(state.global.windowId, TARGET_FPS);
    const fullWindowBuffer = Buffer.alloc(2560 * 1600 * 3 + 8);
    const initialFullFrameResult = captureInstance.getFullWindowImageData(fullWindowBuffer);
    if (!initialFullFrameResult?.success) throw new Error('Failed to get initial frame for region finding.');

    const foundMinimapFull = findSequencesNative(fullWindowBuffer, { minimapFull: regionColorSequences.minimapFull }, null, 'first');
    if (foundMinimapFull?.minimapFull?.x !== undefined) {
      const def = createRegion(foundMinimapFull.minimapFull, MINIMAP_WIDTH, MINIMAP_HEIGHT);
      if (validateRegionDimensions(def)) {
        addAndTrackRegion('minimapFullRegion', def.x, def.y, def.width, def.height);
      }
    }

    const foundFloorIndicator = findSequencesNative(
      fullWindowBuffer,
      { minimapFloorIndicatorColumn: regionColorSequences.minimapFloorIndicatorColumn },
      null,
      'first',
    );
    if (foundFloorIndicator?.minimapFloorIndicatorColumn?.x !== undefined) {
      const def = createRegion(foundFloorIndicator.minimapFloorIndicatorColumn, 2, 63);
      if (validateRegionDimensions(def)) {
        addAndTrackRegion('minimapFloorIndicatorColumnRegion', def.x, def.y, def.width, def.height);
      }
    }

    initialized = true;
    shouldRestart = false;
    logger('info', 'Minimap monitor regions initialized.');
  } catch (error) {
    logger('error', `Region initialization error: ${error.message}`);
    initialized = false;
    shouldRestart = true;
    if (captureInstance) captureInstance.stopMonitorInstance();
  }
}

/** Processes a single frame, finds the player position, and posts updates. */
async function processFrame() {
  const regionData = {};
  for (const [regionName, bufferInfo] of regionBuffers.entries()) {
    const result = captureInstance.getRegionRgbData(regionName, bufferInfo.buffer);
    if (result?.success) {
      regionData[regionName] = { data: bufferInfo.buffer, ...result };
    }
  }

  const minimapEntry = regionData.minimapFullRegion;
  if (!minimapEntry) return;

  const currentFrameData = minimapEntry.data;
  const now = Date.now();

  if (lastMinimapFrameBuffer && lastMinimapFrameBuffer.equals(currentFrameData) && now - lastProcessTime < REPROCESS_INTERVAL_MS) {
    return;
  }

  lastProcessTime = now;

  if (!lastMinimapFrameBuffer || lastMinimapFrameBuffer.length !== currentFrameData.length) {
    lastMinimapFrameBuffer = Buffer.alloc(currentFrameData.length);
  }
  currentFrameData.copy(lastMinimapFrameBuffer);

  let detectedZ = null;
  if (regionData.minimapFloorIndicatorColumnRegion) {
    const { data } = regionData.minimapFloorIndicatorColumnRegion;
    const foundFloor = findSequencesNative(data, floorLevelIndicators, null, 'first');
    if (foundFloor) {
      let lowestY = Infinity;
      const floorKey = Object.keys(foundFloor).reduce((lowest, key) => {
        if (foundFloor[key] !== null && foundFloor[key].y < lowestY) {
          lowestY = foundFloor[key].y;
          return key;
        }
        return lowest;
      }, null);
      if (floorKey !== null) detectedZ = parseInt(floorKey, 10);
    }
  }

  if (detectedZ === null) return;

  const { width, height } = minimapEntry;
  const rgbData = currentFrameData.subarray(8);
  const minimapIndexData = new Uint8Array(width * height);
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const pixelOffset = i * 3;
    const r = rgbData[pixelOffset];
    const g = rgbData[pixelOffset + 1];
    const b = rgbData[pixelOffset + 2];
    const key = (r << 16) | (g << 8) | b;
    minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
  }

  minimapMatcher
    .findPosition(minimapIndexData, width, height, detectedZ)
    .then((result) => {
      if (result?.position) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'playerMinimapPosition',
          payload: {
            ...result.position,
            searchTimeMs: result.performance.totalTimeMs,
            searchMethod: result.performance.method,
          },
        });
      }
    })
    .catch((error) => {
      if (error?.message !== 'Search cancelled') {
        logger('error', `Minimap search promise rejected: ${error.message}`);
      }
    });
}

/** The main execution loop for the worker. */
async function mainLoop() {
  const loopStartTime = Date.now();
  try {
    if ((!initialized && state?.global?.windowId) || shouldRestart) {
      minimapMatcher.cancelCurrentSearch();
      await initializeRegions();
    }

    if (initialized) {
      await processFrame();
    }
  } catch (err) {
    logger('error', `Fatal error in mainLoop: ${err.message}`, err);
    triggerReinitialization();
  } finally {
    const loopExecutionTime = Date.now() - loopStartTime;
    const delayTime = calculateDelayTime(loopExecutionTime, TARGET_FPS);
    if (delayTime > 0) await delay(delayTime);
  }
}

/** Gracefully triggers a full re-initialization of the worker's capture logic. */
function triggerReinitialization() {
  if (captureInstance && initialized) {
    captureInstance.stopMonitorInstance();
  }
  initialized = false;
  shouldRestart = true;
  lastMinimapFrameBuffer = null;
  lastProcessTime = 0;
  minimapMatcher.cancelCurrentSearch();
}

/** Main entry point for the worker. */
async function start() {
  logger('info', 'Minimap monitor worker started.');
  try {
    // No more async palette loading, just load the map data
    await minimapMatcher.loadMapData();

    while (true) {
      await mainLoop();
    }
  } catch (err) {
    logger('error', `Worker fatal error during startup: ${err.message}`, err);
    if (parentPort) parentPort.postMessage({ fatalError: err.message });
    process.exit(1);
  }
}

// --- Event Listeners ---

parentPort.on('message', (message) => {
  if (message?.command === 'forceReinitialize') {
    logger('info', '[Minimap Monitor] Forced re-initialization requested.');
    triggerReinitialization();
    return;
  }

  const previousWindowId = state?.global?.windowId;
  state = message;
  const newWindowId = state?.global?.windowId;

  if (newWindowId && newWindowId !== previousWindowId) {
    logger('info', `Window ID changed from ${previousWindowId} to ${newWindowId}. Re-initializing.`);
    triggerReinitialization();
  }
});

parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping minimap worker.');
  if (captureInstance) captureInstance.stopMonitorInstance();
  process.exit(0);
});

start();
