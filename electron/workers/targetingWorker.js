// targetingWorker.js
import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createWorkerInterface, WORKER_IDS } from './sabState/index.js';
import { performance } from 'perf_hooks';
import {
  selectBestTarget,
  acquireTarget,
  updateDynamicTarget,
  manageMovement,
  findRuleForCreatureName,
} from './targeting/targetingLogic.js';
import { isBattleListMatch } from '../utils/nameMatcher.js';
import {
  PATH_STATUS_IDLE,
} from './sabState/schema.js';

const logger = createLogger({ info: false, error: true, debug: false });

// Track last target for change detection
let lastLoggedTarget = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- FSM States ---
const FSM_STATE = {
  IDLE: 'IDLE',
  SELECTING: 'SELECTING',
  PREPARE_ACQUISITION: 'PREPARE_ACQUISITION',
  PERFORM_ACQUISITION: 'PERFORM_ACQUISITION',
  VERIFY_ACQUISITION: 'VERIFY_ACQUISITION',
  ENGAGING: 'ENGAGING',
};

// --- Configuration ---
const config = {
  mainLoopIntervalMs: 50,
  unreachableTimeoutMs: 400,
  acquireTimeoutMs: 355, // Global rate limit: minimum time between ANY targeting clicks
  acquisitionGraceTimeMs: 400,
};

// --- Worker State (data from other sources) ---
const workerState = {
  globalState: null,
  isInitialized: false,
  isShuttingDown: false,
  playerMinimapPosition: null,
  path: [],
  pathfindingStatus: PATH_STATUS_IDLE,
  pathWptId: 0,
  pathInstanceId: 0,
  isWaitingForMovement: false,
  movementWaitUntil: 0,
};

// --- Targeting FSM State ---
const targetingState = {
  state: FSM_STATE.IDLE,
  pathfindingTarget: null, // The creature we WANT to target
  currentTarget: null, // The creature we HAVE targeted
  unreachableSince: 0,
  lastTargetingClickTime: 0, // Timestamp of last targeting click (for global rate limiting)
  lastDispatchedDynamicTargetId: null,
  acquisitionStartTime: 0, // When we first started trying to acquire current pathfindingTarget
  lastAcquireAttempt: {
    targetName: '',
    targetInstanceId: null,
  },
  stuckTargetTracking: {
    adjacentSince: 0,
    lastHp: null,
  },
};
// Initialize unified SAB interface
let sabInterface = null;
if (workerData.unifiedSAB) {
  sabInterface = createWorkerInterface(workerData.unifiedSAB, WORKER_IDS.TARGETING);
  logger('info', '[TargetingWorker] Unified SAB interface initialized');
} else {
  throw new Error('[TargetingWorker] Unified SAB interface is required');
}

// --- Unified SAB Wrappers ---
const getCreaturesFromSAB = () => {
  try {
    const result = sabInterface.get('creatures');
    if (result && result.data && Array.isArray(result.data)) {
      return result.data.map(creature => ({
        ...creature,
        distance: creature.distance / 100,
        gameCoords: { x: creature.x, y: creature.y, z: creature.z }
      }));
    }
  } catch (err) {
    logger('error', `[TargetingWorker] Failed to read creatures from unified SAB: ${err.message}`);
  }
  return [];
};

const getCurrentTargetFromSAB = () => {
  try {
    const result = sabInterface.get('target');
    if (result && result.data) {
      const target = result.data;
      if (target.instanceId !== 0) {
        return target;
      }
    }
    return null;
  } catch (err) {
    logger('error', `[TargetingWorker] Failed to read target from unified SAB: ${err.message}`);
  }
  return null;
};

const getBattleListFromSAB = () => {
  try {
    const result = sabInterface.get('battleList');
    if (result && result.data && Array.isArray(result.data)) {
      return result.data;
    }
  } catch (err) {
    logger('error', `[TargetingWorker] Failed to read battle list from unified SAB: ${err.message}`);
  }
  return [];
};

const isLootingRequired = () => {
  try {
    const result = sabInterface.get('looting');
    if (result && result.data) {
      return result.data.required === 1;
    }
  } catch (err) {
    logger('error', `[TargetingWorker] Failed to read looting state: ${err.message}`);
  }
  return false;
};

// --- State Transition Helper ---
function transitionTo(newState, reason = '') {
  if (targetingState.state === newState) {
    return;
  }
  logger('info', `[TRANSITION] ${targetingState.state} → ${newState} (${reason})`);
  targetingState.state = newState;

  // Reset state-specific timers and data on transition
  switch (newState) {
    case FSM_STATE.SELECTING:
      targetingState.pathfindingTarget = null;
      targetingState.currentTarget = null;
      break;
    case FSM_STATE.PREPARE_ACQUISITION:
      targetingState.unreachableSince = 0;
      break;
    case FSM_STATE.VERIFY_ACQUISITION:
      // No need to set timestamp here - it's already set in PERFORM_ACQUISITION
      break;
  }
}

// Checks the status of target acquisition synchronously.
function checkAcquisitionStatus(expectedInstanceId, expectedName) {
  const currentTarget = getCurrentTargetFromSAB();

  if (!currentTarget || currentTarget.instanceId === 0) {
    return { status: 'NO_TARGET' };
  }

  if (currentTarget.instanceId === expectedInstanceId) {
    return { status: 'SUCCESS', target: currentTarget };
  }

  if (currentTarget.name === expectedName) {
    return { status: 'WRONG_INSTANCE', target: currentTarget };
  }

  return { status: 'OTHER_TARGET', target: currentTarget };
}

// --- FSM State Handlers ---

function handleIdleState() {
  if (workerState.globalState?.targeting?.enabled && !isLootingRequired()) {
    transitionTo(FSM_STATE.SELECTING, 'Targeting enabled');
  } else {
    if (targetingState.lastDispatchedDynamicTargetId !== null) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      targetingState.lastDispatchedDynamicTargetId = null;
    }
    targetingState.pathfindingTarget = null;
  }
}

function handleSelectingState() {
  // Prefer reachable targets: if any reachable creatures exist, select among them
  const allCreatures = getCreaturesFromSAB();
  const reachableCreatures = allCreatures.filter(c => c.isReachable);
  const provider = () => (reachableCreatures.length > 0 ? reachableCreatures : allCreatures);

  // 1) Compute rules-based best target (where we want to go)
  let bestTarget = selectBestTarget(
    provider,
    workerState.globalState.targeting.targetingList,
    null
  );

  // 2) If we already have an in-game target with the same name that's still reachable,
  //    prefer that exact instance to avoid swapping between same-named creatures.
  //    UNLESS we were actively trying to acquire a different instance (prevents deadlock).
  const sabTarget = getCurrentTargetFromSAB();
  if (bestTarget && sabTarget && 
      (!targetingState.pathfindingTarget || 
       targetingState.pathfindingTarget.instanceId === bestTarget.instanceId)) {
    const sabEntity = allCreatures.find(c => c.instanceId === sabTarget.instanceId);
    if (
      sabEntity && sabEntity.isReachable &&
      isBattleListMatch(sabEntity.name, bestTarget.name)
    ) {
      bestTarget = sabEntity; // stick to current instance
    }
  }

  if (bestTarget) {
    targetingState.pathfindingTarget = bestTarget;
    if (targetingState.lastDispatchedDynamicTargetId !== bestTarget.instanceId) {
      updateDynamicTarget(
        parentPort,
        bestTarget,
        workerState.globalState.targeting.targetingList
      );
      targetingState.lastDispatchedDynamicTargetId = bestTarget.instanceId;
    }
    transitionTo(FSM_STATE.PREPARE_ACQUISITION, `Found target: ${bestTarget.name}`);
  } else {
    if (targetingState.lastDispatchedDynamicTargetId !== null) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      targetingState.lastDispatchedDynamicTargetId = null;
    }
    targetingState.pathfindingTarget = null;
    transitionTo(FSM_STATE.IDLE, 'No valid targets');
  }
}

function handlePrepareAcquisitionState() {
  const now = performance.now();
  const { pathfindingTarget } = targetingState;

  if (!pathfindingTarget) {
    transitionTo(FSM_STATE.SELECTING, 'No pathfinding target');
    return;
  }

  // Guard: if in-game target is a different creature (not just different instance), re-evaluate
  const currentSABTarget = getCurrentTargetFromSAB();
  if (currentSABTarget && currentSABTarget.instanceId !== 0 && 
      !isBattleListMatch(currentSABTarget.name, pathfindingTarget.name)) {
    transitionTo(FSM_STATE.SELECTING, `In-game target mismatch: ${currentSABTarget.name} vs ${pathfindingTarget.name}`);
    return;
  }

  const updatedTarget = getCreaturesFromSAB().find(c => c.instanceId === pathfindingTarget.instanceId);
  if (!updatedTarget) {
    transitionTo(FSM_STATE.SELECTING, 'Target disappeared');
    return;
  }
  targetingState.pathfindingTarget = updatedTarget; // Refresh with latest creature data

  if (!updatedTarget.isReachable) {
    if (!targetingState.unreachableSince) {
      targetingState.unreachableSince = now;
    } else if (now - targetingState.unreachableSince > config.acquisitionGraceTimeMs) {
      transitionTo(FSM_STATE.SELECTING, `Target unreachable for > ${config.acquisitionGraceTimeMs}ms`);
      return;
    }
    return; // Wait for it to become reachable again
  }

  transitionTo(FSM_STATE.PERFORM_ACQUISITION, 'Checks passed');
}

function handlePerformAcquisitionState() {
  const now = performance.now();
  const { pathfindingTarget } = targetingState;

  // Enforce global rate limit: prevent clicking more than once per acquireTimeoutMs
  const timeSinceLastClick = now - targetingState.lastTargetingClickTime;
  if (timeSinceLastClick < config.acquireTimeoutMs) {
    return; // Still within rate limit, wait silently
  }

  // === COMPREHENSIVE SNAPSHOT LOG BEFORE CLICK ===
  const allCreatures = getCreaturesFromSAB();
  const battleList = getBattleListFromSAB();
  const currentSABTarget = getCurrentTargetFromSAB();
  const targetingList = workerState.globalState.targeting.targetingList;
  
  logger('info', '\n========== TARGETING CLICK SNAPSHOT ==========');
  logger('info', `[CLICK TARGET] ${pathfindingTarget.name} (ID: ${pathfindingTarget.instanceId})`);
  logger('info', `  Position: (${pathfindingTarget.gameCoords?.x}, ${pathfindingTarget.gameCoords?.y}, ${pathfindingTarget.gameCoords?.z})`);
  logger('info', `  Screen: (${pathfindingTarget.absoluteX}, ${pathfindingTarget.absoluteY})`);
  logger('info', `  Distance: ${pathfindingTarget.distance?.toFixed(2)}, Reachable: ${pathfindingTarget.isReachable}`);
  
  const targetRule = findRuleForCreatureName(pathfindingTarget.name, targetingList);
  logger('info', `  Priority: ${targetRule?.priority ?? 'N/A'}, Stance: ${targetRule?.stance ?? 'N/A'}`);
  
  logger('info', `[CURRENT SAB TARGET] ${currentSABTarget ? `${currentSABTarget.name} (ID: ${currentSABTarget.instanceId})` : 'NONE'}`);
  
  logger('info', '[ALL CREATURES] Total: ' + allCreatures.length);
  allCreatures.forEach(c => {
    const rule = findRuleForCreatureName(c.name, targetingList);
    const marker = c.instanceId === pathfindingTarget.instanceId ? ' <-- CLICKING THIS' : '';
    logger('info', 
      `  ${c.name} (ID: ${c.instanceId}) | ` +
      `Pos: (${c.gameCoords?.x}, ${c.gameCoords?.y}, ${c.gameCoords?.z}) | ` +
      `Dist: ${c.distance?.toFixed(2)} | ` +
      `Reach: ${c.isReachable} | ` +
      `Prio: ${rule?.priority ?? 'N/A'}${marker}`
    );
  });
  
  logger('info', '[BATTLE LIST] Total: ' + battleList.length);
  battleList.forEach(b => {
    logger('info', `  ${b.name}`);
  });
  
  logger('info', '[TARGETING RULES]');
  targetingList.filter(r => r.action === 'Attack').forEach(r => {
    logger('info', `  ${r.name} - Priority: ${r.priority}, Stance: ${r.stance}`);
  });
  
  logger('info', '===============================================\n');
  
  const result = acquireTarget(
    getBattleListFromSAB,
    parentPort,
    pathfindingTarget.name,
    -1, // lastClickedIndex is no longer used for cycling
    workerState.globalState,
    getCreaturesFromSAB,
    () => workerState.playerMinimapPosition,
    pathfindingTarget.instanceId,
  );

  if (result.success) {
    targetingState.lastAcquireAttempt.targetInstanceId = pathfindingTarget.instanceId;
    targetingState.lastAcquireAttempt.targetName = pathfindingTarget.name;
    targetingState.lastTargetingClickTime = now; // Record click time for rate limiting
    transitionTo(FSM_STATE.VERIFY_ACQUISITION, 'Action performed');
  } else {
    transitionTo(FSM_STATE.SELECTING, `Acquire action failed: ${result.reason}`);
  }
}

function handleVerifyAcquisitionState() {
  const now = performance.now();
  const { targetInstanceId, targetName } = targetingState.lastAcquireAttempt;
  const timeSinceClick = now - targetingState.lastTargetingClickTime;

  const verification = checkAcquisitionStatus(targetInstanceId, targetName);

  if (verification.status === 'SUCCESS') {
    logger('info', `[ACQUIRE] Successfully acquired ${targetName} (ID: ${targetInstanceId})`);
    targetingState.currentTarget = verification.target;
    transitionTo(FSM_STATE.ENGAGING, 'Acquired correct instance');
    return;
  }

  if (verification.status === 'WRONG_INSTANCE') {
    const newTarget = getCreaturesFromSAB().find(c => c.instanceId === verification.target.instanceId);
    if (newTarget && newTarget.isReachable) {
      logger('info', `[ACQUIRE] Wrong instance, but same name. Sticking with new target ${newTarget.name} (ID: ${newTarget.instanceId})`);
      targetingState.currentTarget = newTarget;
      targetingState.pathfindingTarget = newTarget;
      updateDynamicTarget(parentPort, newTarget, workerState.globalState.targeting.targetingList);
      transitionTo(FSM_STATE.ENGAGING, 'Sticking with new instance');
    } else {
      // The wrong instance we hit is not reachable, so it's a failure.
      logger('warn', `[ACQUIRE] Hit wrong instance (${verification.target.instanceId}), but it's unreachable. Retrying.`);
      transitionTo(FSM_STATE.PREPARE_ACQUISITION, 'Wrong instance was unreachable');
    }
    return;
  }

  // If NO_TARGET or OTHER_TARGET, wait for timeout (using lastTargetingClickTime as reference)
  if (timeSinceClick >= config.acquireTimeoutMs) {
    logger('warn', `[ACQUIRE] Timeout waiting for ${targetName} (${timeSinceClick.toFixed(0)}ms). Retrying action.`);
    transitionTo(FSM_STATE.PREPARE_ACQUISITION, 'Verification timeout');
  }
}

async function handleEngagingState() {
  const now = Date.now();
  
  if (workerState.isWaitingForMovement) {
    if (now < workerState.movementWaitUntil) {
      return;
    } else {
      workerState.isWaitingForMovement = false;
    }
  }
  
  const creatures = getCreaturesFromSAB();
  const { globalState } = workerState;
  const targetingList = globalState.targeting.targetingList;

  const actualInGameTarget = getCurrentTargetFromSAB();
  if (!targetingState.currentTarget || !actualInGameTarget || 
      actualInGameTarget.instanceId !== targetingState.currentTarget.instanceId) {
    transitionTo(FSM_STATE.SELECTING, 'Target lost or changed');
    return;
  }

  const bestOverallTarget = selectBestTarget(
    () => creatures,
    targetingList,
    targetingState.currentTarget
  );
  
  if (
    bestOverallTarget &&
    bestOverallTarget.instanceId !== targetingState.currentTarget.instanceId
  ) {
    const currentRule = findRuleForCreatureName(
      targetingState.currentTarget.name,
      targetingList
    );
    const bestRule = findRuleForCreatureName(
      bestOverallTarget.name,
      targetingList
    );

    targetingState.pathfindingTarget = bestOverallTarget;
    updateDynamicTarget(parentPort, bestOverallTarget, targetingList);
    transitionTo(FSM_STATE.PREPARE_ACQUISITION, `Found better target`);
    return;
  }

  const updatedTarget = creatures.find(
    (c) => c.instanceId === targetingState.currentTarget.instanceId
  );

  if (!updatedTarget) {
    transitionTo(FSM_STATE.SELECTING, 'Target died or disappeared');
    return;
  }

  const positionChanged = 
    !targetingState.currentTarget.gameCoords ||
    !updatedTarget.gameCoords ||
    targetingState.currentTarget.gameCoords.x !== updatedTarget.gameCoords.x ||
    targetingState.currentTarget.gameCoords.y !== updatedTarget.gameCoords.y ||
    targetingState.currentTarget.gameCoords.z !== updatedTarget.gameCoords.z;
  
  targetingState.currentTarget = updatedTarget;
  targetingState.pathfindingTarget = updatedTarget; // Keep pathfindingTarget in sync for movement
  
  if (positionChanged) {
    const rule = findRuleForCreatureName(updatedTarget.name, targetingList);
    if (rule && rule.stance !== 'Stand') {
      updateDynamicTarget(parentPort, updatedTarget, targetingList);
    }
  }

  // Track stuck target (adjacent but not attacking)
  if (updatedTarget.isAdjacent) {
    if (targetingState.stuckTargetTracking.adjacentSince === 0) {
      targetingState.stuckTargetTracking.adjacentSince = now;
      targetingState.stuckTargetTracking.lastHp = updatedTarget.hp;
    } else if (updatedTarget.hp === targetingState.stuckTargetTracking.lastHp) {
      const stuckDuration = now - targetingState.stuckTargetTracking.adjacentSince;
      if (stuckDuration > 3500) {
        logger('info', `[STUCK TARGET] Target ${updatedTarget.name} (ID ${updatedTarget.instanceId}) adjacent for ${stuckDuration}ms with no HP change. Pressing Escape.`);
        parentPort.postMessage({
          type: 'inputAction',
          payload: {
            type: 'targeting',
            action: { module: 'keypress', method: 'sendKey', args: ['Escape'] },
          },
        });
        // Force re-selection after escape
        targetingState.stuckTargetTracking.adjacentSince = 0;
        targetingState.stuckTargetTracking.lastHp = null;
        transitionTo(FSM_STATE.SELECTING, 'Stuck target recovery');
        return;
      }
    } else {
      // HP changed, reset tracking
      targetingState.stuckTargetTracking.adjacentSince = now;
      targetingState.stuckTargetTracking.lastHp = updatedTarget.hp;
    }
  } else {
    // Not adjacent, reset tracking
    targetingState.stuckTargetTracking.adjacentSince = 0;
    targetingState.stuckTargetTracking.lastHp = null;
  }

  if (!updatedTarget.isReachable) {
    if (targetingState.unreachableSince === 0) {
      targetingState.unreachableSince = now;
    } else if (now - targetingState.unreachableSince > config.unreachableTimeoutMs) {
      transitionTo(
        FSM_STATE.SELECTING,
        `Target unreachable for > ${config.unreachableTimeoutMs}ms`
      );
      targetingState.unreachableSince = 0;
      return;
    }
  }
  else {
    targetingState.unreachableSince = 0;
  }
  
  // Movement is now handled globally after FSM switch statement
}

// --- Main Loop ---

function updateSABData() {
  if (!sabInterface) {
    logger('error', '[TargetingWorker] Unified SAB interface not available!');
    return;
  }
  
  try {
    const posResult = sabInterface.get('playerPos');
    if (posResult && posResult.data) {
      const pos = posResult.data;
      if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
        workerState.playerMinimapPosition = pos;
      }
    }
    
    const pathResult = sabInterface.get('targetingPathData');
    if (pathResult && pathResult.data) {
      const pathData = pathResult.data;
      
      const PATH_STATUS_PATH_FOUND = 1;
      const isTargetingPath = (pathData.instanceId || 0) > 0;
      const newInstanceId = pathData.instanceId || 0;
      const isNewTarget = newInstanceId !== workerState.pathInstanceId && newInstanceId > 0;
      const isValidPath = 
        pathData.status === PATH_STATUS_PATH_FOUND && 
        pathData.waypoints && 
        pathData.waypoints.length >= 2;
      
      if (isNewTarget) {
        workerState.path = [];
        workerState.pathInstanceId = newInstanceId;
      }
      
      if (isTargetingPath && isValidPath) {
        workerState.path = pathData.waypoints;
        workerState.pathfindingStatus = pathData.status;
        workerState.pathWptId = pathData.wptId || 0;
        workerState.pathInstanceId = newInstanceId;
      }
    }
  } catch (err) {
    logger('error', `[TargetingWorker] SAB read failed: ${err.message}`);
  }
}

async function performTargeting() {
  updateSABData();

  const { globalState, isInitialized } = workerState;
  if (!isInitialized || !globalState?.targeting) return;

  if (sabInterface) {
    try {
      sabInterface.set('targetingList', globalState.targeting.targetingList);
    } catch (err) {
      logger('error', `[TargetingWorker] Failed to write targeting list: ${err.message}`);
    }
  }

  if (!globalState.targeting.enabled || isLootingRequired()) {
    transitionTo(FSM_STATE.IDLE, 'Targeting disabled or looting');
  }

  const { controlState } = globalState.cavebot;

  if (controlState === 'HANDOVER_TO_TARGETING') {
    if (sabInterface) {
      try {
        sabInterface.set('cavebotPathData', {
          waypoints: [],
          length: 0,
          status: 0,
          chebyshevDistance: 0,
          startX: 0,
          startY: 0,
          startZ: 0,
          targetX: 0,
          targetY: 0,
          targetZ: 0,
          blockingCreatureX: 0,
          blockingCreatureY: 0,
          blockingCreatureZ: 0,
          wptId: 0,
          instanceId: 0,
        });
      } catch (err) {
        logger('error', `[TargetingWorker] Failed to clear cavebot path: ${err.message}`);
      }
    }
    
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/confirmTargetingControl',
    });
    return;
  }

  if (controlState === 'TARGETING' && workerState.playerMinimapPosition) {
    const currentPos = workerState.playerMinimapPosition;
    
    if (
      !targetingState.lastDispatchedVisitedTile ||
      targetingState.lastDispatchedVisitedTile.x !== currentPos.x ||
      targetingState.lastDispatchedVisitedTile.y !== currentPos.y ||
      targetingState.lastDispatchedVisitedTile.z !== currentPos.z
    ) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/addVisitedTile',
        payload: currentPos,
      });
      targetingState.lastDispatchedVisitedTile = { ...currentPos };
    }
  }

  switch (targetingState.state) {
    case FSM_STATE.IDLE:
      handleIdleState();
      break;
    case FSM_STATE.SELECTING:
      handleSelectingState();
      break;
    case FSM_STATE.PREPARE_ACQUISITION:
      if (controlState === 'TARGETING') handlePrepareAcquisitionState();
      break;
    case FSM_STATE.PERFORM_ACQUISITION:
      if (controlState === 'TARGETING') handlePerformAcquisitionState();
      break;
    case FSM_STATE.VERIFY_ACQUISITION:
      if (controlState === 'TARGETING') handleVerifyAcquisitionState();
      break;
    case FSM_STATE.ENGAGING:
      if (controlState === 'TARGETING') await handleEngagingState();
      break;
  }

  // Movement: use pathfindingTarget in all states (not just ENGAGING)
  if (controlState === 'TARGETING' && targetingState.pathfindingTarget) {
    const movementContext = {
      targetingList: globalState.targeting.targetingList,
    };
    
    await manageMovement(
      { 
        ...workerState, 
        parentPort, 
        sabInterface,
      },
      movementContext,
      targetingState.pathfindingTarget
    );
  }

  const hasValidTarget =
    targetingState.state === FSM_STATE.PREPARE_ACQUISITION ||
    targetingState.state === FSM_STATE.PERFORM_ACQUISITION ||
    targetingState.state === FSM_STATE.VERIFY_ACQUISITION ||
    targetingState.state === FSM_STATE.ENGAGING;

  const anyValidTargetExists = selectBestTarget(
    getCreaturesFromSAB,
    globalState.targeting.targetingList
  );

  if (hasValidTarget && controlState === 'CAVEBOT') {
    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/requestTargetingControl' });
  }

  if (!hasValidTarget && !anyValidTargetExists && controlState === 'TARGETING') {
    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/releaseTargetingControl' });
  }
}

async function mainLoop() {
  logger('info', '[TargetingWorker] Starting FSM-based main loop...');
  while (!workerState.isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performTargeting();
    } catch (error) {
      logger('error', '[TargetingWorker] Unhandled error in main loop:', error);
      await delay(1000);
    }
    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, config.mainLoopIntervalMs - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
  logger('info', '[TargetingWorker] Main loop stopped.');
}

// --- Worker Initialization and Message Handling ---

parentPort.on('message', (message) => {
  if (workerState.isShuttingDown) return;
  try {
    if (message.type === 'shutdown') {
      workerState.isShuttingDown = true;
      return;
    } else if (message.type === 'state_diff') {
      if (!workerState.globalState) workerState.globalState = {};
      Object.assign(workerState.globalState, message.payload);
    } else if (typeof message === 'object' && !message.type) {
      workerState.globalState = message;
      if (!workerState.isInitialized) {
        workerState.isInitialized = true;
        logger('info', '[TargetingWorker] Initial state received, starting main loop.');
        mainLoop().catch((error) => {
          logger('error', '[TargetingWorker] Fatal error in main loop:', error);
          process.exit(1);
        });
      }
    }
  } catch (error) {
    logger('error', '[TargetingWorker] Error handling message:', error);
  }
});

function startWorker() {
  if (!workerData) {
    throw new Error('[TargetingWorker] Worker data not provided');
  }
  logger('info', '[TargetingWorker] Worker initialized, waiting for initial state...');
}

startWorker();