// /home/feiron/Dokumenty/Automaton/electron/workers/minimap/core.js
import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import {
  MinimapMatcher,
  setMinimapResourcesPath,
} from '../../utils/minimapMatcher.js';
import * as config from './config.js';
import { extractBGRA } from './helpers.js';
import { processMinimapData, setSABInterface } from './processing.js';
import { LANDMARK_SIZE, MINIMAP_FALLBACK_INTERVAL_MS } from './config.js';
import { createWorkerInterface, WORKER_IDS } from '../sabState/index.js';

let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let minimapMatcher = null;
let isProcessing = false;
let needsReProcessing = false;
let dirtyRectsQueue = [];
let lastProcessedTime = Date.now();

// Region snapshot management
let regionsStale = false;
let lastRequestedRegionsVersion = -1;

const { imageSAB, syncSAB } = workerData.sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

async function initialize() {
  console.log('[MinimapCore] Initializing...');
  setMinimapResourcesPath(workerData.paths.minimapResources);

  const LANDMARK_PATTERN_BYTES = Math.ceil((LANDMARK_SIZE * LANDMARK_SIZE) / 2);

  minimapMatcher = new MinimapMatcher({
    LANDMARK_SIZE: LANDMARK_SIZE,
    LANDMARK_PATTERN_BYTES: LANDMARK_PATTERN_BYTES,
  });
  await minimapMatcher.loadMapData();
  isInitialized = true;
  console.log('[MinimapCore] Initialized successfully.');
}

async function performOperation(dirtyRects) {
  if (!isInitialized || !currentState?.regionCoordinates?.regions) {
    return;
  }

  const regions = currentState?.regionCoordinates?.regions;
  const version = currentState?.regionCoordinates?.version;

  // Request snapshot if we don't have regions yet
  if (!regions) {
    if (version !== lastRequestedRegionsVersion) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version ?? -1;
    }
    return; // Can't proceed without any regions at all
  }

  // If regions are marked stale, request a fresh snapshot but continue using cached regions
  if (regionsStale && typeof version === 'number') {
    if (version !== lastRequestedRegionsVersion) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version;
    }
  }

  const { minimapFull, minimapFloorIndicatorColumn } = regions;
  const screenWidth = Atomics.load(syncArray, config.WIDTH_INDEX);
  if (!minimapFull || !minimapFloorIndicatorColumn || screenWidth <= 0) return;

  const minimapData = extractBGRA(sharedBufferView, screenWidth, minimapFull);
  const floorIndicatorData = extractBGRA(
    sharedBufferView,
    screenWidth,
    minimapFloorIndicatorColumn,
  );

  if (minimapData && floorIndicatorData) {
    await processMinimapData(
      minimapData,
      floorIndicatorData,
      minimapMatcher,
      workerData,
    );
    lastProcessedTime = Date.now();
  }
}

async function processFrames(force = false) {
  if (isProcessing) {
    needsReProcessing = true;
    return;
  }

  if (dirtyRectsQueue.length === 0 && !force) {
    return;
  }

  isProcessing = true;

  try {
    if (dirtyRectsQueue.length > 0) {
      // Only process the LATEST frame to avoid lag
      const queueItem = dirtyRectsQueue[dirtyRectsQueue.length - 1];
      dirtyRectsQueue = []; // Clear entire queue
      
      await performOperation(queueItem.rects || queueItem);
    } else if (force) {
      await performOperation(null);
    }
  } catch (error) {
    console.error('[MinimapCore] Error during frame processing:', error);
  } finally {
    isProcessing = false;
    if (needsReProcessing) {
      needsReProcessing = false;
      setTimeout(processFrames, 0);
    }
  }
}

function handleMessage(message) {
  if (message.type === 'frame-update') {
    if (message.payload.dirtyRects && message.payload.dirtyRects.length > 0) {
      dirtyRectsQueue.push(message.payload.dirtyRects);
    }
    processFrames();
    return;
  }

  if (message.type === 'regions_snapshot') {
    if (!currentState) currentState = {};
    currentState.regionCoordinates = message.payload;
    regionsStale = false;
    return;
  }

  if (message.type === 'shutdown') {
    console.log('[MinimapCore] Received shutdown command.');
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (!currentState) currentState = {};
    const payload = message.payload || {};
    // Special-case regionCoordinates: accept version-only diffs without wiping regions
    if (payload.regionCoordinates) {
      const rc = payload.regionCoordinates;
      if (typeof rc.version === 'number' && !rc.regions) {
        if (!currentState.regionCoordinates) currentState.regionCoordinates = {};
        if (currentState.regionCoordinates.version !== rc.version) {
          currentState.regionCoordinates.version = rc.version;
          regionsStale = true;
        }
        // Remove to avoid Object.assign clobbering
        delete payload.regionCoordinates;
      }
    }
    Object.assign(currentState, payload);
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
  
  // Initialize unified SAB interface
  if (workerData.unifiedSAB) {
    const sabInterface = createWorkerInterface(workerData.unifiedSAB, WORKER_IDS.MINIMAP_MONITOR);
    setSABInterface(sabInterface);
    console.log('[MinimapCore] Unified SAB interface initialized');
  }
  
  parentPort.on('message', handleMessage);

  setInterval(() => {
    if (isShuttingDown) {
      return;
    }
    if (Date.now() - lastProcessedTime > 1000) {
      processFrames(true);
    }
  }, MINIMAP_FALLBACK_INTERVAL_MS);
}
