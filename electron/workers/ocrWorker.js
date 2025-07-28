// @ocrWorker.js (Simplified and more reliable)
/**
 * @file ocrWorker.js
 * @summary A dedicated worker for OCR text recognition on UI regions.
 *
 * @description
 * This worker processes various UI regions using OCR to extract text data.
 * It uses dirty region optimization to only process areas that have changed,
 * significantly reducing CPU load while maintaining responsiveness.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import pkg from 'font-ocr';
import { regionParsers } from './ocrWorker/parsers.js';
import regionDefinitions from '../constants/regionDefinitions.js';

const { recognizeText } = pkg;

// --- Worker Configuration ---
const MAIN_LOOP_INTERVAL = 20;
const PERFORMANCE_LOG_INTERVAL = 10000;

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

// --- OCR State Tracking ---
let initializedRegions = new Set();

// --- Utilities (unchanged) ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  )
    return false;
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

// --- Performance Monitoring (unchanged) ---
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
      `[OcrWorker] Perf: ${opsPerSecond} ops/s, avg: ${avgOpTime}ms, regions initialized: ${initializedRegions.size}`,
    );
    operationCount = 0;
    totalOperationTime = 0;
    lastPerfReport = now;
  }
}

// --- Worker Initialization (unchanged) ---
function initializeWorker() {
  console.log('[OcrWorker] Initializing worker...');
  isInitialized = true;
}

// --- OCR Region Configs and Processing Functions (unchanged) ---
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
      [247, 247, 247],
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
  await Promise.all(processingPromises);
  if (Object.keys(ocrUpdates).length > 0) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'ocr/setOcrRegionsText',
      payload: ocrUpdates,
    });
  }
}

// --- Main worker operation ---
async function performOperation() {
  if (!isInitialized || !currentState) return;

  const opStart = performance.now();
  try {
    const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
    if (newFrameCounter <= lastProcessedFrameCounter) return;

    if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) return;

    const width = Atomics.load(syncArray, WIDTH_INDEX);
    const height = Atomics.load(syncArray, HEIGHT_INDEX);
    const { regions } = currentState.regionCoordinates;

    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) return;

    lastProcessedFrameCounter = newFrameCounter;

    const dirtyRegionCount = Atomics.load(syncArray, DIRTY_REGION_COUNT_INDEX);
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

    const metadata = { width, height, frameCounter: newFrameCounter };
    const processingTasks = [];
    const regionsToProcess = new Set();

    // --- [SIMPLIFIED] --- Unified logic for all regions.
    const shouldProcessRegion = (regionName) => {
      if (!regions[regionName]) return false;
      if (!initializedRegions.has(regionName)) return true;
      for (const dirtyRect of dirtyRects) {
        if (rectsIntersect(regions[regionName], dirtyRect)) return true;
      }
      return false;
    };

    // Check battleList
    if (shouldProcessRegion('battleList')) {
      processingTasks.push(processBattleList(sharedBufferView, metadata));
      initializedRegions.add('battleList');
    }

    // Check other OCR regions
    for (const regionKey of Object.keys(OCR_REGION_CONFIGS)) {
      if (shouldProcessRegion(regionKey)) {
        regionsToProcess.add(regionKey);
        initializedRegions.add(regionKey);
      }
    }

    if (regionsToProcess.size > 0) {
      processingTasks.push(
        processOcrRegions(sharedBufferView, metadata, regionsToProcess),
      );
    }

    if (processingTasks.length > 0) {
      await Promise.all(processingTasks);
    }
  } catch (error) {
    console.error('[OcrWorker] Error in operation:', error);
  } finally {
    const opEnd = performance.now();
    operationCount++;
    totalOperationTime += opEnd - opStart;
    if (opEnd - opStart > 100) {
      console.log(
        `[OcrWorker] Slow operation: ${(opEnd - opStart).toFixed(2)}ms`,
      );
    }
  }
}

// --- Main Loop & Message Handler (Unchanged) ---
async function mainLoop() {
  console.log('[OcrWorker] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performOperation();
      logPerformanceStats();
    } catch (error) {
      console.error('[OcrWorker] Error in main loop:', error);
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
parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      const regionsChanged =
        message.payload.regionCoordinates &&
        currentState.regionCoordinates !== message.payload.regionCoordinates;
      Object.assign(currentState, message.payload);
      if (regionsChanged) {
        console.log(
          '[OcrWorker] Region definitions changed, forcing re-initialization.',
        );
        initializedRegions.clear();
      }
    } else if (message.type === 'shutdown') {
      console.log('[OcrWorker] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      console.log('[OcrWorker] Received initial state update.');
      initializedRegions.clear();
      if (!isInitialized) {
        initializeWorker();
      }
    } else {
      console.log('[OcrWorker] Received message:', message);
    }
  } catch (error) {
    console.error('[OcrWorker] Error handling message:', error);
  }
});
async function startWorker() {
  console.log('[OcrWorker] Worker starting up...');
  process.on('SIGTERM', () => {
    console.log('[OcrWorker] Received SIGTERM, shutting down...');
    isShuttingDown = true;
  });
  process.on('SIGINT', () => {
    console.log('[OcrWorker] Received SIGINT, shutting down...');
    isShuttingDown = true;
  });
  mainLoop().catch((error) => {
    console.error('[OcrWorker] Fatal error in main loop:', error);
    process.exit(1);
  });
}
function validateWorkerData() {
  if (!workerData || !workerData.sharedData) {
    throw new Error('[OcrWorker] Shared data not provided');
  }
}
try {
  validateWorkerData();
  startWorker();
} catch (error) {
  console.error('[OcrWorker] Failed to start worker:', error);
  process.exit(1);
}
