import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import fs from 'fs/promises';
import path from 'path';
import { regionColorSequences, floorLevelIndicators } from '../constants/index.js';
import { createLogger } from '../utils/logger.js';
import { delay, calculateDelayTime, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';
import { MinimapMatcher } from '../utils/minimapMatcher.js';

const paths = workerData?.paths || {};
const logger = createLogger({ info: true, error: true, debug: false });

const require = createRequire(import.meta.url);

const x11capturePath = paths.x11capture;
const findSequencesPath = paths.findSequences;
const minimapMatcherPath = paths.minimapMatcher;

let X11RegionCapture, findSequencesNative, minimapMatcher;
let paletteData = null;

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
const PALETTE_PATH = path.join(process.cwd(), 'resources', 'preprocessed_minimaps', 'palette.json');

let colorToIndexMap = null;
let state = null;
let initialized = false;
let shouldRestart = false;
let minimapFullRegionDef = null;
let minimapFloorIndicatorColumnRegionDef = null;
let regionBuffers = new Map();
const captureInstance = new X11RegionCapture();

// --- Helper Functions (unpack4BitData, resetRegions, addAndTrackRegion)

function unpack4BitData(packedData, width, height) {
  const unpacked = new Uint8Array(width * height);
  for (let i = 0; i < packedData.length; i++) {
    const byte = packedData[i];
    const p1Index = i * 2;
    if (p1Index < unpacked.length) unpacked[p1Index] = byte >> 4;
    const p2Index = i * 2 + 1;
    if (p2Index < unpacked.length) unpacked[p2Index] = byte & 0x0f;
  }
  return unpacked;
}

function resetRegions() {
  minimapFullRegionDef = null;
  minimapFloorIndicatorColumnRegionDef = null;
  regionBuffers.clear();
}

function addAndTrackRegion(name, x, y, width, height) {
  const regionConfig = { regionName: name, winX: x, winY: y, regionWidth: width, regionHeight: height };
  try {
    captureInstance.addRegionToMonitor(regionConfig);
    const bufferSize = width * height * 3 + 8;
    const buffer = Buffer.alloc(bufferSize);
    regionBuffers.set(name, { buffer, width: 0, height: 0, timestamp: 0 });
    return regionConfig;
  } catch (e) {
    logger('error', `Failed to add/track region ${name}: ${e.message}`);
    return null;
  }
}

async function initializePalette() {
  if (paletteData) {
    logger('debug', 'Palette data already cached.');
    return;
  }

  try {
    logger('info', 'Loading and caching palette data for the first time...');
    const palettePath = path.join(process.cwd(), 'resources', 'preprocessed_minimaps', 'palette.json');
    const paletteFile = await fs.readFile(palettePath, 'utf8');
    paletteData = JSON.parse(paletteFile);

    // Also create the optimized map at the same time
    colorToIndexMap = new Map();
    paletteData.forEach((color, index) => {
      const intKey = (color.r << 16) | (color.g << 8) | color.b;
      colorToIndexMap.set(intKey, index);
    });

    logger('info', 'Palette data successfully loaded and processed.');
  } catch (error) {
    logger('error', 'CRITICAL: Failed to load palette.json.', error);
    // Rethrow to stop the worker from starting in a broken state
    throw error;
  }
}

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
    if (!initialFullFrameResult?.success) throw new Error('Failed to get initial frame.');
    const foundMinimapFull = findSequencesNative(fullWindowBuffer, { minimapFull: regionColorSequences.minimapFull }, null, 'first');
    if (foundMinimapFull?.minimapFull?.x !== undefined) {
      const def = createRegion(foundMinimapFull.minimapFull, MINIMAP_WIDTH, MINIMAP_HEIGHT);
      if (validateRegionDimensions(def)) minimapFullRegionDef = addAndTrackRegion('minimapFullRegion', def.x, def.y, def.width, def.height);
    }
    const foundFloorIndicator = findSequencesNative(
      fullWindowBuffer,
      { minimapFloorIndicatorColumn: regionColorSequences.minimapFloorIndicatorColumn },
      null,
      'first',
    );
    if (foundFloorIndicator?.minimapFloorIndicatorColumn?.x !== undefined) {
      const def = createRegion(foundFloorIndicator.minimapFloorIndicatorColumn, 2, 63);
      if (validateRegionDimensions(def))
        minimapFloorIndicatorColumnRegionDef = addAndTrackRegion('minimapFloorIndicatorColumnRegion', def.x, def.y, def.width, def.height);
    }
    initialized = true;
    shouldRestart = false;
    logger('info', 'Minimap monitor regions initialized.');
  } catch (error) {
    logger('error', `Region init error: ${error.message}`);
    initialized = false;
    shouldRestart = true;
    if (captureInstance) captureInstance.stopMonitorInstance();
  }
}

async function mainLoopIteration() {
  const loopStartTime = Date.now();
  try {
    if ((!initialized && state?.global?.windowId) || shouldRestart) {
      minimapMatcher.cancelCurrentSearch();
      await initializeRegions();
      if (!initialized) {
        resetRegions();
        return;
      }
    }

    if (initialized) {
      const regionData = {};
      for (const regionName of regionBuffers.keys()) {
        const bufferInfo = regionBuffers.get(regionName);
        const result = captureInstance.getRegionRgbData(regionName, bufferInfo.buffer);
        if (result?.success) {
          regionData[regionName] = { data: bufferInfo.buffer, ...result };
        }
      }

      let detectedZ = null;
      if (regionData.minimapFloorIndicatorColumnRegion) {
        const { data } = regionData.minimapFloorIndicatorColumnRegion;
        const foundFloor = findSequencesNative(data, floorLevelIndicators, null, 'first');
        if (foundFloor) {
          let lowestY = Infinity;
          const floorKey = Object.keys(foundFloor).reduce(
            (lowest, key) => (foundFloor[key] !== null && foundFloor[key].y < lowestY ? ((lowestY = foundFloor[key].y), key) : lowest),
            null,
          );
          if (floorKey !== null) detectedZ = parseInt(floorKey, 10);
        }
      }

      const minimapEntry = regionData.minimapFullRegion;
      if (minimapEntry && detectedZ !== null) {
        const { data, width, height } = minimapEntry;
        const rgbData = data.subarray(8);
        const packedMinimapData = Buffer.alloc(Math.ceil((width * height) / 2));

        // --- THIS IS THE CORRECTED LOOP ---
        const pixelCount = width * height;
        for (let i = 0; i < pixelCount * 3; i += 6) {
          // --- First pixel ---
          const r1 = rgbData[i],
            g1 = rgbData[i + 1],
            b1 = rgbData[i + 2];
          // Calculate the integer key, matching how the map was created.
          const key1 = (r1 << 16) | (g1 << 8) | b1;
          const index1 = colorToIndexMap.get(key1) ?? 0;

          // --- Second pixel ---
          let index2 = 0;
          if (i + 3 < rgbData.length) {
            const r2 = rgbData[i + 3],
              g2 = rgbData[i + 4],
              b2 = rgbData[i + 5];
            const key2 = (r2 << 16) | (g2 << 8) | b2;
            index2 = colorToIndexMap.get(key2) ?? 0;
          }

          // Pack the two 4-bit indices into a single byte.
          packedMinimapData[i / 6] = (index1 << 4) | index2;
        }
        const unpackedMinimap = unpack4BitData(packedMinimapData, width, height);
        // 2. Fire and forget: Start the search, don't await it.
        // The matcher class handles cancelling the previous search automatically.
        minimapMatcher
          .findPosition(unpackedMinimap, width, height, detectedZ)
          .then((result) => {
            // 3. Handle result when it arrives. This does NOT block the mainLoop.
            if (result && result.position) {
              const payload = {
                ...result.position,
                searchTimeMs: result.performance.totalTimeMs,
                searchMethod: result.performance.method,
              };
              parentPort.postMessage({ storeUpdate: true, type: 'playerMinimapPosition', payload });
            }
          })
          .catch((error) => {
            // We only care about unexpected errors, not cancellations.
            if (error && error.message !== 'Search cancelled') {
              logger('error', `Minimap search promise rejected: ${error.message}`);
            }
          });
      }
    }
  } catch (err) {
    logger('error', `Fatal error in mainLoopIteration: ${err.message}`, err);
    shouldRestart = true;
    initialized = false;
    minimapMatcher.cancelCurrentSearch();
    if (captureInstance) captureInstance.stopMonitorInstance();
  } finally {
    const loopExecutionTime = Date.now() - loopStartTime;
    const delayTime = calculateDelayTime(loopExecutionTime, TARGET_FPS);
    if (delayTime > 0) await delay(delayTime);
  }
}

async function start() {
  logger('info', 'Minimap monitor worker started.');
  try {
    await initializePalette();
    await minimapMatcher.loadMapData();

    while (true) {
      await mainLoopIteration();
    }
  } catch (err) {
    logger('error', `Worker fatal error during startup: ${err.message}`, err);
    if (parentPort) parentPort.postMessage({ fatalError: err.message });
    process.exit(1);
  }
}

parentPort.on('message', (message) => {
  if (message?.command === 'forceReinitialize') {
    if (captureInstance && initialized) captureInstance.stopMonitorInstance();

    initialized = false;
    shouldRestart = true;
    process.exit(0);
  }
  const previousWindowId = state?.global?.windowId;
  state = message;
  const newWindowId = state?.global?.windowId;
  if (newWindowId && newWindowId !== previousWindowId) {
    if (captureInstance && initialized) captureInstance.stopMonitorInstance();

    initialized = false;
    shouldRestart = true;
  }
});

parentPort.on('close', () => {
  if (captureInstance) captureInstance.stopMonitorInstance();
  process.exit(0);
});

start();
