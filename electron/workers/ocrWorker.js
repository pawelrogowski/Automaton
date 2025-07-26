/**
 * @file ocrWorker.js
 * @summary A dedicated worker for OCR text recognition on UI regions.
 *
 * @description
 * This worker processes various UI regions using OCR to extract text data.
 * It uses dirty region optimization to only process areas that have changed,
 * significantly reducing CPU load while maintaining responsiveness.
 *
 * Key Features:
 * - Dirty region optimization for efficient processing
 * - Parallel OCR processing for multiple regions
 * - Automatic initialization tracking per region
 * - Graceful shutdown support
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import pkg from 'font-ocr';
import { regionParsers } from './ocrWorker/parsers.js';
import regionDefinitions from '../constants/regionDefinitions.js';

const { recognizeText } = pkg;

// --- Worker Configuration ---
const MAIN_LOOP_INTERVAL = 20; // 20ms interval for responsive OCR processing
const PERFORMANCE_LOG_INTERVAL = 10000; // Log performance every 10 seconds

// --- Shared Buffer Setup ---
const { sharedData } = workerData;
if (!sharedData) throw new Error('[OcrWorker] Shared data not provided.');

const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- Shared buffer indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4;
const DIRTY_REGION_COUNT_INDEX = 5;
const DIRTY_REGIONS_START_INDEX = 6;

// --- Worker State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;

// --- Performance Tracking ---
let operationCount = 0;
let totalOperationTime = 0;
let lastPerfReport = Date.now();
let lastProcessedFrameCounter = -1;

// Track dynamic region processing for performance monitoring
let dynamicRegionProcessCount = 0;
let staticRegionProcessCount = 0;

// --- OCR State Tracking ---
let initializedRegions = new Set();
let lastRegionStates = new Map(); // Track if regions existed in previous frame

// --- Dynamic Region Configuration ---
// Regions that may appear/disappear and need continuous monitoring
const DYNAMIC_REGIONS = new Set([
  'selectCharacterModal',
  'vipWidget',
  'chatBoxTabRow', // May change when tabs are switched
]);

// Regions that are typically always visible once initialized
const STATIC_REGIONS = new Set([
  'gameLog',
  'skillsWidget',
  'chatboxMain',
  'chatboxSecondary',
  'battleList',
]);

// Force processing interval for dynamic regions (every N frames)
const DYNAMIC_REGION_FORCE_INTERVAL = 10; // Process dynamic regions every 30 frames regardless
let framesSinceLastForce = 0;

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

    console.log(
      `[OcrWorker] Performance: ${opsPerSecond} ops/sec, avg: ${avgOpTime}ms, regions initialized: ${initializedRegions.size}, dynamic: ${dynamicRegionProcessCount}, static: ${staticRegionProcessCount}`,
    );

    // Reset counters
    operationCount = 0;
    totalOperationTime = 0;
    dynamicRegionProcessCount = 0;
    staticRegionProcessCount = 0;
    lastPerfReport = now;
  }
}

// --- Worker-specific initialization ---
function initializeWorker() {
  console.log('[OcrWorker] Initializing worker...');
  isInitialized = true;
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

// --- OCR Region Configuration ---
const OCR_REGION_CONFIGS = {
  gameLog: {
    colors: regionDefinitions.gameLog?.ocrColors || [[240, 240, 240]],
    parser: null,
  },
  skillsWidget: {
    colors: regionDefinitions.skillsWidget?.ocrColors || [
      [192, 192, 192],
      [68, 173, 37],
    ],
    parser: regionParsers.skillsWidget,
    storeAction: 'uiValues/updateSkillsWidget',
  },
  chatboxMain: {
    colors: regionDefinitions.chatboxMain?.ocrColors || [
      [240, 240, 0],
      [248, 96, 96],
      [240, 240, 240],
      [96, 248, 248],
      [32, 160, 255],
      [160, 160, 255],
      [0, 240, 0],
    ],
    parser: regionParsers.chatboxMain,
    storeAction: 'uiValues/updateRegionData',
  },
  chatboxSecondary: {
    colors: regionDefinitions.chatboxSecondary?.ocrColors || [
      [240, 240, 0],
      [248, 96, 96],
      [240, 240, 240],
      [96, 248, 248],
      [32, 160, 255],
      [160, 160, 255],
      [0, 240, 0],
    ],
    parser: regionParsers.chatboxSecondary,
    storeAction: 'uiValues/updateRegionData',
  },
  chatBoxTabRow: {
    colors: regionDefinitions.chatBoxTabRow?.ocrColors || [
      [223, 223, 223],
      [247, 95, 95],
      [127, 127, 127],
    ],
    parser: regionParsers.chatBoxTabRow,
    storeAction: 'uiValues/updateRegionData',
  },
  selectCharacterModal: {
    colors: regionDefinitions.selectCharacterModal?.ocrColors || [
      [240, 240, 240],
    ],
    parser: regionParsers.selectCharacterModal,
    storeAction: 'uiValues/updateRegionData',
  },
  vipWidget: {
    colors: regionDefinitions.vipWidget?.ocrColors || [
      [96, 248, 96],
      [248, 96, 96],
    ],
    parser: regionParsers.vipWidget,
    storeAction: 'uiValues/updateRegionData',
  },
};

// --- OCR Processing Functions ---
async function processBattleList(buffer, metadata) {
  const { regions } = currentState.regionCoordinates;
  const battleListEntries = regions.battleList?.children?.entries?.list;

  if (
    !battleListEntries ||
    !Array.isArray(battleListEntries) ||
    battleListEntries.length === 0
  ) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'uiValues/updateBattleListEntries',
      payload: [],
    });
    return;
  }

  try {
    const validNameRegions = battleListEntries
      .filter((e) => e && e.name && typeof e.name.x === 'number')
      .map((e) => e.name);

    if (validNameRegions.length > 0) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const region of validNameRegions) {
        minX = Math.min(minX, region.x);
        minY = Math.min(minY, region.y);
        maxX = Math.max(maxX, region.x + region.width);
        maxY = Math.max(maxY, region.y + region.height);
      }

      const superRegion = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };

      const monsterNameColors = regionDefinitions.battleList?.ocrColors || [
        [240, 240, 240],
      ];
      const ocrResults =
        recognizeText(buffer, superRegion, monsterNameColors) || [];

      const monsterNames = battleListEntries.map((entry) => {
        if (!entry || !entry.name) return '';
        const foundText = ocrResults.find(
          (ocrLine) => Math.abs(ocrLine.y - entry.name.y) <= 3,
        );
        return foundText ? foundText.text.trim() : '';
      });

      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateBattleListEntries',
        payload: monsterNames,
      });
    } else {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateBattleListEntries',
        payload: [],
      });
    }
  } catch (ocrError) {
    console.error(
      '[OcrWorker] OCR process failed for battleList entries:',
      ocrError,
    );
  }
}

async function processOcrRegions(buffer, metadata, regionKeys) {
  const { regions } = currentState.regionCoordinates;
  const ocrUpdates = {};
  const processingPromises = [];

  for (const regionKey of regionKeys) {
    const config = OCR_REGION_CONFIGS[regionKey];
    const region = regions[regionKey];

    if (!region || !config) continue;

    const processRegion = async () => {
      try {
        const rawData = recognizeText(buffer, region, config.colors) || [];
        ocrUpdates[regionKey] = rawData;

        if (
          config.parser &&
          rawData &&
          Array.isArray(rawData) &&
          rawData.length > 0
        ) {
          const parsedData = config.parser(rawData);

          if (
            parsedData &&
            (Array.isArray(parsedData) ? parsedData.length > 0 : true)
          ) {
            const storeAction =
              config.storeAction || 'uiValues/updateRegionData';

            if (regionKey === 'skillsWidget') {
              parentPort.postMessage({
                storeUpdate: true,
                type: storeAction,
                payload: parsedData,
              });
            } else {
              parentPort.postMessage({
                storeUpdate: true,
                type: storeAction,
                payload: { region: regionKey, data: parsedData },
              });
            }
          }
        }
      } catch (ocrError) {
        console.error(
          `[OcrWorker] OCR process failed for ${regionKey}:`,
          ocrError,
        );
      }
    };

    processingPromises.push(processRegion());
  }

  // Process all regions in parallel
  await Promise.all(processingPromises);

  // Send raw OCR data updates
  if (Object.keys(ocrUpdates).length > 0) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'ocr/setOcrRegionsText',
      payload: ocrUpdates,
    });
  }
}

// --- Helper to determine if OCR should run ---
function shouldPerformOcr(regionName, dirtyRects, forceFrame = false) {
  const { regions } = currentState.regionCoordinates;

  if (!regions[regionName]) {
    // Region no longer exists, remove from tracking
    lastRegionStates.delete(regionName);
    return false;
  }

  const regionExistedBefore = lastRegionStates.has(regionName);
  lastRegionStates.set(regionName, true);

  // Always process if this is a new region (just appeared)
  if (!regionExistedBefore) {
    console.log(`[OcrWorker] New region detected: ${regionName}`);
    return true;
  }

  // For dynamic regions, we need different logic
  if (DYNAMIC_REGIONS.has(regionName)) {
    // Force processing every N frames for dynamic regions
    if (forceFrame) {
      return true;
    }

    // Dynamic regions: always check if there are dirty regions intersecting
    for (const dirtyRect of dirtyRects) {
      if (rectsIntersect(regions[regionName], dirtyRect)) {
        return true;
      }
    }
    return false;
  }

  // For static regions: use the initialization tracking
  // Always process if this region hasn't been initialized
  if (!initializedRegions.has(regionName)) return true;

  // Check if any dirty regions intersect with this OCR region
  for (const dirtyRect of dirtyRects) {
    if (rectsIntersect(regions[regionName], dirtyRect)) return true;
  }

  return false;
}

// --- Main worker operation ---
async function performOperation() {
  if (!isInitialized || !currentState) {
    return; // Wait for initialization and state
  }

  const opStart = performance.now();

  try {
    const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

    if (
      newFrameCounter > lastProcessedFrameCounter &&
      currentState?.regionCoordinates?.regions
    ) {
      if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
        return;
      }

      const width = Atomics.load(syncArray, WIDTH_INDEX);
      const height = Atomics.load(syncArray, HEIGHT_INDEX);
      const { regions } = currentState.regionCoordinates;

      if (Object.keys(regions).length > 0 && width > 0 && height > 0) {
        lastProcessedFrameCounter = newFrameCounter;

        // Get dirty regions
        const dirtyRegionCount = Atomics.load(
          syncArray,
          DIRTY_REGION_COUNT_INDEX,
        );
        const dirtyRects = [];

        for (let i = 0; i < dirtyRegionCount; i++) {
          const offset = DIRTY_REGIONS_START_INDEX + i * 4;
          dirtyRects.push({
            x: Atomics.load(syncArray, offset + 0),
            y: Atomics.load(syncArray, offset + 1),
            width: Atomics.load(syncArray, offset + 2),
            height: Atomics.load(syncArray, offset + 3),
          });
        }

        // Debug logging for the first few frames
        if (newFrameCounter < 5 || newFrameCounter % 100 === 0) {
          console.log(
            `[OcrWorker] Frame ${newFrameCounter}: ${dirtyRegionCount} dirty regions, ${initializedRegions.size} initialized regions`,
          );
        }

        const metadata = { width, height, frameCounter: newFrameCounter };
        const processingTasks = [];
        const regionsToProcess = new Set();

        // Increment force frame counter
        framesSinceLastForce++;
        const isForceFrame =
          framesSinceLastForce >= DYNAMIC_REGION_FORCE_INTERVAL;
        if (isForceFrame) {
          framesSinceLastForce = 0;
          console.log(
            `[OcrWorker] Force processing dynamic regions on frame ${newFrameCounter}`,
          );
        }

        // Check battleList (special case - can be dynamic)
        if (shouldPerformOcr('battleList', dirtyRects, isForceFrame)) {
          if (newFrameCounter < 5)
            console.log('[OcrWorker] Processing battleList');
          processingTasks.push(processBattleList(sharedBufferView, metadata));
          // Only mark static regions as initialized
          if (STATIC_REGIONS.has('battleList')) {
            initializedRegions.add('battleList');
          }
        }

        // Check other OCR regions
        for (const regionKey of Object.keys(OCR_REGION_CONFIGS)) {
          if (shouldPerformOcr(regionKey, dirtyRects, isForceFrame)) {
            if (newFrameCounter < 5 || isForceFrame)
              console.log(`[OcrWorker] Processing ${regionKey}`);
            regionsToProcess.add(regionKey);

            // Track processing type for performance monitoring
            if (DYNAMIC_REGIONS.has(regionKey)) {
              dynamicRegionProcessCount++;
            } else {
              staticRegionProcessCount++;
            }

            // Only mark static regions as initialized
            if (STATIC_REGIONS.has(regionKey)) {
              initializedRegions.add(regionKey);
            }
          }
        }

        // Process standard OCR regions
        if (regionsToProcess.size > 0) {
          processingTasks.push(
            processOcrRegions(sharedBufferView, metadata, regionsToProcess),
          );
        }

        // Execute all OCR tasks in parallel
        if (processingTasks.length > 0) {
          await Promise.all(processingTasks);
        }
      }
    }
  } catch (error) {
    console.error('[OcrWorker] Error in operation:', error);
  } finally {
    const opEnd = performance.now();
    const opTime = opEnd - opStart;

    // Update performance stats
    operationCount++;
    totalOperationTime += opTime;

    // Log slow operations
    if (opTime > 100) {
      console.log(`[OcrWorker] Slow operation: ${opTime.toFixed(2)}ms`);
    }
  }
}

// --- Main Loop ---
async function mainLoop() {
  console.log('[OcrWorker] Starting main loop...');

  while (!isShuttingDown) {
    const loopStart = performance.now();

    try {
      await performOperation();
      logPerformanceStats();
    } catch (error) {
      console.error('[OcrWorker] Error in main loop:', error);
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

  console.log('[OcrWorker] Main loop stopped.');
}

// --- Message Handler ---
parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      // Handle state updates from WorkerManager
      if (!currentState) {
        currentState = {};
      }

      // Check if regions changed to reset initialization state
      let regionsChanged = false;
      if (
        message.payload.regionCoordinates &&
        currentState.regionCoordinates !== message.payload.regionCoordinates
      ) {
        regionsChanged = true;
      }

      // Apply state diff
      Object.assign(currentState, message.payload);

      // Reset region initialization if regions changed
      if (regionsChanged) {
        console.log(
          '[OcrWorker] Region definitions changed, forcing OCR on next frame.',
        );
        // Only clear static regions from initialization tracking
        // Dynamic regions should always be checked anyway
        for (const regionName of initializedRegions) {
          if (STATIC_REGIONS.has(regionName)) {
            initializedRegions.delete(regionName);
          }
        }
      }
    } else if (message.type === 'shutdown') {
      console.log('[OcrWorker] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      // Handle full state updates (initial state from WorkerManager)
      currentState = message;
      console.log('[OcrWorker] Received initial state update.');

      // Reset initialization state for static regions only on full state update
      for (const regionName of initializedRegions) {
        if (STATIC_REGIONS.has(regionName)) {
          initializedRegions.delete(regionName);
        }
      }

      if (!isInitialized) {
        initializeWorker();
      }
    } else {
      // Handle custom commands
      console.log('[OcrWorker] Received message:', message);
    }
  } catch (error) {
    console.error('[OcrWorker] Error handling message:', error);
  }
});

// --- Worker Startup ---
async function startWorker() {
  console.log('[OcrWorker] Worker starting up...');

  // Handle graceful shutdown signals
  process.on('SIGTERM', () => {
    console.log('[OcrWorker] Received SIGTERM, shutting down...');
    isShuttingDown = true;
  });

  process.on('SIGINT', () => {
    console.log('[OcrWorker] Received SIGINT, shutting down...');
    isShuttingDown = true;
  });

  // Start the main loop
  mainLoop().catch((error) => {
    console.error('[OcrWorker] Fatal error in main loop:', error);
    process.exit(1);
  });
}

// === WORKER-SPECIFIC HELPER FUNCTIONS ===

function validateWorkerData() {
  if (!workerData) {
    throw new Error('[OcrWorker] Worker data not provided');
  }

  if (!workerData.sharedData) {
    throw new Error('[OcrWorker] Shared data not provided in worker data');
  }
}

// Initialize and start the worker
try {
  validateWorkerData();
  startWorker();
} catch (error) {
  console.error('[OcrWorker] Failed to start worker:', error);
  process.exit(1);
}
