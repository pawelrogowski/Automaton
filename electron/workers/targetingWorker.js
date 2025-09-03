// /home/feiron/Dokumenty/Automaton/electron/workers/targetingWorker.js
import { parentPort, workerData } from 'worker_threads';
import keypress from 'keypress-native';
import { createLogger } from '../utils/logger.js';
import { createTargetingActions } from './targeting/actions.js';
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
  PATH_STATUS_IDLE,
} from './sharedConstants.js';

const logger = createLogger({ info: false, error: true, debug: false });

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
const meleeRangeTimers = new Map();
let shouldRequestNewPath = false;
let justGainedControl = false;

// --- Targeting State & Context ---
// This object holds state that is mutated by the targeting actions module.
const targetingContext = {
  pathfindingTarget: null,
  lastPathfindingTargetSwitchTime: 0,
  acquisitionUnlockTime: 0,
  lastMovementTime: 0,
  lastDispatchedVisitedTile: null,
  lastClickTime: 0,
  lastClickedBattleListIndex: -1,
};

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

// --- Factory for Modularized Actions ---
const targetingActions = createTargetingActions({
  playerPosArray,
  pathDataArray,
  parentPort,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    if (shouldRequestNewPath) {
      path = [];
      pathfindingStatus = PATH_STATUS_IDLE;
      lastPathDataCounter = -1;
      shouldRequestNewPath = false;
      return;
    }

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
      const safePathLength = Math.min(pathLength, 50); // MAX_PATH_WAYPOINTS
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
  if (isShuttingDown || !isInitialized || !globalState?.global?.display) {
    return;
  }

  if (globalState.targeting?.isPausedByScript) {
    return;
  }

  if (justGainedControl) {
    await delay(100);
    justGainedControl = false;
  }

  if (!globalState.targeting?.enabled) {
    if (globalState.cavebot?.controlState === 'TARGETING') {
      // F8 press removed as per new requirement
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

  // Throttle how often the main target can change.
  const newPathfindingTarget = targetingActions.selectBestTargetFromGameWorld(
    globalState,
    playerMinimapPosition,
  );

  if (!newPathfindingTarget) {
    // If no target is found, clear it immediately, ignoring the cooldown.
    targetingContext.pathfindingTarget = null;
  } else if (
    newPathfindingTarget.instanceId !==
    targetingContext.pathfindingTarget?.instanceId
  ) {
    // A switch between two different valid targets is requested. Apply cooldown.
    const now = Date.now();
    if (now - targetingContext.lastPathfindingTargetSwitchTime > 100) {
      targetingContext.pathfindingTarget = newPathfindingTarget;
      targetingContext.lastPathfindingTargetSwitchTime = now;
    }
    // Otherwise, stick with the old target for this tick.
  } else {
    // It's the same target instance, just update its data.
    targetingContext.pathfindingTarget = newPathfindingTarget;
  }

  if (controlState === 'CAVEBOT' && cavebotIsEnabled) {
    if (targetingContext.pathfindingTarget) {
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

  let effectiveTarget = targetingContext.pathfindingTarget;
  const now = Date.now();
  const allCreatures = globalState.targeting.creatures || [];

  // Melee Override Logic
  const meleeConflict = Array.from(meleeRangeTimers.entries()).find(
    ([instanceId, startTime]) =>
      now - startTime > 100 && effectiveTarget?.instanceId !== instanceId,
  );
  if (meleeConflict) {
    const [meleeInstanceId] = meleeConflict;
    const blockingCreature = allCreatures.find(
      (c) => c.instanceId === meleeInstanceId,
    );
    const blockingCreatureRule =
      blockingCreature &&
      globalState.targeting.targetingList?.find(
        (r) =>
          r.name.startsWith(blockingCreature.name) && r.action === 'Attack',
      );
    if (blockingCreature && blockingCreatureRule) {
      logger(
        'info',
        `[Targeting] Overriding target ${effectiveTarget?.name || 'None'} to attack ${blockingCreature.name} in melee range.`,
      );
      effectiveTarget = { ...blockingCreature, rule: blockingCreatureRule };
    }
  }

  await targetingActions.manageMovement(
    targetingContext,
    globalState,
    effectiveTarget,
    path,
    pathfindingStatus,
    playerMinimapPosition,
  );

  const currentGameTarget = globalState.targeting.target;
  if (effectiveTarget) {
    if (Date.now() > targetingContext.acquisitionUnlockTime) {
      targetingActions.manageTargetAcquisition(
        targetingContext,
        globalState,
        effectiveTarget,
        currentGameTarget,
      );
    }
  } else {
    if (cavebotIsEnabled) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/releaseTargetingControl',
      });
    }
  }
  // Update lastEffectiveTarget for the next cycle
  targetingContext.lastEffectiveTarget = effectiveTarget;
}

// --- Main Worker Loop ---
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

    if (isProcessing || !globalState) return;

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

      if (
        (newControlState === 'TARGETING' && lastControlState !== 'TARGETING') ||
        (newControlState === 'HANDOVER_TO_TARGETING' &&
          lastControlState !== 'HANDOVER_TO_TARGETING')
      ) {
        shouldRequestNewPath = true;
        justGainedControl = true;
      }

      lastBattleListHash = newBattleListHash;
      lastCreaturesHash = newCreaturesHash;
      lastTargetInstanceId = newTargetInstanceId;
      lastTargetingListHash = newTargetingListHash;
      lastPlayerPosKey = newPlayerPosKey;
      lastControlState = newControlState;
      lastTargetingEnabled = newTargetingEnabled;
      lastCavebotEnabled = newCavebotEnabled;

      performTargeting()
        .catch((err) =>
          logger(
            'error',
            '[TargetingWorker] Unhandled error in performTargeting:',
            err,
          ),
        )
        .finally(() => {
          isProcessing = false;
        });
    }
  } catch (error) {
    logger('error', '[TargetingWorker] Error handling message:', error);
    isProcessing = false;
  }
});
