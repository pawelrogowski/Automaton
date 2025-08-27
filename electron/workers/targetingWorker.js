import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import keypress from 'keypress-native';
import { createLogger } from '../utils/logger.js';
import mouseController from 'mouse-controller';
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
  PATH_STATUS_IDLE,
  PATH_STATUS_NO_PATH_FOUND,
  MAX_PATH_WAYPOINTS,
} from './sharedConstants.js';

const MAIN_LOOP_INTERVAL = 25;
const MOVEMENT_COOLDOWN_MS = 400;
const CLICK_CONFIRMATION_TIMEOUT_MS = 400;
const CLICK_POLL_INTERVAL_MS = 5;
const MOVEMENT_CONFIRMATION_TIMEOUT_MS = 400;

const logger = createLogger({ info: false, error: false, debug: false });

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let playerMinimapPosition = null;
let path = [];
let pathfindingStatus = 0;
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let lastMovementTime = 0;
let lastDispatchedVisitedTile = null;
let lastControlState = 'CAVEBOT';

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
      if (posChanged || pathChanged) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, CLICK_POLL_INTERVAL_MS);
  });
};

const awaitPathfinderUpdate = (timeoutMs) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      updateSABData();

      if (pathfindingStatus === PATH_STATUS_PATH_FOUND) {
        clearInterval(intervalId);
        resolve(true);
      } else if (pathfindingStatus === PATH_STATUS_NO_PATH_FOUND) {
        clearInterval(intervalId);
        resolve(false);
      }

      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        reject(
          new Error(`awaitPathfinderUpdate timed out after ${timeoutMs}ms`),
        );
      }
    }, CLICK_POLL_INTERVAL_MS);
  });
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

function selectBestTarget() {
  const {
    creatures,
    targetingList,
    target: currentGameTarget,
  } = globalState.targeting;
  if (
    !creatures ||
    creatures.length === 0 ||
    !targetingList ||
    targetingList.length === 0
  ) {
    return null;
  }

  const reachableCreatures = creatures.filter((c) => c.isReachable);

  let stickinessBonus = 0;
  if (currentGameTarget) {
    const currentTargetOnScreen = reachableCreatures.find(
      (c) => c.instanceId === currentGameTarget.instanceId,
    );
    if (currentTargetOnScreen) {
      let activeRuleForCurrentTarget = targetingList.find(
        (t) =>
          t.name === currentTargetOnScreen.name &&
          t.action === 'Attack' &&
          t.healthRange === currentTargetOnScreen.healthTag,
      );
      if (!activeRuleForCurrentTarget) {
        activeRuleForCurrentTarget = targetingList.find(
          (t) =>
            t.name === currentTargetOnScreen.name &&
            t.action === 'Attack' &&
            t.healthRange === 'Any',
        );
      }
      if (activeRuleForCurrentTarget) {
        stickinessBonus = activeRuleForCurrentTarget.stickiness || 0;
      }
    }
  }

  const targetableCreatures = reachableCreatures
    .map((creature) => {
      let targetingInfo = targetingList.find(
        (t) =>
          t.name === creature.name &&
          t.action === 'Attack' &&
          t.healthRange === creature.healthTag,
      );

      if (!targetingInfo) {
        targetingInfo = targetingList.find(
          (t) =>
            t.name === creature.name &&
            t.action === 'Attack' &&
            t.healthRange === 'Any',
        );
      }

      if (!targetingInfo) return null;

      let effectivePriority = targetingInfo.priority;
      if (
        currentGameTarget &&
        creature.instanceId === currentGameTarget.instanceId
      ) {
        effectivePriority += stickinessBonus;
      }

      return { ...creature, ...targetingInfo, effectivePriority };
    })
    .filter(Boolean);

  if (targetableCreatures.length === 0) {
    return null;
  }

  targetableCreatures.sort((a, b) => {
    if (a.effectivePriority !== b.effectivePriority) {
      return b.effectivePriority - a.effectivePriority;
    }
    return a.distance - b.distance;
  });

  return targetableCreatures[0];
}

async function clickAndConfirmTarget(targetToClick) {
  if (!targetToClick.absoluteCoords) {
    logger(
      'warn',
      `[Targeting] Cannot click ${targetToClick.name}, missing absolute coordinates.`,
    );
    return false;
  }

  const gameWorld = globalState.regionCoordinates?.regions?.gameWorld;

  if (gameWorld) {
    const { x, y, width, height } = gameWorld;
    const clickX = targetToClick.absoluteCoords.x;
    const clickY = targetToClick.absoluteCoords.y;

    if (
      clickX < x || // Too far left
      clickX >= x + width || // Too far right (or exactly on the edge)
      clickY < y || // Too far up
      clickY >= y + height // Too far down (or exactly on the edge)
    ) {
      logger(
        'warn',
        `[Targeting] Preventing click on ${targetToClick.name} at x: ${clickX}, y: ${clickY} because it's within ${BORDER_THRESHOLD}px of gameWorld borders.`,
      );
      return false;
    }
  }

  try {
    mouseController.leftClick(
      parseInt(globalState.global.windowId),
      targetToClick.absoluteCoords.x,
      targetToClick.absoluteCoords.y,
      globalState.global.display,
    );
    await delay(50);
    keypress.sendKey('f8', globalState.global.display);
    logger('info', `[Targeting] Attempting to target: ${targetToClick.name}`);
  } catch (error) {
    logger(
      'error',
      `[Targeting] Failed to send click command: ${error.message}`,
    );
    return false;
  }

  const startTime = Date.now();
  while (Date.now() - startTime < CLICK_CONFIRMATION_TIMEOUT_MS) {
    const latestGameTarget = globalState.targeting.target;
    if (
      latestGameTarget &&
      latestGameTarget.instanceId === targetToClick.instanceId
    ) {
      logger('info', `[Targeting] Confirmed target: ${targetToClick.name}`);
      return true;
    }
    await delay(CLICK_POLL_INTERVAL_MS);
  }

  logger(
    'warn',
    `[Targeting] Target not confirmed for ${targetToClick.name} within ${CLICK_CONFIRMATION_TIMEOUT_MS}ms.`,
  );
  return false;
}

async function performTargeting() {
  if (
    isShuttingDown ||
    !isInitialized ||
    !globalState?.targeting?.enabled ||
    !globalState?.global?.display
  ) {
    return;
  }

  updateSABData();
  if (!playerMinimapPosition) return;

  const { controlState } = globalState.cavebot;
  const bestTarget = selectBestTarget();
  const currentGameTarget = globalState.targeting.target;

  switch (controlState) {
    case 'CAVEBOT':
      if (bestTarget) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/requestTargetingControl',
        });
      }
      return;

    case 'HANDOVER_TO_TARGETING':
      return;

    case 'TARGETING':
      if (!bestTarget) {
        keypress.sendKey('f8', globalState.global.display);
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/releaseTargetingControl',
        });
        lastDispatchedVisitedTile = null;
        return;
      }
      break;

    default:
      return;
  }

  if (
    !lastDispatchedVisitedTile ||
    lastDispatchedVisitedTile.x !== playerMinimapPosition.x ||
    lastDispatchedVisitedTile.y !== playerMinimapPosition.y ||
    lastDispatchedVisitedTile.z !== playerMinimapPosition.z
  ) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/addVisitedTile',
      payload: playerMinimapPosition,
    });
    lastDispatchedVisitedTile = { ...playerMinimapPosition };
  }

  if (bestTarget.instanceId !== currentGameTarget?.instanceId) {
    const clickedSuccessfully = await clickAndConfirmTarget(bestTarget);
    if (!clickedSuccessfully) {
      return;
    }
  }

  const dynamicGoal = {
    stance: bestTarget.stance,
    distance: bestTarget.stance === 'Stand' ? 0 : bestTarget.distance,
    targetCreaturePos: bestTarget.gameCoords,
  };
  parentPort.postMessage({
    storeUpdate: true,
    type: 'cavebot/setDynamicTarget',
    payload: dynamicGoal,
  });

  try {
    const pathFound = await awaitPathfinderUpdate(1000);
    if (!pathFound) {
      logger(
        'warn',
        `[Targeting] No path found for ${bestTarget.name}. Switching target.`,
      );
      return;
    }
  } catch (error) {
    logger(
      'error',
      `[Targeting] Error waiting for pathfinder update: ${error.message}. Switching target.`,
    );
    return;
  }

  const now = Date.now();
  if (now - lastMovementTime < MOVEMENT_COOLDOWN_MS) {
    return;
  }

  if (bestTarget.stance === 'Stand') {
    return;
  }

  if (pathfindingStatus === PATH_STATUS_PATH_FOUND && path.length > 0) {
    const nextStep = path[0];
    if (
      playerMinimapPosition.x === nextStep.x &&
      playerMinimapPosition.y === nextStep.y
    ) {
      return;
    }

    const dirKey = getDirectionKey(playerMinimapPosition, nextStep);
    if (dirKey) {
      const posCounterBeforeMove = lastPlayerPosCounter;
      const pathCounterBeforeMove = lastPathDataCounter;
      keypress.sendKey(dirKey, globalState.global.display);
      lastMovementTime = now;

      try {
        await awaitWalkConfirmation(
          posCounterBeforeMove,
          pathCounterBeforeMove,
          MOVEMENT_CONFIRMATION_TIMEOUT_MS,
        );
        logger(
          'info',
          `[Targeting] Confirmed movement to ${JSON.stringify(nextStep)}`,
        );
      } catch (error) {
        logger(
          'error',
          `[Targeting] Movement confirmation failed: ${error.message}`,
        );
      }
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
    } finally {
      if (globalState?.cavebot) {
        lastControlState = globalState.cavebot.controlState;
      }
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
