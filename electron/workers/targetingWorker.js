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
import {
  PATH_STATUS_IDLE,
} from './sharedConstants.js';

const logger = createLogger({ info: true, error: true, debug: true });

// Track last target for change detection
let lastLoggedTarget = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- FSM States ---
const FSM_STATE = {
  IDLE: 'IDLE',
  SELECTING: 'SELECTING',
  ACQUIRING: 'ACQUIRING',
  ENGAGING: 'ENGAGING',
};

// --- Configuration ---
const config = {
  mainLoopIntervalMs: 50,
  unreachableTimeoutMs: 400,
  acquireTimeoutMs: 400,
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
  // Movement lock to prevent double-stepping
  isWaitingForMovement: false,
  movementWaitUntil: 0,
};

// --- Targeting FSM State ---
const targetingState = {
  state: FSM_STATE.IDLE,
  pathfindingTarget: null, // The creature object we WANT to target
  currentTarget: null, // The creature object we ARE currently targeting
  unreachableSince: 0, // Timestamp for when currentTarget became unreachable
  lastDispatchedDynamicTargetId: null, // Track last dispatched target to prevent redundant updates
  lastAcquireAttempt: {
    timestamp: 0,
    battleListIndex: -1,
    targetName: '',
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
      // Add gameCoords property from x,y,z fields for compatibility
      // Convert distance back from SAB format (stored as * 100)
      return result.data.map(creature => ({
        ...creature,
        distance: creature.distance / 100, // SAB stores distance * 100
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
      // instanceId: 0 means no target
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
    logger('debug', `[TRANSITION] Already in ${newState}, skipping`);
    return;
  }
  logger('info', `[TRANSITION] ${targetingState.state} → ${newState} (${reason})`);
  targetingState.state = newState;

  if (newState === FSM_STATE.SELECTING) {
    targetingState.pathfindingTarget = null;
    targetingState.currentTarget = null;
    // DON'T clear dynamicTarget here to prevent flickering
    // It will be cleared in handleSelectingState if no targets found
  }
  if (newState === FSM_STATE.ACQUIRING) {
    targetingState.lastAcquireAttempt.timestamp = 0;
    targetingState.lastAcquireAttempt.clickCount = 0;
  }
}

// --- FSM State Handlers ---

function handleIdleState() {
  if (
    workerState.globalState?.targeting?.enabled &&
    !isLootingRequired()
  ) {
    transitionTo(FSM_STATE.SELECTING, 'Targeting enabled');
  } else {
    // Clear dynamicTarget only when targeting is disabled and we're truly idle
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
  // Don't pass current target in SELECTING state - we want fresh evaluation
  const bestTarget = selectBestTarget(
    getCreaturesFromSAB,
    workerState.globalState.targeting.targetingList,
    null
  );

  if (bestTarget) {
    targetingState.pathfindingTarget = bestTarget;
    // Only update if target actually changed to prevent redundant updates
    if (targetingState.lastDispatchedDynamicTargetId !== bestTarget.instanceId) {
      logger('debug', `[TARGET CHANGE] SELECTING → ${bestTarget.name} (ID: ${bestTarget.instanceId}, distance: ${bestTarget.distance?.toFixed(1)}, adjacent: ${bestTarget.isAdjacent}, reachable: ${bestTarget.isReachable})`);
      updateDynamicTarget(
        parentPort,
        bestTarget,
        workerState.globalState.targeting.targetingList
      );
      targetingState.lastDispatchedDynamicTargetId = bestTarget.instanceId;
    }
    transitionTo(FSM_STATE.ACQUIRING, `Found target: ${bestTarget.name}`);
  } else {
    // No valid targets found - NOW clear dynamicTarget
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

function handleAcquiringState() {
  const now = performance.now();
  const { pathfindingTarget } = targetingState;
  const creatures = getCreaturesFromSAB();
  
  // Don't check if pathfindingTarget is unreachable here - we need to cycle through
  // battle list entries to find a reachable one with the same name
  
  // 1. Always check for success first.
  const currentInGameTarget = getCurrentTargetFromSAB();
  const isTargetLive = currentInGameTarget
    ? creatures.some((c) => c.instanceId === currentInGameTarget.instanceId)
    : false;

  // 1a. If we have a target but it's unreachable, cycle after timeout
  // BUT: Only if we're actually waiting for a target (timestamp != 0)
  // This prevents infinite loop where we keep waiting for timeout on stale target
  if (
    currentInGameTarget &&
    isTargetLive &&
    currentInGameTarget.name === pathfindingTarget.name &&
    !currentInGameTarget.isReachable &&
    targetingState.lastAcquireAttempt.timestamp !== 0  // Only if we're waiting for THIS click
  ) {
    if (targetingState.unreachableSince === 0) {
      targetingState.unreachableSince = now;
    } else if (now - targetingState.unreachableSince > config.unreachableTimeoutMs) {
      logger('debug', `[FSM-ACQUIRING] Target ${currentInGameTarget.name} unreachable for > ${config.unreachableTimeoutMs}ms - cycling to next battle list entry`);
      targetingState.unreachableSince = 0;
      // Reset timestamp to allow immediate click of next battle list entry
      // Keep battleListIndex so we cycle to the NEXT entry
      targetingState.lastAcquireAttempt.timestamp = 0;
      return;
    }
    // Still waiting for timeout
    return;
  } else if (targetingState.unreachableSince > 0) {
    // Target became reachable again, reset timer
    targetingState.unreachableSince = 0;
  }

  if (
    currentInGameTarget &&
    isTargetLive &&
    currentInGameTarget.name === pathfindingTarget.name &&
    currentInGameTarget.isReachable
  ) {
    // Find the actual creature object with full details
    const actualTargetCreature = creatures.find(c => 
      c.instanceId === currentInGameTarget.instanceId
    );
    
    if (!actualTargetCreature) {
      // Target exists in game but not in creatures list yet, wait
      return;
    }
    
    // CRITICAL: Reject unreachable creatures immediately and cycle to next battle list entry
    if (!actualTargetCreature.isReachable) {
      logger('debug', `[FSM-ACQUIRING] Target ${actualTargetCreature.name} (ID: ${actualTargetCreature.instanceId}) is unreachable - will cycle to next battle list entry`);
      // Clear timestamp to allow next click attempt
      // Keep battleListIndex so the next click will try the NEXT entry in the list
      targetingState.lastAcquireAttempt.timestamp = 0;
      return;
    }
    
    // SIMPLE CHECK: Does the instance ID match what we want?
    const isInstanceMatch = actualTargetCreature.instanceId === pathfindingTarget.instanceId;
    
    if (isInstanceMatch) {
      // Perfect! We found the exact creature we wanted
      logger('debug', `[FSM-ACQUIRING] Accepted ${actualTargetCreature.name} (ID: ${actualTargetCreature.instanceId}) - instance ID match`);
      
      targetingState.pathfindingTarget = actualTargetCreature;
      targetingState.currentTarget = actualTargetCreature;
      targetingState.lastAcquireAttempt.clickCount = 0;
      
      // Update dynamic target
      const targetingList = workerState.globalState.targeting.targetingList;
      const rule = findRuleForCreatureName(actualTargetCreature.name, targetingList);
      if (rule && rule.stance !== 'Stand') {
        if (targetingState.lastDispatchedDynamicTargetId !== actualTargetCreature.instanceId) {
          updateDynamicTarget(parentPort, actualTargetCreature, targetingList);
          targetingState.lastDispatchedDynamicTargetId = actualTargetCreature.instanceId;
        }
      }
      
      transitionTo(
        FSM_STATE.ENGAGING,
        `Acquired target ${actualTargetCreature.name} - instance ID match`
      );
      return;
    } else {
      // Wrong creature - cycle to next battle list entry
      logger('debug', `[FSM-ACQUIRING] Wrong creature (wanted ID: ${pathfindingTarget.instanceId}, got ID: ${actualTargetCreature.instanceId}) - cycling`);
      targetingState.lastAcquireAttempt.timestamp = 0;
      return;
    }
  }

  // 2. Check if there are ANY creatures with the same name (reachable or not)
  // If the original pathfindingTarget is unreachable, we'll cycle through battle list
  // to find another creature with the same name that IS reachable
  const creaturesWithSameName = creatures.filter(c => c.name === pathfindingTarget.name);
  
  if (creaturesWithSameName.length === 0) {
    // No creatures with this name exist anymore - go back to SELECTING
    transitionTo(
      FSM_STATE.SELECTING,
      'No creatures with target name found'
    );
    return;
  }
  
  // Check if ANY creature with this name is reachable
  const anyReachable = creaturesWithSameName.some(c => c.isReachable);
  if (!anyReachable) {
    // All creatures with this name are unreachable - go back to SELECTING
    logger('debug', `[FSM-ACQUIRING] All ${pathfindingTarget.name} creatures unreachable - reselecting`);
    transitionTo(
      FSM_STATE.SELECTING,
      'All creatures with target name are unreachable'
    );
    return;
  }

  // 3. Core acquisition logic: Act or Wait.
  const hasClickedAndIsWaiting = targetingState.lastAcquireAttempt.timestamp !== 0;

  if (hasClickedAndIsWaiting) {
    if (now > targetingState.lastAcquireAttempt.timestamp + config.acquireTimeoutMs) {
      logger('debug', `[FSM-ACQUIRING] Verification for ${targetingState.lastAcquireAttempt.targetName} timed out. Will retry.`);
      targetingState.lastAcquireAttempt.timestamp = 0;
    }
    return;
  }

  // Only reset battleListIndex if we're targeting a DIFFERENT creature name
  // This preserves cycling progress when SELECTING picks another creature with same name
  if (targetingState.lastAcquireAttempt.targetName !== pathfindingTarget.name) {
    // Different creature name - reset cycling
    targetingState.lastAcquireAttempt.battleListIndex = -1;
    targetingState.lastAcquireAttempt.targetName = pathfindingTarget.name;
    logger('debug', `[FSM-ACQUIRING] New creature name ${pathfindingTarget.name}, resetting battleListIndex`);
  } else {
    logger('debug', `[FSM-ACQUIRING] Same creature name ${pathfindingTarget.name}, preserving battleListIndex: ${targetingState.lastAcquireAttempt.battleListIndex}`);
  }

  // We cannot correlate battle list UI coordinates with game world coordinates,
  // so we always cycle through battle list entries and verify each one in game world
  logger('debug', `[FSM-ACQUIRING] Attempting to click ${pathfindingTarget.name} (ID: ${pathfindingTarget.instanceId}, lastIndex: ${targetingState.lastAcquireAttempt.battleListIndex})`);
  const result = acquireTarget(
    getBattleListFromSAB,
    parentPort,
    pathfindingTarget.name,
    targetingState.lastAcquireAttempt.battleListIndex,
    workerState.globalState,  // Pass globalState for region access
    getCreaturesFromSAB,      // Pass creature getter function
    () => workerState.playerMinimapPosition,  // Pass player position getter
    null  // Don't pass instance ID - we'll verify after clicking
  );

  targetingState.lastAcquireAttempt.timestamp = now;

  if (result.success) {
    logger('debug', `[FSM-ACQUIRING] Clicked battle list entry ${result.clickedIndex} (method: ${result.method || 'unknown'})`);
    targetingState.lastAcquireAttempt.battleListIndex = result.clickedIndex;
  } else {
    transitionTo(FSM_STATE.SELECTING, `${pathfindingTarget.name} not in battle list`);
  }
}

async function handleEngagingState() {
  const now = Date.now();
  
  // Don't engage if we're waiting for movement confirmation
  if (workerState.isWaitingForMovement) {
    if (now < workerState.movementWaitUntil) {
      // Still waiting - skip engagement
      return;
    } else {
      // Timeout expired, clear the lock
      workerState.isWaitingForMovement = false;
    }
  }
  
  const creatures = getCreaturesFromSAB();
  const { globalState } = workerState;
  const targetingList = globalState.targeting.targetingList;

  const actualInGameTarget = getCurrentTargetFromSAB();
  if (!targetingState.currentTarget || !actualInGameTarget || actualInGameTarget.instanceId !== targetingState.currentTarget.instanceId) {
    const reason = !targetingState.currentTarget ? 'no currentTarget' : 
                   !actualInGameTarget ? 'no in-game target' :
                   'instance ID mismatch';
    logger('debug', `[TARGET LOST] ${targetingState.currentTarget?.name || 'unknown'} (ID: ${targetingState.currentTarget?.instanceId || 'N/A'}) - Reason: ${reason} (game ID: ${actualInGameTarget?.instanceId || 'N/A'})`);
    transitionTo(FSM_STATE.SELECTING, 'Target lost or changed');
    return;
  }

  // Pass current target for hysteresis - prevents switching for minor score differences
  const bestOverallTarget = selectBestTarget(getCreaturesFromSAB, targetingList, targetingState.currentTarget);
  if (
    bestOverallTarget &&
    bestOverallTarget.instanceId !== targetingState.currentTarget.instanceId
  ) {
    // Use helper to find rules (supports "Others" wildcard)
    const currentRule = findRuleForCreatureName(
      targetingState.currentTarget.name,
      targetingList
    );
    const bestRule = findRuleForCreatureName(
      bestOverallTarget.name,
      targetingList
    );

    // Require at least 2 priority levels higher to preempt current target
    const PRIORITY_THRESHOLD = 2;
    if (bestRule && currentRule && bestRule.priority >= currentRule.priority + PRIORITY_THRESHOLD) {
      logger(
        'debug',
        `[TARGET CHANGE] PREEMPT → ${bestOverallTarget.name} (ID: ${bestOverallTarget.instanceId}, Prio: ${bestRule.priority}) replaces ${targetingState.currentTarget.name} (ID: ${targetingState.currentTarget.instanceId}, Prio: ${currentRule.priority})`
      );
      targetingState.pathfindingTarget = bestOverallTarget;
      updateDynamicTarget(parentPort, bestOverallTarget, targetingList);
      transitionTo(FSM_STATE.ACQUIRING, `Found higher priority target`);
      return;
    }
  }

  const updatedTarget = creatures.find(
    (c) => c.instanceId === targetingState.currentTarget.instanceId
  );

  if (!updatedTarget) {
    logger('debug', `[TARGET LOST] ${targetingState.currentTarget.name} (ID: ${targetingState.currentTarget.instanceId}) - Reason: not found in creatures list`);
    transitionTo(FSM_STATE.SELECTING, 'Target died or disappeared');
    return;
  }

  // Check if the creature's position changed significantly, update dynamic target
  const positionChanged = 
    !targetingState.currentTarget.gameCoords ||
    !updatedTarget.gameCoords ||
    targetingState.currentTarget.gameCoords.x !== updatedTarget.gameCoords.x ||
    targetingState.currentTarget.gameCoords.y !== updatedTarget.gameCoords.y ||
    targetingState.currentTarget.gameCoords.z !== updatedTarget.gameCoords.z;
  
  targetingState.currentTarget = updatedTarget;
  
  // Update dynamic target if position changed to keep pathfinder in sync
  if (positionChanged) {
    const rule = findRuleForCreatureName(updatedTarget.name, targetingList);
    if (rule && rule.stance !== 'Stand') {
      // Always update on position change to trigger pathfinder recalculation
      updateDynamicTarget(parentPort, updatedTarget, targetingList);
    }
  }

  if (!updatedTarget.isReachable) {
    if (targetingState.unreachableSince === 0) {
      targetingState.unreachableSince = now;
      logger('info', `[ENGAGING] Target ${updatedTarget.name} (ID: ${updatedTarget.instanceId}) became unreachable - starting ${config.unreachableTimeoutMs}ms timeout`);
    } else if (now - targetingState.unreachableSince > config.unreachableTimeoutMs) {
      logger('info', `[ENGAGING] Target ${updatedTarget.name} unreachable for > ${config.unreachableTimeoutMs}ms - reselecting`);
      transitionTo(
        FSM_STATE.SELECTING,
        `Target unreachable for > ${config.unreachableTimeoutMs}ms`
      );
      targetingState.unreachableSince = 0;
      return;
    } else {
      const elapsed = now - targetingState.unreachableSince;
      logger('debug', `[ENGAGING] Target ${updatedTarget.name} still unreachable (${elapsed}ms / ${config.unreachableTimeoutMs}ms)`);
    }
  } else {
    if (targetingState.unreachableSince > 0) {
      logger('debug', `[ENGAGING] Target ${updatedTarget.name} became reachable again - resetting timer`);
    }
    targetingState.unreachableSince = 0;
  }

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
    targetingState.currentTarget
  );
}

// --- Main Loop ---

function updateSABData() {
  if (!sabInterface) {
    logger('error', '[TargetingWorker] Unified SAB interface not available!');
    return;
  }
  
  try {
    // Read player position from unified SAB
    const posResult = sabInterface.get('playerPos');
    if (posResult && posResult.data) {
      const pos = posResult.data;
      if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
        workerState.playerMinimapPosition = pos;
      }
    }
    
    // Read path data from targeting-specific SAB array
    const pathResult = sabInterface.get('targetingPathData');
    if (pathResult && pathResult.data) {
      const pathData = pathResult.data;
      
      // Accept valid targeting paths: instanceId > 0 means targeting mode
      const PATH_STATUS_PATH_FOUND = 1;
      const isTargetingPath = (pathData.instanceId || 0) > 0;
      const newInstanceId = pathData.instanceId || 0;
      const isNewTarget = newInstanceId !== workerState.pathInstanceId && newInstanceId > 0;
      const isValidPath = 
        pathData.status === PATH_STATUS_PATH_FOUND && 
        pathData.waypoints && 
        pathData.waypoints.length >= 2;
      
      // Clear path when switching to a new target (even if new path is invalid yet)
      if (isNewTarget) {
        workerState.path = [];
        workerState.pathInstanceId = newInstanceId;
      }
      
      // Only accept valid paths
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

  // Write targeting list to unified SAB
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
    // Clear cavebot path in SAB to prevent stale path usage
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
        logger('debug', '[TargetingWorker] Cleared cavebot path on control handover');
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

  // Report visited tiles only when position changes during targeting control
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
    case FSM_STATE.ACQUIRING:
      if (controlState === 'TARGETING') handleAcquiringState();
      break;
    case FSM_STATE.ENGAGING:
      if (controlState === 'TARGETING') await handleEngagingState();
      break;
  }

  const hasValidTarget =
    targetingState.state === FSM_STATE.ACQUIRING ||
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