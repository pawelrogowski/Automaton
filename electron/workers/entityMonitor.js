// entityMonitor.js (Updated)

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import findHealthBars from 'find-health-bars-native';
import { getGameCoordinatesFromScreen } from '../main/utils/gameWorldClickTranslator.js';
import { rectsIntersect } from './minimap/helpers.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from './sharedConstants.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 32;

if (!sharedData) {
  throw new Error('[EntityMonitor] Shared data not provided.');
}

const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

// --- SharedArrayBuffer Indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const DIRTY_REGION_COUNT_INDEX = 5;
const DIRTY_REGIONS_START_INDEX = 6;

// --- State ---
let lastProcessedFrameCounter = -1;
let lastSentEntities = null;
let isShuttingDown = false;
let isScanning = false;
let gameWorld = null; // To store the gameWorld region
let tileSize = null;
let hasScannedOnce = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deepCompareEntities(a, b) {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const entityA = a[i];
    const entityB = b[i];

    if (
      entityA.absoluteCoords.x !== entityB.absoluteCoords.x ||
      entityA.absoluteCoords.y !== entityB.absoluteCoords.y ||
      entityA.gameCoords.x !== entityB.gameCoords.x ||
      entityA.gameCoords.y !== entityB.gameCoords.y ||
      entityA.gameCoords.z !== entityB.gameCoords.z
    ) {
      return false;
    }
  }

  return true;
}

async function mainLoop() {
  console.log('[EntityMonitor] Starting main loop...');

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      if (isScanning) {
        await delay(32);
        continue;
      }

      if (
        !gameWorld ||
        gameWorld.width <= 0 ||
        gameWorld.height <= 0 ||
        !playerPosArray ||
        !tileSize ||
        !tileSize.height
      ) {
        await delay(SCAN_INTERVAL_MS);
        continue;
      }

      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      if (newFrameCounter > lastProcessedFrameCounter) {
        lastProcessedFrameCounter = newFrameCounter;

        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
          await delay(SCAN_INTERVAL_MS);
          continue;
        }

        const width = Atomics.load(syncArray, WIDTH_INDEX);
        const height = Atomics.load(syncArray, HEIGHT_INDEX);

        if (width > 0 && height > 0) {
          // --- Dirty Rectangle Check ---
          const dirtyRegionCount = Atomics.load(
            syncArray,
            DIRTY_REGION_COUNT_INDEX,
          );
          let gameWorldIsDirty = !hasScannedOnce; // Always scan the first time

          if (!gameWorldIsDirty && dirtyRegionCount > 0) {
            for (let i = 0; i < dirtyRegionCount; i++) {
              const offset = DIRTY_REGIONS_START_INDEX + i * 4;
              const dirtyRect = {
                x: Atomics.load(syncArray, offset + 0),
                y: Atomics.load(syncArray, offset + 1),
                width: Atomics.load(syncArray, offset + 2),
                height: Atomics.load(syncArray, offset + 3),
              };
              if (rectsIntersect(gameWorld, dirtyRect)) {
                gameWorldIsDirty = true;
                break;
              }
            }
          }

          if (!gameWorldIsDirty) {
            await delay(SCAN_INTERVAL_MS);
            continue;
          }

          isScanning = true;
          try {
            const results = await findHealthBars.findHealthBars(
              sharedBufferView,
              gameWorld,
            );
            hasScannedOnce = true; // Mark that we've scanned at least once

            const playerMinimapPosition = {
              x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
              y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
              z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
            };

            let entitiesWithCoords = [];
            if (results && results.length > 0) {
              entitiesWithCoords = results
                .map((r) => {
                  const screenX = r.x;
                  const screenY = r.y;

                  const gameCoords = getGameCoordinatesFromScreen(
                    screenX,
                    screenY,
                    playerMinimapPosition,
                    gameWorld,
                    tileSize,
                  );

                  if (!gameCoords) {
                    return null;
                  }

                  const isOnTopRow =
                    screenY >= gameWorld.y &&
                    screenY < gameWorld.y + tileSize.height;

                  if (isOnTopRow) {
                    const topRowThresholdY =
                      gameWorld.y + tileSize.height * 0.6;

                    if (screenY < topRowThresholdY) {
                      // Entity is on the same tile
                    } else {
                      gameCoords.y += 1; // Entity is on the tile below
                    }
                  } else {
                    gameCoords.y += 1; // Entity is on the tile below
                  }

                  gameCoords.x = Math.round(gameCoords.x);
                  gameCoords.y = Math.round(gameCoords.y);
                  gameCoords.z = playerMinimapPosition.z;

                  return {
                    absoluteCoords: { x: screenX, y: screenY },
                    gameCoords: gameCoords,
                  };
                })
                .filter(Boolean);

              entitiesWithCoords.sort((a, b) =>
                a.absoluteCoords.x !== b.absoluteCoords.x
                  ? a.absoluteCoords.x - b.absoluteCoords.x
                  : a.absoluteCoords.y - b.absoluteCoords.y,
              );
            }

            if (!deepCompareEntities(entitiesWithCoords, lastSentEntities)) {
              lastSentEntities = entitiesWithCoords;
              // --- FIX START: Removed player position update from this worker ---
              // The minimapMonitor is now responsible for this update.
              parentPort.postMessage({
                type: 'batch-update',
                payload: [
                  {
                    type: 'targeting/setEntities',
                    payload: entitiesWithCoords,
                  },
                ],
              });
              // --- FIX END ---
            }
          } finally {
            isScanning = false;
          }
        }
      }
    } catch (err) {
      console.error('[EntityMonitor] Error in main loop:', err);
      isScanning = false;
    }

    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
  console.log('[EntityMonitor] Main loop stopped.');
}

parentPort.on('message', (message) => {
  if (message.type === 'shutdown') {
    console.log('[EntityMonitor] Received shutdown command.');
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (message.payload.regionCoordinates) {
      gameWorld = message.payload.regionCoordinates.regions?.gameWorld;
      tileSize = message.payload.regionCoordinates.regions?.tileSize;
    }
  } else if (typeof message === 'object' && !message.type && !message.command) {
    if (message.regionCoordinates) {
      gameWorld = message.regionCoordinates.regions?.gameWorld;
      tileSize = message.regionCoordinates.regions?.tileSize;
    }
  }
});

mainLoop().catch((err) => {
  console.error('[EntityMonitor] Fatal error in main loop:', err);
  process.exit(1);
});
