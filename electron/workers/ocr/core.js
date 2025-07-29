import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import * as config from './config.js';
import { PerformanceTracker } from './performanceTracker.js';
import {
  rectsIntersect,
  processBattleList,
  processOcrRegions,
} from './processing.js';

let currentState = null;
let isShuttingDown = false;
let lastProcessedFrameCounter = -1;
let initializedRegions = new Set();

const perfTracker = new PerformanceTracker();
let lastPerfReportTime = Date.now();

const { sharedData } = workerData;
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logPerformanceReport() {
  if (!config.PERFORMANCE_LOGGING_ENABLED) return;
  const now = Date.now();
  if (now - lastPerfReportTime >= config.PERFORMANCE_LOG_INTERVAL_MS) {
    console.log(perfTracker.getReport());
    perfTracker.reset();
    lastPerfReportTime = now;
  }
}

async function performOperation() {
  const opStart = performance.now();
  let processedRegionCount = 0;

  try {
    if (!currentState) return;

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

    const shouldProcessRegion = (regionName) => {
      if (!regions[regionName]) return false;
      if (!initializedRegions.has(regionName)) return true;
      for (const dirtyRect of dirtyRects) {
        if (rectsIntersect(regions[regionName], dirtyRect)) return true;
      }
      return false;
    };

    const processingTasks = [];
    const regionsToProcess = new Set();

    if (shouldProcessRegion('battleList')) {
      processingTasks.push(processBattleList(sharedBufferView, regions));
      initializedRegions.add('battleList');
    }

    for (const regionKey of Object.keys(config.OCR_REGION_CONFIGS)) {
      if (shouldProcessRegion(regionKey)) {
        regionsToProcess.add(regionKey);
        initializedRegions.add(regionKey);
      }
    }

    if (regionsToProcess.size > 0) {
      processingTasks.push(
        processOcrRegions(sharedBufferView, regions, regionsToProcess),
      );
    }

    if (processingTasks.length > 0) {
      await Promise.all(processingTasks);
      processedRegionCount =
        regionsToProcess.size +
        (processingTasks.length > regionsToProcess.size ? 1 : 0);
    }
  } catch (error) {
    console.error('[OcrCore] Error in operation:', error);
  } finally {
    if (processedRegionCount > 0) {
      const opDuration = performance.now() - opStart;
      perfTracker.addMeasurement(opDuration, processedRegionCount);
    }
  }
}

async function mainLoop() {
  console.log('[OcrCore] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performOperation();
      logPerformanceReport();
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
      const regionsChanged =
        message.payload.regionCoordinates &&
        currentState.regionCoordinates !== message.payload.regionCoordinates;
      Object.assign(currentState, message.payload);
      if (regionsChanged) {
        console.log(
          '[OcrCore] Region definitions changed, forcing re-initialization.',
        );
        initializedRegions.clear();
      }
    } else if (message.type === 'shutdown') {
      console.log('[OcrCore] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      console.log('[OcrCore] Received initial state update.');
      initializedRegions.clear();
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
