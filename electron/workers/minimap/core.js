// /home/feiron/Dokumenty/Automaton/electron/workers/minimap/core.js
import { parentPort, workerData } from 'worker_threads';
import {
  MinimapMatcher,
  setMinimapResourcesPath,
} from '../../utils/minimapMatcher.js';
import * as config from './config.js';
import { extractBGRA } from './helpers.js';
import { processMinimapData } from './processing.js';
import { LANDMARK_SIZE } from './config.js';

let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let minimapMatcher = null;
let isProcessing = false;
let needsReProcessing = false;
let dirtyRectsQueue = [];
let lastProcessedTime = Date.now();

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
      while (dirtyRectsQueue.length > 0) {
        const currentDirtyRects = dirtyRectsQueue.shift();
        await performOperation(currentDirtyRects);
      }
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

  setInterval(() => {
    if (isShuttingDown) {
      return;
    }
    if (Date.now() - lastProcessedTime > 1000) {
      processFrames(true);
    }
  }, 200);
}
