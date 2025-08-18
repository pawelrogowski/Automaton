// targetMonitor.js (Repurposed to find the current target)

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
// 1. IMPORT THE NEW NATIVE MODULE
import findTarget from 'find-target-native';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
import { rectsIntersect } from './minimap/helpers.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from './sharedConstants.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 100; // Scanning for a single target can be less frequent

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
let isShuttingDown = false;
let isScanning = false;
let gameWorld = null; // To store the gameWorld region
let tileSize = null;
let hasScannedOnce = false;
let creatures = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateDistance(pos1, pos2) {
  if (!pos1 || !pos2) return Infinity;
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function mainLoop() {
  console.log('[EntityMonitor] Starting target monitor loop...');

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      if (isScanning) {
        await delay(32); // Prevent re-entry if a scan is slow
        continue;
      }

      // Wait until we have all necessary info from the main thread
      if (
        !gameWorld ||
        gameWorld.width <= 0 ||
        !playerPosArray ||
        !tileSize?.height
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
            // 2. CALL THE NEW NATIVE FUNCTION
            const targetRect = await findTarget.findTarget(
              sharedBufferView,
              gameWorld,
            );
            hasScannedOnce = true;

            if (targetRect) {
              const playerMinimapPosition = {
                x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
                y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
                z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
              };

              // 3. CALCULATE THE MIDDLE OF THE TARGET BOX
              const screenX = targetRect.x + targetRect.width / 2;
              const screenY = targetRect.y + targetRect.height / 2;

              // 4. TRANSLATE SCREEN COORDS TO GAME COORDS
              const targetGameCoords = getGameCoordinatesFromScreen(
                screenX,
                screenY,
                playerMinimapPosition,
                gameWorld,
                tileSize,
              );

              if (targetGameCoords) {
                let closestCreature = null;
                let minDistance = Infinity;

                for (const entity of creatures) {
                  if (entity.gameCoords) {
                    const distance = calculateDistance(
                      targetGameCoords,
                      entity.gameCoords,
                    );
                    if (distance < minDistance) {
                      minDistance = distance;
                      closestCreature = entity;
                    }
                  }
                }

                if (closestCreature) {
                  const distanceFromPlayer = calculateDistance(
                    playerMinimapPosition,
                    closestCreature.gameCoords,
                  );
                  const targetData = {
                    name: closestCreature.name,
                    distance: parseFloat(distanceFromPlayer.toFixed(1)),
                    gameCoordinates: closestCreature.gameCoords,
                    absoluteCoordinates: closestCreature.absoluteCoords,
                  };
                  parentPort.postMessage({
                    storeUpdate: true,
                    type: 'targeting/setTarget',
                    payload: targetData,
                  });
                } else {
                  parentPort.postMessage({
                    storeUpdate: true,
                    type: 'targeting/setTarget',
                    payload: null,
                  });
                }
              }
            } else {
              // No target found, dispatch null
              parentPort.postMessage({
                storeUpdate: true,
                type: 'targeting/setTarget',
                payload: null,
              });
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
  console.log('[EntityMonitor] Target monitor loop stopped.');
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
    if (message.payload.targeting) {
      creatures = message.payload.targeting.creatures;
    }
  } else if (typeof message === 'object' && !message.type && !message.command) {
    if (message.regionCoordinates) {
      gameWorld = message.regionCoordinates.regions?.gameWorld;
      tileSize = message.regionCoordinates.regions?.tileSize;
    }
    if (message.targeting) {
      creatures = message.targeting.creatures;
    }
  }
});

mainLoop().catch((err) => {
  console.error('[EntityMonitor] Fatal error in main loop:', err);
  process.exit(1);
});
