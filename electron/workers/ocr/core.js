// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/core.js
// --- REFACTORED ---

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import * as config from './config.js';
import {
  rectsIntersect,
  processOcrRegions,
  processBattleListOcr, // Import the new dedicated function
} from './processing.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let lastProcessedFrameCounter = -1;
let lastRegionHash = null;
let oneTimeInitializedRegions = new Set();
const pendingThrottledRegions = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashRegionCoordinates(regionCoordinates) {
  if (!regionCoordinates || typeof regionCoordinates !== 'object') {
    return JSON.stringify(regionCoordinates);
  }
  const replacer = (key, value) =>
    value instanceof Object && !(value instanceof Array)
      ? Object.keys(value)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = value[key];
            return sorted;
          }, {})
      : value;
  return JSON.stringify(regionCoordinates, replacer);
}

async function processPendingRegions() {
  if (pendingThrottledRegions.size === 0) return;
  const now = Date.now();
  const regionsToProcessNow = new Set();
  for (const [regionKey, startTime] of pendingThrottledRegions.entries()) {
    const regionConfig = config.OCR_REGION_CONFIGS[regionKey];
    if (now - startTime >= (regionConfig.throttle || 0)) {
      regionsToProcessNow.add(regionKey);
    }
  }
  if (regionsToProcessNow.size > 0) {
    await processOcrRegions(
      sharedBufferView,
      currentState.regionCoordinates.regions,
      regionsToProcessNow,
    );
    for (const regionKey of regionsToProcessNow) {
      pendingThrottledRegions.delete(regionKey);
    }
  }
}

async function performOperation() {
  try {
    if (!isInitialized || !currentState || !currentState.regionCoordinates)
      return;

    const newFrameCounter = Atomics.load(syncArray, config.FRAME_COUNTER_INDEX);
    if (
      newFrameCounter <= lastProcessedFrameCounter ||
      Atomics.load(syncArray, config.IS_RUNNING_INDEX) !== 1
    ) {
      return;
    }

    const width = Atomics.load(syncArray, config.WIDTH_INDEX);
    const height = Atomics.load(syncArray, config.HEIGHT_INDEX);
    const { regions } = currentState.regionCoordinates;
    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) return;

    lastProcessedFrameCounter = newFrameCounter;

    const dirtyRegionCount = Atomics.load(
      syncArray,
      config.DIRTY_REGION_COUNT_INDEX,
    );
    const dirtyRects = [];
    for (let i = 0; i < dirtyRegionCount; i++) {
      const offset = config.DIRTY_REGIONS_START_INDEX + i * 4;
      dirtyRects.push({
        x: Atomics.load(syncArray, offset + 0),
        y: Atomics.load(syncArray, offset + 1),
        width: Atomics.load(syncArray, offset + 2),
        height: Atomics.load(syncArray, offset + 3),
      });
    }

    const processingTasks = [];
    const immediateGenericRegions = new Set();

    // --- MODIFIED LOGIC ---
    // 1. Handle Battle List with its dedicated, specialized processor first.
    if (regions.battleList) {
      const isDirty = dirtyRects.some((dirtyRect) =>
        rectsIntersect(regions.battleList, dirtyRect),
      );
      if (isDirty || !oneTimeInitializedRegions.has('battleList')) {
        processingTasks.push(processBattleListOcr(sharedBufferView, regions));
        oneTimeInitializedRegions.add('battleList');
      }
    }

    // 2. Handle all other generic OCR regions.
    for (const regionKey in config.OCR_REGION_CONFIGS) {
      const region = regions[regionKey];
      if (!region) continue;

      const isDirty = dirtyRects.some((dirtyRect) =>
        rectsIntersect(region, dirtyRect),
      );
      const needsOneTimeInit = !oneTimeInitializedRegions.has(regionKey);

      if (isDirty || needsOneTimeInit) {
        const regionConfig = config.OCR_REGION_CONFIGS[regionKey];
        if (regionConfig.throttle && !needsOneTimeInit) {
          if (!pendingThrottledRegions.has(regionKey)) {
            pendingThrottledRegions.set(regionKey, Date.now());
          }
        } else {
          immediateGenericRegions.add(regionKey);
          if (needsOneTimeInit) {
            oneTimeInitializedRegions.add(regionKey);
          }
        }
      }
    }

    if (immediateGenericRegions.size > 0) {
      processingTasks.push(
        processOcrRegions(sharedBufferView, regions, immediateGenericRegions),
      );
    }
    // --- END MODIFICATION ---

    if (processingTasks.length > 0) {
      await Promise.all(processingTasks);
    }
  } catch (error) {
    console.error('[OcrCore] Error in operation:', error);
  }
}

async function mainLoop() {
  console.log('[OcrCore] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    if (isInitialized) {
      await performOperation();
      await processPendingRegions();
    }
    const elapsedTime = performance.now() - loopStart;
    const delayTime = Math.max(0, config.MAIN_LOOP_INTERVAL - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  console.log('[OcrCore] Main loop stopped.');
}

function handleMessage(message) {
  try {
    if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      const payload = message.payload;
      if (payload.regionCoordinates) {
        const newHash = hashRegionCoordinates(payload.regionCoordinates);
        if (newHash !== lastRegionHash) {
          lastRegionHash = newHash;
          oneTimeInitializedRegions.clear();
        }
      }
      Object.assign(currentState, payload);
    } else if (message.type === 'shutdown') {
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      lastRegionHash = hashRegionCoordinates(message.regionCoordinates || {});
      oneTimeInitializedRegions.clear();
      if (!isInitialized) {
        isInitialized = true;
        console.log('[OcrCore] Initial state received. Worker is now active.');
      }
    }
  } catch (error) {
    console.error('[OcrCore] Error handling message:', error);
  }
}

export async function start() {
  console.log('[OcrCore] Worker starting up...');
  if (!workerData?.sharedData) {
    throw new Error('[OcrCore] Shared data not provided');
  }
  parentPort.on('message', handleMessage);
  mainLoop().catch((error) => {
    console.error('[OcrCore] Fatal error in main loop:', error);
    process.exit(1);
  });
}
