// /home/feiron/Dokumenty/Automaton/electron/workers/targetingWorker.js
// --- Final Version with Movement Cooldown to Prevent Oscillation ---

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import keypress from 'keypress-native';
import { createLogger } from '../utils/logger.js';
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
const logger = createLogger({ info: true, error: true });

// --- NEW: Configuration for movement smoothing ---
const MOVE_COOLDOWN_MS = 175; // Cooldown in ms after a move command. Tune this value if movement feels sluggish or still oscillates.

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let playerMinimapPosition = null;
let path = [];
let pathfindingStatus = 0;
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;

// --- NEW: State variable to manage movement cooldown ---
let isMoving = false;

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

  // This logic for setting the dynamic target remains the same.
  // It continuously tells the pathfinder what our goal is.
  let dynamicGoal = null;
  if (
    targeting.creatures.length > 0 &&
    targeting.stance !== 'Ignore' &&
    targeting.stance !== 'Stand'
  ) {
    let closestCreature = null;
    let minDistance = Infinity;
    targeting.creatures.forEach((creature) => {
      const dist = Math.max(
        Math.abs(playerMinimapPosition.x - creature.gameCoords.x),
        Math.abs(playerMinimapPosition.y - creature.gameCoords.y),
      );
      if (dist < minDistance) {
        minDistance = dist;
        closestCreature = creature;
      }
    });

    if (closestCreature) {
      dynamicGoal = {
        stance: targeting.stance,
        distance: targeting.distance,
        targetCreaturePos: closestCreature.gameCoords,
      };
    }
  }

  parentPort.postMessage({
    storeUpdate: true,
    type: 'cavebot/setDynamicTarget',
    payload: dynamicGoal,
  });

  // --- MODIFIED MOVEMENT LOGIC ---
  // If we are already in the middle of a move, do not issue another command.
  // This prevents the hyper-reactive loop and stops oscillation.
  if (isMoving) {
    return;
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
      // 1. Set the flag to indicate we are starting a move.
      isMoving = true;

      // 2. Send the keypress to perform the move.
      keypress.sendKey(dirKey, globalState.global.display);

      // 3. Set a timer. After the cooldown, reset the flag to allow the next move.
      // This gives the character time to complete the step.
      setTimeout(() => {
        isMoving = false;
      }, MOVE_COOLDOWN_MS);
    }
  }
}

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
