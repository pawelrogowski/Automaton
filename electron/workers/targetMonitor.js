import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import findTarget from 'find-target-native';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from './sharedConstants.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 100;

if (!sharedData) {
  throw new Error('[TargetMonitor] Shared data not provided.');
}

const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

// --- SharedArrayBuffer Indices ---
const IS_RUNNING_INDEX = 3;

// --- State ---
let isShuttingDown = false;
let isScanning = false;
let creatures = [];
let hasScannedInitially = false; // NEW: Flag for the initial scan
const frameUpdateManager = new FrameUpdateManager();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateDistance(pos1, pos2) {
  if (!pos1 || !pos2) return Infinity;
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function mainLoop() {
  console.log('[TargetMonitor] Starting target monitor loop...');

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      if (isScanning) {
        await delay(32);
        continue;
      }

      // MODIFIED: Use the manager and the initial scan flag to decide if we should process
      if (!hasScannedInitially && !frameUpdateManager.shouldProcess()) {
        await delay(SCAN_INTERVAL_MS);
        continue;
      }

      if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
        await delay(SCAN_INTERVAL_MS);
        continue;
      }

      const { regions } = currentState.regionCoordinates;
      const gameWorld = regions?.gameWorld;
      const tileSize = regions?.tileSize;

      if (gameWorld && tileSize) {
        isScanning = true;
        try {
          const targetRect = await findTarget.findTarget(
            sharedBufferView,
            gameWorld,
          );

          hasScannedInitially = true; // NEW: Set flag after the first successful scan

          if (targetRect) {
            const playerMinimapPosition = {
              x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
              y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
              z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
            };

            const screenX = targetRect.x + targetRect.width / 2;
            const screenY = targetRect.y + targetRect.height / 2;

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
    } catch (err) {
      console.error('[TargetMonitor] Error in main loop:', err);
      isScanning = false;
    }

    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
  console.log('[TargetMonitor] Target monitor loop stopped.');
}

let currentState = {};

parentPort.on('message', (message) => {
  if (message.type === 'frame-update') {
    frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
    return;
  }

  if (message.type === 'shutdown') {
    console.log('[TargetMonitor] Received shutdown command.');
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    Object.assign(currentState, message.payload);
    if (message.payload.regionCoordinates) {
      const gameWorld = currentState.regionCoordinates.regions?.gameWorld;
      frameUpdateManager.setRegionsOfInterest(gameWorld ? [gameWorld] : []);
      hasScannedInitially = false; // NEW: Reset flag if regions change
    }
    if (message.payload.targeting) {
      creatures = message.payload.targeting.creatures;
    }
  } else if (typeof message === 'object' && !message.type && !message.command) {
    currentState = message;
    if (message.regionCoordinates) {
      const gameWorld = currentState.regionCoordinates.regions?.gameWorld;
      frameUpdateManager.setRegionsOfInterest(gameWorld ? [gameWorld] : []);
    }
    if (message.targeting) {
      creatures = message.targeting.creatures;
    }
  }
});

mainLoop().catch((err) => {
  console.error('[TargetMonitor] Fatal error in main loop:', err);
  process.exit(1);
});
