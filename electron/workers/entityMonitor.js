import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import findHealthBars from 'find-health-bars-native';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
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

// --- State ---
let lastProcessedFrameCounter = -1;
let lastSentEntities = null;
let isShuttingDown = false;
let isScanning = false;
let gameWorld = null; // To store the gameWorld region
let tileSize = null;

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
          isScanning = true;
          try {
            const results = await findHealthBars.findHealthBars(
              sharedBufferView,
              gameWorld,
            );

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

                  // --- FINAL REFINED LOGIC ---

                  // 1. Check if the health bar's physical screen Y-coordinate is within the top tile's boundaries.
                  const isOnTopRow =
                    screenY >= gameWorld.y &&
                    screenY < gameWorld.y + tileSize.height;

                  if (isOnTopRow) {
                    // CASE 1: The health bar is on the top row. It needs special nested logic.
                    // This threshold marks the 60% point down the height of the top tile.
                    const topRowThresholdY =
                      gameWorld.y + tileSize.height * 0.6;

                    if (screenY < topRowThresholdY) {
                      // The health bar is in the TOP 60% of the top tile.
                      // This belongs to an entity on the SAME tile (no shift).
                    } else {
                      // The health bar is in the BOTTOM 40% of the top tile.
                      // This belongs to an entity on the tile BELOW (shift by +1).
                      gameCoords.y += 1;
                    }
                  } else {
                    // CASE 2: The health bar is on any other row.
                    // The rule is simple: the entity is on the tile BELOW (shift by +1).
                    gameCoords.y += 1;
                  }

                  // 3. Round the final coordinates to handle smooth animations and ensure integer values.
                  gameCoords.x = Math.round(gameCoords.x);
                  gameCoords.y = Math.round(gameCoords.y);

                  // --- END OF FINAL LOGIC ---

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
              parentPort.postMessage({
                type: 'batch-update',
                payload: [
                  {
                    type: 'gameState/setPlayerMinimapPosition',
                    payload: playerMinimapPosition,
                  },
                  {
                    type: 'targeting/setEntities',
                    payload: entitiesWithCoords,
                  },
                ],
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
