import { parentPort, workerData } from 'worker_threads';
import {
  MinimapMatcher,
  setMinimapResourcesPath,
} from '../../utils/minimapMatcher.js';
import * as config from './config.js';
import { extractBGRA } from './helpers.js';
import { processMinimapData } from './processing.js';
import { PerformanceTracker } from './performanceTracker.js';
import { FrameUpdateManager } from '../../utils/frameUpdateManager.js';
import { LANDMARK_SIZE } from './config.js'; // Import LANDMARK_SIZE

// --- Worker State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let minimapMatcher = null;
const frameUpdateManager = new FrameUpdateManager(); // NEW: Instantiate manager

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

  // Calculate PACKED_LANDMARK_PATTERN_BYTES based on LANDMARK_SIZE
  const LANDMARK_PATTERN_BYTES = Math.ceil((LANDMARK_SIZE * LANDMARK_SIZE) / 2);

  minimapMatcher = new MinimapMatcher({
    LANDMARK_SIZE: LANDMARK_SIZE,
    LANDMARK_PATTERN_BYTES: LANDMARK_PATTERN_BYTES,
  });
  await minimapMatcher.loadMapData();
  isInitialized = true;
  console.log('[MinimapCore] Initialized successfully.');
}

async function performOperation() {
  if (!isInitialized || !currentState?.regionCoordinates?.regions) {
    return;
  }

  // MODIFIED: Use the manager to decide if we should process
  if (!frameUpdateManager.shouldProcess()) {
    return;
  }

  const { minimapFull, minimapFloorIndicatorColumn } =
    currentState.regionCoordinates.regions;
  const screenWidth = Atomics.load(syncArray, config.WIDTH_INDEX);
  if (!minimapFull || !minimapFloorIndicatorColumn || screenWidth <= 0) return;

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

function logPerformanceReport() {
  if (!config.PERFORMANCE_LOGGING_ENABLED) return;
  const now = Date.now();
  if (now - lastPerfReportTime >= config.PERFORMANCE_LOG_INTERVAL_MS) {
    console.log(perfTracker.getReport());
    perfTracker.reset();
    lastPerfReportTime = now;
  }
}

async function mainLoop() {
  while (!isShuttingDown) {
    const loopStart = Date.now();
    try {
      await performOperation();
      logPerformanceReport();
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
  // NEW: Delegate rect accumulation to the manager
  if (message.type === 'frame-update') {
    frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
    return;
  }

  if (message.type === 'shutdown') {
    console.log('[MinimapCore] Received shutdown command.');
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (!currentState) currentState = {};
    Object.assign(currentState, message.payload);
    if (message.payload.regionCoordinates) {
      // NEW: Update the manager with the latest regions of interest
      const { regions } = currentState.regionCoordinates;
      frameUpdateManager.setRegionsOfInterest([
        regions.minimapFull,
        regions.minimapFloorIndicatorColumn,
      ]);
    }
  } else if (typeof message === 'object' && !message.type) {
    currentState = message;
    if (message.regionCoordinates) {
      // NEW: Set initial regions for the manager
      const { regions } = currentState.regionCoordinates;
      frameUpdateManager.setRegionsOfInterest([
        regions.minimapFull,
        regions.minimapFloorIndicatorColumn,
      ]);
    }
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
