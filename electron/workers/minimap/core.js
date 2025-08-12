import { parentPort, workerData } from 'worker_threads';
import {
  MinimapMatcher,
  setMinimapResourcesPath,
} from '../../utils/minimapMatcher.js';
import * as config from './config.js';
import { rectsIntersect, extractBGRA } from './helpers.js';
import { processMinimapData } from './processing.js';
import { PerformanceTracker } from './performanceTracker.js';

// --- Worker State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let lastProcessedFrameCounter = -1;
let lastKnownMinimapFull = null;
let lastKnownMinimapFloor = null;
let minimapMatcher = null;

// --- Performance Tracking State ---
const perfTracker = new PerformanceTracker();
let lastPerfReportTime = Date.now();

// --- Shared Buffer Setup ---
if (!workerData.sharedData)
  throw new Error('[MinimapCore] Shared data not provided.');
const { imageSAB, syncSAB } = workerData.sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function initialize() {
  console.log('[MinimapCore] Initializing...');
  setMinimapResourcesPath(workerData.paths.minimapResources);
  minimapMatcher = new MinimapMatcher();
  await minimapMatcher.loadMapData();
  isInitialized = true;
  console.log('[MinimapCore] Initialized successfully.');
}

async function performOperation() {
  if (!isInitialized || !currentState?.regionCoordinates?.regions) {
    return;
  }

  const newFrameCounter = Atomics.load(syncArray, config.FRAME_COUNTER_INDEX);
  if (newFrameCounter <= lastProcessedFrameCounter) {
    return;
  }

  const { minimapFull, minimapFloorIndicatorColumn } =
    currentState.regionCoordinates.regions;
  const screenWidth = Atomics.load(syncArray, config.WIDTH_INDEX);
  if (!minimapFull || !minimapFloorIndicatorColumn || screenWidth <= 0) return;

  let needsProcessing = false;
  const dirtyRegionCount = Atomics.load(
    syncArray,
    config.DIRTY_REGION_COUNT_INDEX,
  );
  for (let i = 0; i < dirtyRegionCount; i++) {
    const offset = config.DIRTY_REGIONS_START_INDEX + i * 4;
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

  // --- Robust Frame-Based Fallback Logic ---
  const framesBehind = newFrameCounter - lastProcessedFrameCounter;
  const isFallbackTriggered = framesBehind > config.MAX_FRAME_FALLBEHIND;

  if (needsProcessing || isFallbackTriggered) {
    // Update the counter to prevent reprocessing the same frame.
    lastProcessedFrameCounter = newFrameCounter;

    const minimapData = extractBGRA(sharedBufferView, screenWidth, minimapFull);
    const floorIndicatorData = extractBGRA(
      sharedBufferView,
      screenWidth,
      minimapFloorIndicatorColumn,
    );

    if (minimapData && floorIndicatorData) {
      const duration = await processMinimapData(
        minimapData,
        floorIndicatorData,
        minimapMatcher,
        workerData,
      );
      if (typeof duration === 'number') {
        perfTracker.addMeasurement(duration);
      }
    }
  }
}

/**
 * Checks if it's time to log performance stats and does so if needed.
 */
function logPerformanceReport() {
  if (!config.PERFORMANCE_LOGGING_ENABLED) return;

  const now = Date.now();
  if (now - lastPerfReportTime >= config.PERFORMANCE_LOG_INTERVAL_MS) {
    console.log(perfTracker.getReport());
    perfTracker.reset(); // Reset for the next interval
    lastPerfReportTime = now;
  }
}

async function mainLoop() {
  while (!isShuttingDown) {
    const loopStart = Date.now();
    try {
      await performOperation();
      logPerformanceReport(); // Call the report logger every loop
    } catch (error) {
      console.error('[MinimapCore] Error in main loop:', error);
    }
    const elapsedTime = Date.now() - loopStart;
    const delayTime = Math.max(0, config.MAIN_LOOP_INTERVAL - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  console.log('[MinimapCore] Main loop stopped.');
}

function handleMessage(message) {
  if (message.type === 'shutdown') {
    console.log('[MinimapCore] Received shutdown command.');
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (!currentState) currentState = {};
    Object.assign(currentState, message.payload);
  } else if (typeof message === 'object' && !message.type) {
    currentState = message;
    if (!isInitialized) {
      initialize().catch((err) => {
        console.error('[MinimapCore] Initialization failed:', err);
        process.exit(1);
      });
    }
  }
}

export function start() {
  console.log('[MinimapCore] Worker starting up.');
  parentPort.on('message', handleMessage);
  mainLoop();
}
