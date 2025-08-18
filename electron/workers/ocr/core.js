import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import * as config from './config.js';
import {
  processBattleList,
  processOcrRegions,
  processGameWorldEntities,
} from './processing.js';
import { FrameUpdateManager } from '../../utils/frameUpdateManager.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from '../sharedConstants.js';

let currentState = null;
let isShuttingDown = false;
let hasScannedInitially = false; // NEW: Flag for the initial scan
const frameUpdateManager = new FrameUpdateManager();

const { sharedData, playerPosSAB } = workerData;
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function performOperation() {
  try {
    if (!currentState || !currentState.regionCoordinates) return;

    // MODIFIED: Use the manager and the initial scan flag to decide if we should process
    if (!hasScannedInitially && !frameUpdateManager.shouldProcess()) {
      return;
    }

    if (Atomics.load(syncArray, config.IS_RUNNING_INDEX) !== 1) return;

    const { regions } = currentState.regionCoordinates;
    if (Object.keys(regions).length === 0) return;

    const processingTasks = [];

    if (regions.battleList) {
      processingTasks.push(processBattleList(sharedBufferView, regions));
    }

    const ocrRegionsToProcess = Object.keys(config.OCR_REGION_CONFIGS);
    if (ocrRegionsToProcess.length > 0) {
      const ocrResultsPromise = processOcrRegions(
        sharedBufferView,
        regions,
        ocrRegionsToProcess,
      );
      processingTasks.push(
        ocrResultsPromise.then((ocrRawUpdates) => {
          if (ocrRawUpdates?.gameWorld && playerPosArray) {
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
      hasScannedInitially = true; // NEW: Set flag after the first successful scan
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
    if (message.type === 'frame-update') {
      frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
      return;
    }

    if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      Object.assign(currentState, message.payload);
      if (message.payload.regionCoordinates) {
        const { regions } = currentState.regionCoordinates;
        const ocrRegions = Object.keys(config.OCR_REGION_CONFIGS)
          .map((key) => regions[key])
          .filter(Boolean);
        frameUpdateManager.setRegionsOfInterest(ocrRegions);
        hasScannedInitially = false; // NEW: Reset flag if regions change
      }
    } else if (message.type === 'shutdown') {
      console.log('[OcrCore] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      if (message.regionCoordinates) {
        const { regions } = currentState.regionCoordinates;
        const ocrRegions = Object.keys(config.OCR_REGION_CONFIGS)
          .map((key) => regions[key])
          .filter(Boolean);
        frameUpdateManager.setRegionsOfInterest(ocrRegions);
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
