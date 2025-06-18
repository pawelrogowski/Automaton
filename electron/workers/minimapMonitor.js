// This worker script continuously monitors a specific region of the game window to capture the minimap.
// On startup, it loads a pre-generated `palette.json` to understand the minimap's exact color scheme.
// In a loop, it captures the minimap as raw RGB pixel data. To prevent wasting CPU cycles on stale data,
// it uses a "cancellation token" system. When a new frame of data is captured, it signals any ongoing
// search from the previous frame to be cancelled. It then converts the new RGB data into a highly optimized
// 4-bit indexed format and starts a new search, passing it a new token. This ensures the application is
// always processing the most up-to-date information and remains highly responsive.

import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import fs from 'fs/promises';
import path from 'path';
import { regionColorSequences } from '../constants/index.js';
import { createLogger } from '../utils/logger.js';
import { delay, calculateDelayTime, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';
import { minimapMatcher } from '../utils/minimapMatcher.js';

const require = createRequire(import.meta.url);
const x11capturePath = workerData?.x11capturePath;
const findSequencesPath = workerData?.findSequencesPath;
let X11RegionCapture = null;
let findSequencesNative = null;

try {
  ({ X11RegionCapture } = require(x11capturePath));
  ({ findSequencesNative } = require(findSequencesPath));
} catch (e) {
  parentPort.postMessage({ fatalError: `Failed to load native modules: ${e.message}` });
  process.exit(1);
}

const TARGET_FPS = 10;
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
const PALETTE_PATH = path.join(process.cwd(), 'resources', 'preprocessed_minimaps', 'palette.json');

const logger = createLogger({ info: true, error: true, debug: false });

let state = null;
let initialized = false;
let shouldRestart = false;
let minimapFullRegionDef = null;
let regionBuffers = new Map();
let currentWindowId = null;

const captureInstance = X11RegionCapture ? new X11RegionCapture() : null;

// --- Cancellation Token for the search task ---
let currentSearchToken = null;
let colorToIndexMap = null;

/**
 * Converts a raw RGB buffer to the packed 4-bit indexed format.
 * @param {Buffer} rgbBuffer The raw RGB pixel data (3 bytes per pixel).
 * @param {number} width The width of the image.
 * @param {number} height The height of the image.
 * @returns {Buffer} A new buffer with the 4-bit packed data.
 */
function convertRgbTo4BitPacked(rgbBuffer, width, height) {
  if (!colorToIndexMap) {
    logger('error', 'Color palette not loaded, cannot convert RGB data.');
    return Buffer.alloc(0);
  }
  const pixelCount = width * height;
  const packedData = Buffer.alloc(Math.ceil(pixelCount / 2));
  let packedDataIndex = 0;

  for (let i = 0; i < pixelCount * 3; i += 6) {
    const r1 = rgbBuffer[i],
      g1 = rgbBuffer[i + 1],
      b1 = rgbBuffer[i + 2];
    const index1 = colorToIndexMap.get(`${r1},${g1},${b1}`) ?? 0;

    let index2 = 0;
    if (i + 3 < rgbBuffer.length) {
      const r2 = rgbBuffer[i + 3],
        g2 = rgbBuffer[i + 4],
        b2 = rgbBuffer[i + 5];
      index2 = colorToIndexMap.get(`${r2},${g2},${b2}`) ?? 0;
    }

    const byte = (index1 << 4) | index2;
    packedData[packedDataIndex++] = byte;
  }
  return packedData;
}

function resetRegions() {
  minimapFullRegionDef = null;
  regionBuffers.clear();
}

function addAndTrackRegion(name, x, y, width, height) {
  const regionConfig = { regionName: name, winX: x, winY: y, regionWidth: width, regionHeight: height };
  try {
    captureInstance.addRegionToMonitor(regionConfig);
    const bufferSize = width * height * 3 + 8;
    const buffer = Buffer.alloc(bufferSize);
    regionBuffers.set(name, { buffer, x, y, width, height, timestamp: 0 });
    logger('info', `Added and tracking region: ${name} at (${x}, ${y}) with dimensions ${width}x${height}`);
    return regionConfig;
  } catch (e) {
    logger('error', `Failed to add and track region ${name}: ${e.message}`);
    return null;
  }
}

async function initializeRegions() {
  if (!state?.global?.windowId) {
    initialized = false;
    shouldRestart = true;
    logger('warn', 'Window ID not available, cannot initialize regions. Restarting...');
    return;
  }

  resetRegions();
  let initialFullFrameResult = null;
  try {
    const windowId = state.global.windowId;
    if (captureInstance) {
      captureInstance.startMonitorInstance(windowId, TARGET_FPS);
      logger('info', `Started monitor instance for window ID: ${windowId} at ${TARGET_FPS} FPS.`);
    } else {
      throw new Error('X11RegionCapture instance not available.');
    }
  } catch (startError) {
    logger('error', `Failed to start monitor instance: ${startError.message}`);
    initialized = false;
    shouldRestart = true;
    resetRegions();
    return;
  }

  const estimatedMaxSize = 2560 * 1600 * 3 + 8;
  const fullWindowBuffer = Buffer.alloc(estimatedMaxSize);
  initialFullFrameResult = captureInstance.getFullWindowImageData(fullWindowBuffer);

  if (!initialFullFrameResult?.success) {
    logger('error', `Failed to get initial full window frame. Result: ${JSON.stringify(initialFullFrameResult)}`);
    initialized = false;
    shouldRestart = true;
    resetRegions();
    return;
  }

  try {
    const foundMinimapFull = findSequencesNative(fullWindowBuffer, { minimapFull: regionColorSequences.minimapFull }, null, 'first');
    if (foundMinimapFull?.minimapFull?.x !== undefined) {
      const minimapFullDefAttempt = createRegion(foundMinimapFull.minimapFull, MINIMAP_WIDTH, MINIMAP_HEIGHT);
      if (validateRegionDimensions(minimapFullDefAttempt)) {
        minimapFullRegionDef = addAndTrackRegion(
          'minimapFullRegion',
          minimapFullDefAttempt.x,
          minimapFullDefAttempt.y,
          minimapFullDefAttempt.width,
          minimapFullDefAttempt.height,
        );
        if (minimapFullRegionDef) {
          initialized = true;
          shouldRestart = false;
          logger('info', 'MinimapFull region successfully initialized.');
        } else {
          throw new Error('Failed to add and track minimapFull region.');
        }
      } else {
        throw new Error('MinimapFull region dimensions are invalid after creation.');
      }
    } else {
      throw new Error('MinimapFull sequence not found in the initial full window frame.');
    }
  } catch (error) {
    logger('error', `Error during region initialization: ${error.message}`);
    initialized = false;
    shouldRestart = true;
    currentWindowId = null;
    resetRegions();
    if (captureInstance && state?.global?.windowId) {
      try {
        captureInstance.stopMonitorInstance();
        logger('info', 'Stopped monitor instance due to initialization error.');
      } catch (e) {
        logger('error', `Error stopping monitor instance: ${e.message}`);
      }
    }
  }
}

async function mainLoopIteration() {
  const loopStartTime = Date.now();
  try {
    if ((!initialized && state?.global?.windowId) || shouldRestart) {
      if (currentSearchToken) {
        currentSearchToken.isCancelled = true;
        currentSearchToken = null;
      }
      await initializeRegions();
      if (!initialized) {
        logger('warn', 'Initialization failed, resetting regions and waiting for next loop.');
        resetRegions();
        return;
      }
    }

    if (initialized && minimapFullRegionDef) {
      const regionBufferInfo = regionBuffers.get('minimapFullRegion');
      if (regionBufferInfo) {
        const regionResult = captureInstance.getRegionRgbData('minimapFullRegion', regionBufferInfo.buffer);

        if (regionResult?.success && regionResult.width > 0 && regionResult.height > 0) {
          // 1. Cancel any previous, still-running search.
          if (currentSearchToken) {
            currentSearchToken.isCancelled = true;
          }

          // 2. Create a new token for this search.
          const searchToken = { isCancelled: false };
          currentSearchToken = searchToken;

          regionBufferInfo.width = regionResult.width;
          regionBufferInfo.height = regionResult.height;
          regionBufferInfo.timestamp = regionResult.captureTimestampUs;
          const imageData = regionBufferInfo.buffer.subarray(8, regionResult.width * regionResult.height * 3 + 8);
          const { width, height } = regionResult;
          const packedMinimapData = convertRgbTo4BitPacked(imageData, width, height);

          // 3. Pass the token to the findPosition function.
          const position = await minimapMatcher.findPosition(packedMinimapData, width, height, searchToken);

          // 4. Only process the result if our token wasn't cancelled by a newer frame.
          if (!searchToken.isCancelled) {
            currentSearchToken = null; // Mark this search as complete.

            if (position) {
              parentPort.postMessage({ storeUpdate: true, type: 'playerMinimapPosition', payload: position });
              logger('info', `Player position found: X=${position.x}, Y=${position.y}, Z=${position.z}`);
            } else {
              parentPort.postMessage({ storeUpdate: true, type: 'playerMinimapPosition', payload: { x: null, y: null, z: null } });
              logger('warn', 'Player position not found on minimap (or search was cancelled).');
            }
          } else {
            logger('debug', 'Search result ignored as it was cancelled by a newer frame.');
          }

          parentPort.postMessage({ type: 'minimapFullData', imageData, width, height, timestamp: regionResult.captureTimestampUs });
        } else {
          logger('warn', `Failed to capture minimapFullRegion data. Result: ${JSON.stringify(regionResult)}`);
        }
      } else {
        logger('error', '[Worker] regionBufferInfo not found for "minimapFullRegion".');
        shouldRestart = true;
        initialized = false;
      }
    }
  } catch (err) {
    logger('error', `Fatal error in mainLoopIteration: ${err.message}`, err);
    shouldRestart = true;
    initialized = false;
    currentSearchToken = null;
    if (captureInstance) {
      try {
        captureInstance.stopMonitorInstance();
        logger('info', 'Stopped monitor instance due to fatal error.');
      } catch (e) {
        logger('error', `Error stopping monitor instance after fatal error: ${e.message}`);
      }
    }
  } finally {
    const loopExecutionTime = Date.now() - loopStartTime;
    const delayTime = calculateDelayTime(loopExecutionTime, TARGET_FPS);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

async function start() {
  logger('info', 'Minimap monitor worker started.');
  try {
    const paletteData = JSON.parse(await fs.readFile(PALETTE_PATH, 'utf-8'));
    colorToIndexMap = new Map();
    paletteData.forEach((color, index) => {
      colorToIndexMap.set(`${color.r},${color.g},${color.b}`, index);
    });
    logger('info', `Successfully loaded color palette with ${colorToIndexMap.size} colors.`);
  } catch (err) {
    logger('error', `FATAL: Could not load palette.json from ${PALETTE_PATH}. ${err.message}`);
    parentPort.postMessage({ fatalError: `Failed to load color palette: ${err.message}` });
    process.exit(1);
  }

  await minimapMatcher.loadMapData();
  while (true) {
    await mainLoopIteration();
  }
}

parentPort.on('message', (message) => {
  if (message && message.command === 'forceReinitialize') {
    logger('info', 'Received forceReinitialize command.');
    if (captureInstance && initialized) {
      try {
        captureInstance.stopMonitorInstance();
        logger('info', 'Stopped monitor instance for force reinitialization.');
      } catch (e) {
        logger('error', `Error stopping monitor instance during force reinitialize: ${e.message}`);
      }
    }
    initialized = false;
    shouldRestart = true;
    currentWindowId = null;
    resetRegions();
    return;
  }
  const previousWindowId = state?.global?.windowId;
  state = message;
  const newWindowId = state?.global?.windowId;
  if (newWindowId && newWindowId !== previousWindowId) {
    logger('info', `Window ID changed from ${previousWindowId} to ${newWindowId}. Forcing reinitialization.`);
    if (captureInstance && initialized) {
      try {
        captureInstance.stopMonitorInstance();
        logger('info', 'Stopped monitor instance due to window ID change.');
      } catch (e) {
        logger('error', `Error stopping monitor instance during window ID change: ${e.message}`);
      }
    }
    initialized = false;
    shouldRestart = true;
    currentWindowId = newWindowId;
    resetRegions();
    return;
  }
});

parentPort.on('close', async () => {
  logger('info', 'Minimap monitor worker closing.');
  if (currentSearchToken) {
    currentSearchToken.isCancelled = true;
  }
  if (captureInstance) {
    try {
      captureInstance.stopMonitorInstance();
      logger('info', 'Stopped monitor instance on worker close.');
    } catch (e) {
      logger('error', `Error stopping monitor instance on worker close: ${e.message}`);
    }
  }
  resetRegions();
  process.exit(0);
});

start().catch(async (err) => {
  logger('error', `Worker fatal error: ${err.message}`, err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  if (captureInstance) {
    try {
      captureInstance.stopMonitorInstance();
      logger('info', 'Stopped monitor instance after fatal error.');
    } catch (e) {
      logger('error', `Error stopping monitor instance after fatal error: ${e.message}`);
    }
  }
  resetRegions();
  process.exit(1);
});
