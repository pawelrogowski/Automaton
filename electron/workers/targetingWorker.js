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
const CLICK_POLL_INTERVAL_MS = 50;
const MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS = 400;
const MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS = 750;
const MOVE_CONFIRM_GRACE_DIAGONAL_MS = 150;
const TARGET_CLICK_DELAY_MS = 400;
const MELEE_RANGE_TIMEOUT_MS = 100;
const MELEE_DISTANCE_THRESHOLD = 1.9;

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
const meleeRangeTimers = new Map();

// --- Change Detection State ---
let lastBattleListHash = null;
let lastCreaturesHash = null;
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

function arePositionsEqual(pos1, pos2) {
  if (!pos1 || !pos2) return pos1 === pos2;
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
}

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
  const { creatures, targetingList } = globalState.targeting;
  if (
    !creatures ||
    creatures.length === 0 ||
    !targetingList ||
    targetingList.length === 0
  ) {
    return null;
  }

  const reachableCreatures = creatures.filter((c) => c.isReachable);
  const pathfinderTargetInstanceId =
    globalState.cavebot?.dynamicTarget?.targetInstanceId;

  let stickinessBonus = 0;
  if (pathfinderTargetInstanceId) {
    const currentTargetOnScreen = reachableCreatures.find(
      (c) => c.instanceId === pathfinderTargetInstanceId,
    );
    if (currentTargetOnScreen) {
      const healthTag = getHealthTag(100);
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
      const healthTag = getHealthTag(100);
      const rule = targetingList.find(
        (r) =>
          r.name.startsWith(creature.name) &&
          r.action === 'Attack' &&
          (r.healthRange === 'Any' || r.healthRange === healthTag),
      );
      if (!rule) return null;

      let effectivePriority = rule.priority;
      if (
        pathfinderTargetInstanceId &&
        creature.instanceId === pathfinderTargetInstanceId
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

    if (a.gameCoords && b.gameCoords && playerMinimapPosition) {
      const distA = Math.max(
        Math.abs(a.gameCoords.x - playerMinimapPosition.x),
        Math.abs(a.gameCoords.y - playerMinimapPosition.y),
      );
      const distB = Math.max(
        Math.abs(b.gameCoords.x - playerMinimapPosition.x),
        Math.abs(b.gameCoords.y - playerMinimapPosition.y),
      );
      return distA - distB;
    }

    return a.distance - b.distance;
  });

  return targetableCreatures[0];
}

const manageTargetingClicks = async (pathfindingTarget, currentGameTarget) => {
  if (!pathfindingTarget) {
    lastClickedBattleListIndex = -1;
    return;
  }

  if (
    currentGameTarget?.instanceId === pathfindingTarget.instanceId ||
    (currentGameTarget &&
      currentGameTarget.name === pathfindingTarget.name &&
      currentGameTarget.gameCoords &&
      pathfindingTarget.gameCoords &&
      arePositionsEqual(
        currentGameTarget.gameCoords,
        pathfindingTarget.gameCoords,
      ))
  ) {
    lastClickedBattleListIndex = -1;
    return;
  }

  const now = Date.now();
  if (now - lastClickTime < TARGET_CLICK_DELAY_MS) {
    return;
  }

  const battleList = globalState.battleList.entries;
  const allCreatures = globalState.targeting.creatures;

  const findBattleListIndex = (targetCreature) => {
    if (!targetCreature) return -1;
    const creatureInWorld = allCreatures.find(
      (c) => c.instanceId === targetCreature.instanceId,
    );
    if (!creatureInWorld) return -1;

    return battleList.findIndex((entry) => {
      const matchingCreatureInWorld = allCreatures.find(
        (c) =>
          c.name.startsWith(entry.name) &&
          arePositionsEqual(c.gameCoords, creatureInWorld.gameCoords),
      );
      return !!matchingCreatureInWorld;
    });
  };

  if (battleList.length === 1) {
    const singleCreature = battleList[0];
    if (pathfindingTarget.name.startsWith(singleCreature.name)) {
      logger(
        'info',
        `[Targeting] Using Tab to acquire the only target: ${pathfindingTarget.name}`,
      );
      keypress.sendKey('Tab', globalState.global.display);
      lastClickTime = now;
      await delay(50);
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
      return;
    }
  }

  const desiredIndex = findBattleListIndex(pathfindingTarget);
  const currentIndex = findBattleListIndex(currentGameTarget);

  if (desiredIndex !== -1 && currentIndex !== -1) {
    const numTargets = battleList.length;

    if (desiredIndex === (currentIndex + 1) % numTargets) {
      logger(
        'info',
        `[Targeting] Using Tab to cycle to next target: ${pathfindingTarget.name}`,
      );
      keypress.sendKey('Tab', globalState.global.display);
      lastClickTime = now;
      await delay(50);
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
      return;
    }

    if (desiredIndex === (currentIndex - 1 + numTargets) % numTargets) {
      logger(
        'info',
        `[Targeting] Using Backtick to cycle to previous target: ${pathfindingTarget.name}`,
      );
      keypress.sendKey('`', globalState.global.display);
      lastClickTime = now;
      await delay(50);
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
      return;
    }
  }

  const potentialBLTargets = globalState.battleList.entries.filter((entry) =>
    pathfindingTarget.name.startsWith(entry.name),
  );

  if (potentialBLTargets.length === 0) {
    lastClickedBattleListIndex = -1;
    return;
  }

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

    const creatureInGameWorld = globalState.targeting.creatures.find(
      (c) =>
        c.name.startsWith(entry.name) &&
        arePositionsEqual(c.gameCoords, pathfindingTarget.gameCoords),
    );

    if (creatureInGameWorld) {
      targetToClick = entry;
      lastClickedBattleListIndex = currentIndex;
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
    lastClickTime = Date.now();

    await delay(50);

    keypress.sendKey('f8', globalState.global.display);

    await delay(50);

    lastClickedBattleListIndex =
      (lastClickedBattleListIndex + 1) % potentialBLTargets.length;
  } else {
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
    targetInstanceId: pathfindingTarget.instanceId,
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

  const now = Date.now();

  if (pathfindingStatus !== PATH_STATUS_PATH_FOUND || path.length === 0) {
    return;
  }

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

      const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
      const timeout = isDiagonal
        ? MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS
        : MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS;

      keypress.sendKey(dirKey, globalState.global.display);
      lastMovementTime = now;
      try {
        await awaitWalkConfirmation(
          posCounterBeforeMove,
          pathCounterBeforeMove,
          timeout,
        );
        if (isDiagonal) {
          await delay(MOVE_CONFIRM_GRACE_DIAGONAL_MS);
        }
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
      await delay(50);
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
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

  const now = Date.now();
  const allCreatures = globalState.targeting.creatures || [];
  const creaturesInMelee = new Set();

  for (const creature of allCreatures) {
    if (creature.distance < MELEE_DISTANCE_THRESHOLD) {
      creaturesInMelee.add(creature.instanceId);
      if (!meleeRangeTimers.has(creature.instanceId)) {
        meleeRangeTimers.set(creature.instanceId, now);
      }
    }
  }

  for (const instanceId of Array.from(meleeRangeTimers.keys())) {
    if (!creaturesInMelee.has(instanceId)) {
      meleeRangeTimers.delete(instanceId);
    }
  }

  let haltMovementDueToMelee = false;
  for (const [instanceId, startTime] of meleeRangeTimers.entries()) {
    if (now - startTime > MELEE_RANGE_TIMEOUT_MS) {
      const creature = allCreatures.find((c) => c.instanceId === instanceId);
      logger(
        'debug',
        `[Targeting] In melee range of ${
          creature?.name || 'a creature'
        } for ${now - startTime}ms. Halting movement.`,
      );
      haltMovementDueToMelee = true;
      break;
    }
  }

  if (!haltMovementDueToMelee) {
    await manageMovement(pathfindingTarget);
  }

  const currentGameTarget = globalState.targeting.target;

  if (pathfindingTarget) {
    clearTargetCommandSent = false;
    manageTargetingClicks(pathfindingTarget, currentGameTarget);
  } else {
    lastClickedBattleListIndex = -1;
    if (currentGameTarget && !clearTargetCommandSent) {
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
      clearTargetCommandSent = true;
    }
    if (cavebotIsEnabled) {
      await delay(50);
      keypress.sendKey('f8', globalState.global.display);
      await delay(50);
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
