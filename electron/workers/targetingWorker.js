// /home/feiron/Dokumenty/Automaton/electron/workers/targetingWorker.js
// --- Final Version with Movement Cooldown to Prevent Oscillation ---

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import keypress from 'keypress-native';
import { createLogger } from '../utils/logger.js';
import mouseController from '../../nativeModules/mouseController/wrapper.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  PATH_LENGTH_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  PATH_START_X_INDEX,
  PATH_START_Y_INDEX,
  PATH_START_Z_INDEX,
  PATHFINDING_STATUS_INDEX,
  PATH_STATUS_PATH_FOUND,
  MAX_PATH_WAYPOINTS,
} from './sharedConstants.js';

const MAIN_LOOP_INTERVAL = 50;
const STATE_CHANGE_POLL_INTERVAL = 5; // Copied from cavebotWorker.js
const logger = createLogger({ info: true, error: true });

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let playerMinimapPosition = null;
let path = [];
let pathfindingStatus = 0;
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let lastCreatureAbsoluteCoordsUpdate = 0;
let lastTargetedCreatureId = null;

const { playerPosSAB, pathDataSAB } = workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getDirectionKey = (current, target) => {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (dy < 0) {
    if (dx < 0) return 'q';
    if (dx === 0) return 'w';
    if (dx > 0) return 'e';
  } else if (dy === 0) {
    if (dx < 0) return 'a';
    if (dx > 0) return 'd';
  } else if (dy > 0) {
    if (dx < 0) return 'z';
    if (dx === 0) return 's';
    if (dx > 0) return 'c';
  }
  return null;
};

const updateSABData = () => {
  if (playerPosArray) {
    const newPlayerPosCounter = Atomics.load(
      playerPosArray,
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    if (newPlayerPosCounter > lastPlayerPosCounter) {
      playerMinimapPosition = {
        x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
      };
      lastPlayerPosCounter = newPlayerPosCounter;
    }
  }
  if (pathDataArray) {
    let consistentRead = false;
    let attempts = 0;
    do {
      const counterBeforeRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (counterBeforeRead === lastPathDataCounter) return;

      const pathStartX = Atomics.load(pathDataArray, PATH_START_X_INDEX);
      const pathStartY = Atomics.load(pathDataArray, PATH_START_Y_INDEX);
      const pathStartZ = Atomics.load(pathDataArray, PATH_START_Z_INDEX);

      if (
        !playerMinimapPosition ||
        playerMinimapPosition.x !== pathStartX ||
        playerMinimapPosition.y !== pathStartY ||
        playerMinimapPosition.z !== pathStartZ
      ) {
        lastPathDataCounter = counterBeforeRead;
        return;
      }

      pathfindingStatus = Atomics.load(pathDataArray, PATHFINDING_STATUS_INDEX);
      const pathLength = Atomics.load(pathDataArray, PATH_LENGTH_INDEX);
      const tempPath = [];
      const safePathLength = Math.min(pathLength, MAX_PATH_WAYPOINTS);
      for (let i = 0; i < safePathLength; i++) {
        const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
        tempPath.push({
          x: Atomics.load(pathDataArray, offset + 0),
          y: Atomics.load(pathDataArray, offset + 1),
          z: Atomics.load(pathDataArray, offset + 2),
        });
      }
      const counterAfterRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (counterAfterRead === counterBeforeRead) {
        path = tempPath;
        lastPathDataCounter = counterBeforeRead;
        consistentRead = true;
        if (path.length > 0) {
          logger(
            'info',
            `[TargetingWorker] New path generated: ${JSON.stringify(path)}`,
          );
        }
      } else {
        attempts++;
      }
    } while (!consistentRead && attempts < 3);
  }
};

async function performTargeting() {
  if (
    isShuttingDown ||
    !isInitialized ||
    !globalState?.targeting?.enabled ||
    !globalState?.cavebot?.isActionPaused ||
    !globalState?.global?.display
  ) {
    return;
  }

  updateSABData();
  if (!playerMinimapPosition) return;

  const { targeting } = globalState;
  let dynamicGoal = null;
  let currentTarget = null;
  let minDistance = Infinity; // Initialize minDistance here

  const findTargetedCreature = (
    creaturesOnScreen,
    targetingList,
    playerPos,
  ) => {
    if (
      !creaturesOnScreen ||
      creaturesOnScreen.length === 0 ||
      !targetingList ||
      targetingList.length === 0
    ) {
      return null;
    }

    let bestTarget = null;
    let currentMinDistance = Infinity; // Use a local minDistance for this function

    for (const targetEntry of targetingList) {
      const {
        name: targetName,
        stance: targetStance,
        distance: targetDistance,
      } = targetEntry;

      if (targetStance === 'Ignore') continue;

      const matchingCreatures = creaturesOnScreen.filter(
        (creature) => creature.name === targetName,
      );

      if (matchingCreatures.length === 0) continue;

      for (const creature of matchingCreatures) {
        const dist = Math.max(
          Math.abs(playerPos.x - creature.gameCoords.x),
          Math.abs(playerPos.y - creature.gameCoords.y),
        );

        // Prioritize based on targeting list order (implicit by iterating targetingList)
        // and then by proximity for creatures with the same name.
        if (dist < currentMinDistance) {
          currentMinDistance = dist;
          bestTarget = {
            ...creature,
            configuredStance: targetStance,
            configuredDistance: targetDistance,
          };
        }
      }
    }
    minDistance = currentMinDistance; // Assign to outer scope minDistance
    return bestTarget;
  };

  currentTarget = findTargetedCreature(
    targeting.creatures,
    targeting.targetingList,
    playerMinimapPosition,
  );

  if (currentTarget) {
    const { configuredStance, configuredDistance, gameCoords } = currentTarget;

    if (configuredStance === 'Stand') {
      dynamicGoal = null; // Do not move if stance is 'Stand'
    } else if (
      configuredStance === 'Keep Away' &&
      minDistance > configuredDistance
    ) {
      dynamicGoal = null; // Creature is too far, do not set a target for running away
    } else if (configuredStance !== 'Ignore') {
      // For 'Reach' and 'Keep Away' (when close)
      dynamicGoal = {
        stance: configuredStance,
        distance: configuredDistance,
        targetCreaturePos: gameCoords,
      };
    }
  }

  parentPort.postMessage({
    storeUpdate: true,
    type: 'cavebot/setDynamicTarget',
    payload: dynamicGoal,
  });

  // Update the target in the Redux store
  parentPort.postMessage({
    storeUpdate: true,
    type: 'targeting/setTarget',
    payload: currentTarget
      ? {
          name: currentTarget.name,
          distance: minDistance, // Use the calculated distance
          gameCoordinates: currentTarget.gameCoords || { x: 0, y: 0, z: 0 },
          absoluteCoordinates: currentTarget.absoluteCoordinates || {
            x: 0,
            y: 0,
          },
        }
      : null,
  });

  // Right-click targeting logic
  if (
    currentTarget &&
    currentTarget.absoluteCoordinates &&
    currentTarget.id !== lastTargetedCreatureId &&
    currentTarget.absoluteCoordinates.lastUpdate >
      lastCreatureAbsoluteCoordsUpdate
  ) {
    try {
      mouseController.leftClick(
        currentTarget.absoluteCoordinates.x,
        currentTarget.absoluteCoordinates.y,
        globalState.global.display,
      );
      logger(
        'info',
        `[TargetingWorker] Left-clicked on ${currentTarget.name} at ${currentTarget.absoluteCoordinates.x}, ${currentTarget.absoluteCoordinates.y}`,
      );
      lastTargetedCreatureId = currentTarget.id;
      lastCreatureAbsoluteCoordsUpdate =
        currentTarget.absoluteCoordinates.lastUpdate;
    } catch (error) {
      logger(
        'error',
        `[TargetingWorker] Error right-clicking: ${error.message}`,
      );
    }
  } else if (!currentTarget) {
    lastTargetedCreatureId = null;
    lastCreatureAbsoluteCoordsUpdate = 0; // Reset timestamp when no target
  }

  if (pathfindingStatus === PATH_STATUS_PATH_FOUND && path.length > 0) {
    const nextStep = path[0];

    // Final check to prevent moving onto our own tile.
    if (
      nextStep.x === playerMinimapPosition.x &&
      nextStep.y === playerMinimapPosition.y
    ) {
      return;
    }

    const dirKey = getDirectionKey(playerMinimapPosition, nextStep);

    if (dirKey) {
      // Send the keypress to perform the move.
      keypress.sendKey(dirKey, globalState.global.display);

      // Wait for walk confirmation.
      try {
        await awaitWalkConfirmation(
          lastPlayerPosCounter,
          lastPathDataCounter,
          400, // Use a reasonable timeout for confirmation, e.g., 300ms
        );
      } catch (error) {
        logger('error', `[TargetingWorker] Walk step failed: ${error.message}`);
      }
    }
  }
}

// --- Confirmation Utilities (Copied from cavebotWorker.js) ---
const awaitWalkConfirmation = (
  posCounterBeforeMove,
  pathCounterBeforeMove,
  timeoutMs,
) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error(`awaitWalkConfirmation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const intervalId = setInterval(() => {
      const posChanged = playerPosArray
        ? Atomics.load(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX) >
          posCounterBeforeMove
        : false;
      const pathChanged = pathDataArray
        ? Atomics.load(pathDataArray, PATH_UPDATE_COUNTER_INDEX) >
          pathCounterBeforeMove
        : false;
      // Accept either we moved OR pathfinder updated the path — both are valid signals.
      if (posChanged || pathChanged) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

async function mainLoop() {
  logger('info', '[TargetingWorker] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performTargeting();
    } catch (error) {
      logger('error', '[TargetingWorker] Error in main loop:', error);
    }
    const elapsedTime = performance.now() - loopStart;
    const delayTime = Math.max(0, MAIN_LOOP_INTERVAL - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
}

parentPort.on('message', (message) => {
  if (message.type === 'shutdown') {
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (!globalState) globalState = {};
    Object.assign(globalState, message.payload);
  } else if (typeof message === 'object' && !message.type) {
    globalState = message;
    if (!isInitialized) {
      isInitialized = true;
      logger(
        'info',
        '[TargetingWorker] Initial state received. Worker is now active.',
      );
    }
  }
});

mainLoop();
