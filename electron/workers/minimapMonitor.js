import { parentPort } from 'worker_threads';
import { regionColorSequences, floorLevelIndicators } from '../constants/index.js';
import { PALETTE_DATA } from '../constants/palette.js';
import { createLogger } from '../utils/logger.js';
import { delay, calculateDelayTime, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';
import { MinimapMatcher } from '../utils/minimapMatcher.js';
import X11RegionCapture from 'x11-region-capture-native';
import findSequences from 'find-sequences-native';

const logger = createLogger({ info: true, error: true, debug: false });

// --- Native Modules & Configuration ---
const minimapMatcher = new MinimapMatcher();
const captureInstance = new X11RegionCapture.X11RegionCapture();

const TARGET_FPS = 10; // Minimap doesn't need to update as fast
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
const REPROCESS_INTERVAL_MS = 100; // Can be a bit longer

logger('info', 'Processing hardcoded palette data...');
const colorToIndexMap = new Map();
PALETTE_DATA.forEach((color, index) => {
  const intKey = (color.r << 16) | (color.g << 8) | color.b;
  colorToIndexMap.set(intKey, index);
});
logger('info', 'Palette data successfully processed.');

// --- Worker State ---
let state = null;
let initialized = false;
let shouldRestart = false;
let isSearching = false;
let lastKnownZ = null;

// --- NEW: Centralized Buffers and Region Definitions ---
let fullWindowBuffer = null;
let fullWindowBufferMetadata = { width: 0, height: 0 };
let minimapRegionDef = null;
let floorIndicatorRegionDef = null;
let lastMinimapFrameData = null; // Buffer to hold just the minimap pixels for change detection
let lastProcessTime = 0;

function resetState() {
  initialized = false;
  fullWindowBuffer = null;
  fullWindowBufferMetadata = { width: 0, height: 0 };
  minimapRegionDef = null;
  floorIndicatorRegionDef = null;
  lastMinimapFrameData = null;
  lastKnownZ = null;
  isSearching = false;
}

async function initializeRegions() {
  if (!state?.global?.windowId) {
    initialized = false;
    shouldRestart = true;
    return;
  }
  resetState();
  try {
    captureInstance.startMonitorInstance(state.global.windowId, TARGET_FPS);

    const estimatedMaxSize = 2560 * 1600 * 4 + 8; // 4 bytes for BGRA
    fullWindowBuffer = Buffer.alloc(estimatedMaxSize);

    await delay(100); // Give capture thread time to start
    const initialFrameResult = captureInstance.getLatestFrame(fullWindowBuffer);
    if (!initialFrameResult?.success) {
      throw new Error('Failed to get initial frame for region finding.');
    }
    fullWindowBufferMetadata = { width: initialFrameResult.width, height: initialFrameResult.height };

    // Find minimap and floor indicator regions using the full frame
    const initialSearchResults = findSequences.findSequencesNative(
      fullWindowBuffer,
      {
        minimapFull: regionColorSequences.minimapFull,
        minimapFloorIndicatorColumn: regionColorSequences.minimapFloorIndicatorColumn,
      },
      null,
      'first',
    );

    const { minimapFull, minimapFloorIndicatorColumn } = initialSearchResults;

    if (minimapFull?.x !== undefined) {
      minimapRegionDef = createRegion(minimapFull, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    }

    if (minimapFloorIndicatorColumn?.x !== undefined) {
      floorIndicatorRegionDef = createRegion(minimapFloorIndicatorColumn, 2, 63);
    }

    if (!minimapRegionDef || !floorIndicatorRegionDef) {
      throw new Error('Could not locate all required minimap regions on screen.');
    }

    initialized = true;
    shouldRestart = false;
    logger('info', 'Minimap monitor regions initialized.');
  } catch (error) {
    logger('error', `Region initialization error: ${error.message}`);
    initialized = false;
    shouldRestart = true;
    if (captureInstance)
      try {
        captureInstance.stopMonitorInstance();
      } catch (e) {}
  }
}

// Helper to extract a sub-region from the full BGRA buffer
function extractBGRA(sourceBuffer, sourceMeta, rect) {
  if (!sourceBuffer || !rect || !validateRegionDimensions(rect)) return null;

  const { width: sourceWidth } = sourceMeta;
  const bytesPerPixel = 4;
  const headerSize = 8;
  const targetSize = rect.width * rect.height * bytesPerPixel;
  const targetBuffer = Buffer.alloc(targetSize);

  for (let y = 0; y < rect.height; y++) {
    const sourceY = rect.y + y;
    const sourceRowStart = headerSize + (sourceY * sourceWidth + rect.x) * bytesPerPixel;
    const targetRowStart = y * rect.width * bytesPerPixel;
    sourceBuffer.copy(targetBuffer, targetRowStart, sourceRowStart, sourceRowStart + rect.width * bytesPerPixel);
  }
  return targetBuffer;
}

async function processFrame() {
  if (isSearching || !initialized || !fullWindowBuffer) {
    return;
  }

  // Get the latest full frame from the capture thread
  const frameResult = captureInstance.getLatestFrame(fullWindowBuffer);
  if (!frameResult?.success) {
    return; // No new frame available
  }

  // --- Change Detection ---
  const now = Date.now();
  const currentMinimapData = extractBGRA(fullWindowBuffer, fullWindowBufferMetadata, minimapRegionDef);
  if (!currentMinimapData) return;

  if (lastMinimapFrameData && lastMinimapFrameData.equals(currentMinimapData) && now - lastProcessTime < REPROCESS_INTERVAL_MS) {
    return; // Frame is identical and we're within the reprocess interval, so skip.
  }
  lastProcessTime = now;
  lastMinimapFrameData = currentMinimapData; // Update last frame

  // --- Find Floor Level (Z coordinate) ---
  const searchTasks = {};
  if (floorIndicatorRegionDef) {
    searchTasks.floor = {
      sequences: floorLevelIndicators,
      searchArea: floorIndicatorRegionDef,
      occurrence: 'first',
    };
  }

  const searchResults = findSequences.findSequencesNativeBatch(fullWindowBuffer, searchTasks);
  const foundFloor = searchResults.floor || {};

  let detectedZ = null;
  let lowestY = Infinity;
  const floorKey = Object.keys(foundFloor).reduce((lowest, key) => {
    if (foundFloor[key] !== null && foundFloor[key].y < lowestY) {
      lowestY = foundFloor[key].y;
      return key;
    }
    return lowest;
  }, null);

  if (floorKey !== null) {
    detectedZ = parseInt(floorKey, 10);
  }

  if (detectedZ !== null && detectedZ !== lastKnownZ) {
    lastKnownZ = detectedZ;
    parentPort.postMessage({
      storeUpdate: true,
      type: 'gameState/setPlayerMinimapPosition',
      payload: { z: detectedZ },
    });
  }

  if (detectedZ === null) return;

  // --- Convert Minimap to Index Data for Matching ---
  const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);
  const pixelCount = MINIMAP_WIDTH * MINIMAP_HEIGHT;

  for (let i = 0; i < pixelCount; i++) {
    const pixelOffset = i * 4; // BGRA
    const b = currentMinimapData[pixelOffset];
    const g = currentMinimapData[pixelOffset + 1];
    const r = currentMinimapData[pixelOffset + 2];
    const key = (r << 16) | (g << 8) | b;
    minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
  }

  // --- Find Player Position (X, Y) ---
  isSearching = true;
  minimapMatcher.cancelCurrentSearch();

  minimapMatcher
    .findPosition(minimapIndexData, MINIMAP_WIDTH, MINIMAP_HEIGHT, detectedZ)
    .then((result) => {
      if (result?.position) {
        lastKnownZ = result.position.z;
        parentPort.postMessage({
          storeUpdate: true,
          type: 'gameState/setPlayerMinimapPosition',
          payload: {
            x: result.position.x,
            y: result.position.y,
            z: result.position.z,
          },
        });
      }
    })
    .catch((error) => {
      if (error?.message !== 'Search cancelled') {
        logger('error', `Minimap search promise rejected: ${error.message}`);
      }
    })
    .finally(() => {
      isSearching = false;
    });
}

async function mainLoop() {
  const loopStartTime = Date.now();
  try {
    if ((!initialized && state?.global?.windowId) || shouldRestart) {
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

function triggerReinitialization() {
  if (captureInstance && initialized) {
    try {
      captureInstance.stopMonitorInstance();
    } catch (e) {}
  }
  resetState();
  shouldRestart = true;
  minimapMatcher.cancelCurrentSearch();
}

async function start() {
  logger('info', 'Minimap monitor worker started.');
  try {
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
  if (captureInstance)
    try {
      captureInstance.stopMonitorInstance();
    } catch (e) {}
  process.exit(0);
});

start();
