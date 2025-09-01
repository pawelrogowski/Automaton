// /home/feiron/Dokumenty/Automaton/electron/workers/targetingWorker.js
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

// --- Worker Configuration ---
const MOVEMENT_COOLDOWN_MS = 50;
const CLICK_POLL_INTERVAL_MS = 5;
const MOVEMENT_CONFIRMATION_TIMEOUT_MS = 400;
const TARGET_CLICK_DELAY_MS = 350; // Prevent spam-clicking the battle list

const logger = createLogger({ info: true, error: true, debug: false });

// --- Worker State ---
let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let isProcessing = false;
let playerMinimapPosition = null;
let path = [];
let pathfindingStatus = 0;
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let lastMovementTime = 0;
let lastDispatchedVisitedTile = null;
let clearTargetCommandSent = false;
let lastClickTime = 0;
let lastClickedBattleListIndex = -1;

// --- Change Detection State ---
let lastBattleListHash = null;
let lastCreaturesHash = null; // NEW: Track creatures hash for best target selection
let lastTargetInstanceId = null;
let lastTargetingListHash = null;
let lastPlayerPosKey = null;
let lastControlState = 'CAVEBOT';
let lastTargetingEnabled = false;
let lastCavebotEnabled = false;

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

const getHealthTag = (healthPercent) => {
  if (healthPercent <= 5) return 'Critical';
  if (healthPercent <= 30) return 'Low';
  if (healthPercent <= 60) return 'Medium';
  if (healthPercent <= 90) return 'High';
  return 'Full';
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
      const posChanged =
        playerPosArray &&
        Atomics.load(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX) >
          posCounterBeforeMove;
      const pathChanged =
        pathDataArray &&
        Atomics.load(pathDataArray, PATH_UPDATE_COUNTER_INDEX) >
          pathCounterBeforeMove;
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

function selectBestTargetFromGameWorld() {
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
      const healthTag = getHealthTag(100); // Assuming full health for stickiness check
      const activeRule = targetingList.find(
        (r) =>
          r.name.startsWith(currentTargetOnScreen.name) &&
          r.action === 'Attack' &&
          (r.healthRange === 'Any' || r.healthRange === healthTag),
      );
      if (activeRule) {
        stickinessBonus = activeRule.stickiness || 0;
      }
    }
  }

  const targetableCreatures = reachableCreatures
    .map((creature) => {
      const healthTag = getHealthTag(100); // Placeholder health
      const rule = targetingList.find(
        (r) =>
          r.name.startsWith(creature.name) &&
          r.action === 'Attack' &&
          (r.healthRange === 'Any' || r.healthRange === healthTag),
      );
      if (!rule) return null;

      let effectivePriority = rule.priority;
      if (
        currentGameTarget &&
        creature.instanceId === currentGameTarget.instanceId
      ) {
        effectivePriority += stickinessBonus;
      }
      return { ...creature, rule, effectivePriority };
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

const manageTargetingClicks = async (pathfindingTarget, currentGameTarget) => {
  // If there's no pathfinding target, or we're already targeting the correct one, do nothing.
  if (!pathfindingTarget) {
    lastClickedBattleListIndex = -1; // No target to click, reset index
    return; // No target to pathfind to, so no clicks needed
  }

  // If the current in-game target matches our pathfinding target.
  if (
    currentGameTarget?.instanceId === pathfindingTarget.instanceId ||
    (currentGameTarget &&
      currentGameTarget.name === pathfindingTarget.name &&
      currentGameTarget.gameCoords &&
      pathfindingTarget.gameCoords &&
      currentGameTarget.gameCoords.x === pathfindingTarget.gameCoords.x &&
      currentGameTarget.gameCoords.y === pathfindingTarget.gameCoords.y &&
      currentGameTarget.gameCoords.z === pathfindingTarget.gameCoords.z)
  ) {
    lastClickedBattleListIndex = -1; // Target is correct, reset click logic
    return;
  }

  // Don't click too often
  logger(
    'debug',
    `[Targeting] Checking click delay. Now: ${Date.now()}, Last Click: ${lastClickTime}, Diff: ${Date.now() - lastClickTime}, Delay: ${TARGET_CLICK_DELAY_MS}`,
  );
  if (Date.now() - lastClickTime < TARGET_CLICK_DELAY_MS) {
    return;
  }

  // Find all battle list entries that could match our desired pathfinding target's name
  const potentialBLTargets = globalState.battleList.entries.filter((entry) =>
    pathfindingTarget.name.startsWith(entry.name),
  );

  if (potentialBLTargets.length === 0) {
    // Our target isn't on the battle list. Cannot click.
    lastClickedBattleListIndex = -1; // Reset index
    return;
  }

  // Determine which battle list entry to click.
  // If lastClickedBattleListIndex is -1 or the creature at that index is no longer the pathfinding target,
  // start from the beginning of the potential targets.
  let targetToClick = null;
  let startIndex =
    lastClickedBattleListIndex !== -1 &&
    potentialBLTargets[lastClickedBattleListIndex]?.name ===
      pathfindingTarget.name
      ? lastClickedBattleListIndex
      : 0;

  for (let i = 0; i < potentialBLTargets.length; i++) {
    const currentIndex = (startIndex + i) % potentialBLTargets.length;
    const entry = potentialBLTargets[currentIndex];

    // Check if this entry matches the pathfinding target's game coordinates
    // This is the crucial verification step.
    const creatureInGameWorld = globalState.targeting.creatures.find(
      (c) =>
        c.name.startsWith(entry.name) &&
        c.gameCoords.x === pathfindingTarget.gameCoords.x &&
        c.gameCoords.y === pathfindingTarget.gameCoords.y &&
        c.gameCoords.z === pathfindingTarget.gameCoords.z,
    );

    if (creatureInGameWorld) {
      targetToClick = entry;
      lastClickedBattleListIndex = currentIndex; // Store index for next time
      break;
    }
  }

  if (targetToClick) {
    logger(
      'info',
      `[Targeting] Correcting target. Clicking BL entry for: ${targetToClick.name}`,
    );
    const clickX = targetToClick.region.x + 5;
    const clickY = targetToClick.region.y + 2;
    mouseController.leftClick(
      parseInt(globalState.global.windowId),
      clickX,
      clickY,
      globalState.global.display,
    );
    lastClickTime = Date.now(); // Moved this line up
    keypress.sendKey('f8', globalState.global.display);
    await delay(50);

    // NEW: Advance the index for the next attempt, regardless of success
    lastClickedBattleListIndex =
      (lastClickedBattleListIndex + 1) % potentialBLTargets.length;
  } else {
    // If we couldn't find a matching creature in the game world for any BL entry,
    // it means our pathfinding target is not visually confirmed. Reset index.
    lastClickedBattleListIndex = -1;
  }
};

async function manageMovement(pathfindingTarget) {
  if (
    !pathfindingTarget ||
    !pathfindingTarget.isReachable ||
    !pathfindingTarget.gameCoords
  ) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: null,
    });
    return;
  }

  const dynamicGoal = {
    stance: pathfindingTarget.rule.stance,
    distance: pathfindingTarget.rule.distance,
    targetCreaturePos: pathfindingTarget.gameCoords,
  };
  parentPort.postMessage({
    storeUpdate: true,
    type: 'cavebot/setDynamicTarget',
    payload: dynamicGoal,
  });

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

  if (pathfindingStatus !== PATH_STATUS_PATH_FOUND || path.length === 0) {
    return;
  }

  const now = Date.now();
  if (now - lastMovementTime < MOVEMENT_COOLDOWN_MS) {
    return;
  }

  if (pathfindingTarget.rule.stance === 'Stand') {
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
      } catch (error) {
        logger(
          'error',
          `[Targeting] Movement confirmation failed: ${error.message}`,
        );
      }
    }
  }
}

async function performTargeting() {
  if (isShuttingDown || !isInitialized || !globalState?.global?.display) {
    return;
  }

  if (!globalState.targeting?.enabled) {
    if (globalState.cavebot?.controlState === 'TARGETING') {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/releaseTargetingControl',
      });
    }
    return;
  }

  const { controlState, enabled: cavebotIsEnabled } = globalState.cavebot;

  if (!cavebotIsEnabled && controlState !== 'TARGETING') {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/confirmTargetingControl',
    });
    return;
  }

  const pathfindingTarget = selectBestTargetFromGameWorld();

  if (controlState === 'CAVEBOT' && cavebotIsEnabled) {
    if (pathfindingTarget) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/requestTargetingControl',
      });
    }
    return;
  }

  if (controlState === 'HANDOVER_TO_TARGETING') {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/confirmTargetingControl',
    });
    return;
  }

  if (globalState.cavebot.controlState !== 'TARGETING') {
    return;
  }

  updateSABData();
  if (!playerMinimapPosition) return;

  const currentGameTarget = globalState.targeting.target;

  // Always run the movement logic.
  await manageMovement(pathfindingTarget);

  // Only manage clicks if there's a pathfinding target.
  if (pathfindingTarget) {
    clearTargetCommandSent = false;
    manageTargetingClicks(pathfindingTarget, currentGameTarget);
  } else {
    lastClickedBattleListIndex = -1; // No target, reset click logic
    if (currentGameTarget && !clearTargetCommandSent) {
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
      clearTargetCommandSent = true;
    }
    if (cavebotIsEnabled) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/releaseTargetingControl',
      });
    }
  }
}

// Event-driven message handler.
parentPort.on('message', (message) => {
  if (isShuttingDown) return;

  try {
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      return;
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

    if (isProcessing) {
      return;
    }

    const newBattleListHash = JSON.stringify(globalState.battleList?.entries);
    const newCreaturesHash = JSON.stringify(globalState.targeting?.creatures);
    const newTargetInstanceId = globalState.targeting?.target?.instanceId;
    const newTargetingListHash = JSON.stringify(
      globalState.targeting?.targetingList,
    );
    const newPlayerPosKey = playerMinimapPosition
      ? `${playerMinimapPosition.x},${playerMinimapPosition.y},${playerMinimapPosition.z}`
      : null;
    const newControlState = globalState.cavebot?.controlState;
    const newTargetingEnabled = globalState.targeting?.enabled;
    const newCavebotEnabled = globalState.cavebot?.enabled;

    const shouldProcess =
      newBattleListHash !== lastBattleListHash ||
      newCreaturesHash !== lastCreaturesHash ||
      newTargetInstanceId !== lastTargetInstanceId ||
      newTargetingListHash !== lastTargetingListHash ||
      newPlayerPosKey !== lastPlayerPosKey ||
      newControlState !== lastControlState ||
      newTargetingEnabled !== lastTargetingEnabled ||
      newCavebotEnabled !== lastCavebotEnabled;

    if (shouldProcess) {
      isProcessing = true;

      lastBattleListHash = newBattleListHash;
      lastCreaturesHash = newCreaturesHash;
      lastTargetInstanceId = newTargetInstanceId;
      lastTargetingListHash = newTargetingListHash;
      lastPlayerPosKey = newPlayerPosKey;
      lastControlState = newControlState;
      lastTargetingEnabled = newTargetingEnabled;
      lastCavebotEnabled = newCavebotEnabled;

      performTargeting()
        .catch((err) => {
          logger(
            'error',
            '[TargetingWorker] Unhandled error in performTargeting:',
            err,
          );
        })
        .finally(() => {
          isProcessing = false;
        });
    }
  } catch (error) {
    logger('error', '[TargetingWorker] Error handling message:', error);
    isProcessing = false;
  }
});
