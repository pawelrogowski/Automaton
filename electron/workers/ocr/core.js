import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import * as config from './config.js';
import {
  rectsIntersect,
  processBattleList,
  processOcrRegions,
  deepCompareEntities,
  processGameWorldEntities,
} from './processing.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from '../sharedConstants.js';

let currentState = null;
let isShuttingDown = false;
let lastProcessedFrameCounter = -1;
let lastRegionHash = null;

let oneTimeInitializedRegions = new Set();
const pendingThrottledRegions = new Map();

const { sharedData } = workerData;
const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

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
    if (now - startTime >= regionConfig.throttle) {
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
    if (!currentState || !currentState.regionCoordinates) return;

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
    const immediateRegionsToProcess = new Set();

    // --- CORRECTED BATTLE LIST LOGIC ---
    // The battle list is critical and not throttled.
    // The rule is simple: if it exists, process it on every frame.
    // This ensures we never miss an entry appearing or disappearing.
    if (regions.battleList) {
      processingTasks.push(processBattleList(sharedBufferView, regions));
    }

    // Handle all other configured regions
    for (const regionKey of Object.keys(config.OCR_REGION_CONFIGS)) {
      if (!regions[regionKey]) continue;

      const isDirty = dirtyRects.some((dirtyRect) =>
        rectsIntersect(regions[regionKey], dirtyRect),
      );
      const isInitialized = oneTimeInitializedRegions.has(regionKey);
      const regionConfig = config.OCR_REGION_CONFIGS[regionKey];

      if (isDirty || !isInitialized) {
        if (regionConfig.throttle) {
          if (!pendingThrottledRegions.has(regionKey)) {
            pendingThrottledRegions.set(regionKey, Date.now());
          }
        } else {
          immediateRegionsToProcess.add(regionKey);
          oneTimeInitializedRegions.add(regionKey);
        }
      }
    }

    if (immediateRegionsToProcess.size > 0) {
      const ocrResultsPromise = processOcrRegions(
        sharedBufferView,
        regions,
        immediateRegionsToProcess,
      );
      processingTasks.push(
        ocrResultsPromise.then((ocrRawUpdates) => {
          if (ocrRawUpdates?.gameWorld) {
            const playerMinimapPosition = {
              x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
              y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
              z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
            };
            return processGameWorldEntities(
              ocrRawUpdates.gameWorld,
              playerMinimapPosition,
              regions.gameWorld,
              regions.tileSize,
            );
          }
        }),
      );
    }

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
    try {
      await performOperation();
      await processPendingRegions();
    } catch (error) {
      console.error('[OcrCore] Error in main loop:', error);
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

      if (message.payload.regionCoordinates) {
        const newHash = hashRegionCoordinates(
          message.payload.regionCoordinates,
        );
        if (newHash !== lastRegionHash) {
          lastRegionHash = newHash;
          console.log(
            '[OcrCore] Region definitions changed. New regions will be initialized on next frame.',
          );
        } else {
          delete message.payload.regionCoordinates;
        }
      }

      Object.assign(currentState, message.payload);
    } else if (message.type === 'shutdown') {
      console.log('[OcrCore] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      lastRegionHash = hashRegionCoordinates(message.regionCoordinates || {});
      console.log('[OcrCore] Received initial state update.');
      oneTimeInitializedRegions.clear();
      pendingThrottledRegions.clear();
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
