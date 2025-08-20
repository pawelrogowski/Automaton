// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/core.js
// --- Definitive Version with Enforced Settle Delay ---

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import * as config from './config.js';
import {
  rectsIntersect,
  processBattleList,
  processOcrRegions,
  processGameWorldEntities,
  deepCompareEntities,
} from './processing.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from '../sharedConstants.js';

// --- CONFIGURABLE DELAY ---
// The number of milliseconds to wait after a player move completes before
// trusting the screen again. This gives the game engine time to "settle".
const SETTLE_DELAY_MS = 75; // Tune this value if needed.

const POSITION_CONFIRMATION_THRESHOLD = 3;
const CREATURE_TTL_MS = 300;
const SCROLL_DETECTION_THRESHOLD = 0.95;

let currentState = null;
let isShuttingDown = false;
let lastProcessedFrameCounter = -1;
let lastRegionHash = null;

const creatureConfidence = new Map();
let lastSentCreatures = [];

// --- Simplified State ---
let lastPlayerMinimapPosition = null;
let isWaitingForSettle = false;

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

function applyConfidenceFilter(detectedEntities) {
  const now = Date.now();
  const confirmedEntities = [];
  const seenThisFrame = new Set();

  for (const entity of detectedEntities) {
    const key = entity.name;
    seenThisFrame.add(key);

    const existing = creatureConfidence.get(key);

    if (!existing) {
      creatureConfidence.set(key, {
        ...entity,
        confirmations: 1,
        lastSeen: now,
        isConfirmed: false,
      });
    } else {
      const sameTile =
        existing.gameCoords.x === entity.gameCoords.x &&
        existing.gameCoords.y === entity.gameCoords.y;

      if (!existing.isConfirmed && sameTile) {
        existing.confirmations++;
      } else if (!sameTile) {
        existing.confirmations = 1;
      }

      existing.gameCoords = entity.gameCoords;
      existing.absoluteCoords = entity.absoluteCoords;
      existing.distance = entity.distance;
      existing.lastSeen = now;

      if (existing.confirmations >= POSITION_CONFIRMATION_THRESHOLD) {
        existing.isConfirmed = true;
      }
    }
  }

  for (const [key, entity] of creatureConfidence.entries()) {
    if (now - entity.lastSeen > CREATURE_TTL_MS) {
      creatureConfidence.delete(key);
    } else if (entity.isConfirmed) {
      confirmedEntities.push(entity);
    }
  }

  return confirmedEntities;
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

function getIntersection(rect1, rect2) {
  const x = Math.max(rect1.x, rect2.x);
  const y = Math.max(rect1.y, rect2.y);
  const width = Math.min(rect1.x + rect1.width, rect2.x + rect2.width) - x;
  const height = Math.min(rect1.y + rect1.height, rect2.y + rect2.height) - y;

  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
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

    const currentPlayerMinimapPosition = {
      x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
      y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
      z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
    };

    // --- ENFORCED SETTLE DELAY LOGIC ---
    if (lastPlayerMinimapPosition) {
      if (
        currentPlayerMinimapPosition.x !== lastPlayerMinimapPosition.x ||
        currentPlayerMinimapPosition.y !== lastPlayerMinimapPosition.y ||
        currentPlayerMinimapPosition.z !== lastPlayerMinimapPosition.z
      ) {
        isWaitingForSettle = true;
        setTimeout(() => {
          isWaitingForSettle = false;
        }, SETTLE_DELAY_MS);
      }
    }
    lastPlayerMinimapPosition = currentPlayerMinimapPosition;
    // --- END OF LOGIC ---

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

    let isScreenScrolling = false;
    if (regions.gameWorld) {
      let dirtyAreaInGameWorld = 0;
      const gameWorldArea = regions.gameWorld.width * regions.gameWorld.height;
      for (const dirtyRect of dirtyRects) {
        const intersection = getIntersection(dirtyRect, regions.gameWorld);
        if (intersection) {
          dirtyAreaInGameWorld += intersection.width * intersection.height;
        }
      }
      if (
        gameWorldArea > 0 &&
        dirtyAreaInGameWorld / gameWorldArea > SCROLL_DETECTION_THRESHOLD
      ) {
        isScreenScrolling = true;
      }
    }

    const processingTasks = [];
    const immediateRegionsToProcess = new Set();

    if (regions.battleList) {
      const isDirty = dirtyRects.some((dirtyRect) =>
        rectsIntersect(regions.battleList, dirtyRect),
      );
      if (isDirty || !oneTimeInitializedRegions.has('battleList')) {
        immediateRegionsToProcess.add('battleList');
        oneTimeInitializedRegions.add('battleList');
      }
    }

    // The final, simple rule: Scan the game world if it's not scrolling AND we are not waiting for a settle.
    if (regions.gameWorld && !isScreenScrolling && !isWaitingForSettle) {
      immediateRegionsToProcess.add('gameWorld');
    }

    if (immediateRegionsToProcess.size > 0) {
      const ocrResultsPromise = processOcrRegions(
        sharedBufferView,
        regions,
        immediateRegionsToProcess,
      );
      processingTasks.push(
        ocrResultsPromise.then(async (ocrRawUpdates) => {
          if (ocrRawUpdates?.gameWorld) {
            const detectedEntities =
              (await processGameWorldEntities(
                ocrRawUpdates.gameWorld,
                currentPlayerMinimapPosition,
                regions,
                regions.tileSize,
              )) || [];

            const confirmedEntities = applyConfidenceFilter(detectedEntities);

            if (!deepCompareEntities(confirmedEntities, lastSentCreatures)) {
              parentPort.postMessage({
                storeUpdate: true,
                type: 'targeting/setEntities',
                payload: confirmedEntities,
              });
              lastSentCreatures = confirmedEntities;
            }
          }
        }),
      );
    } else {
      // If we are scrolling or waiting, we can still run the filter with an empty
      // list to process TTLs and remove expired creatures.
      const confirmedEntities = applyConfidenceFilter([]);
      if (!deepCompareEntities(confirmedEntities, lastSentCreatures)) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'targeting/setEntities',
          payload: confirmedEntities,
        });
        lastSentCreatures = confirmedEntities;
      }
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
      const payload = message.payload;
      if (payload.regionCoordinates) {
        const newHash = hashRegionCoordinates(payload.regionCoordinates);
        if (newHash === lastRegionHash) {
          delete payload.regionCoordinates;
        } else {
          lastRegionHash = newHash;
        }
      }
      Object.assign(currentState, payload);
    } else if (message.type === 'shutdown') {
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      lastRegionHash = hashRegionCoordinates(message.regionCoordinates || {});
      lastSentCreatures = [];
      lastPlayerMinimapPosition = null;
      isWaitingForSettle = false;
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
