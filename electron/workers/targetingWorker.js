// targetingWorker.js
import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { SABStateManager } from './sabStateManager.js';
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
  WORLD_STATE_UPDATE_COUNTER_INDEX,
} from './sharedConstants.js';

const logger = createLogger({ info: true, error: true, debug: false });
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
  mainLoopIntervalMs: 100,
  unreachableTimeoutMs: 400,
  acquireTimeoutMs: 400, // Time to wait for target verification after a click
  controlHysteresisMs: 150, // Require stability before request/release control
  dynamicGoalGraceMs: 300,  // Keep dynamic target briefly to avoid flicker
  hpStagnationTimeoutMs: 4000, // HP must change within 4 seconds when adjacent
  hpStagnationCheckIntervalMs: 500, // Check HP every 500ms
};

// --- Worker State (data from other sources) ---
const workerState = {
  globalState: null,
  isInitialized: false,
  isShuttingDown: false,
  playerMinimapPosition: null,
  path: [],
  pathfindingStatus: PATH_STATUS_IDLE,
  lastWorldStateCounter: -1,
  pathWptId: 0,
  pathInstanceId: 0,
};

// --- Targeting FSM State ---
const targetingState = {
  state: FSM_STATE.IDLE,
  pathfindingTarget: null, // The creature object we WANT to target
  currentTarget: null, // The creature object we ARE currently targeting
  unreachableSince: 0, // Timestamp for when currentTarget became unreachable
  lastAcquireAttempt: {
    timestamp: 0,
    battleListIndex: -1,
    targetName: '',
  },
  lastMovementTime: 0,
  dynamicTargetLastSetAt: 0,
  dynamicTargetClearRequestedAt: 0,
  // HP Stagnation Detection (Bot Detection Bypass)
  hpStagnationDetection: {
    lastHpValue: null, // Last recorded HP value
    lastHpChangeTime: 0, // When HP last changed
    lastCheckTime: 0, // When we last checked HP
    hasBeenAdjacent: false, // Whether we've been adjacent to track stagnation
  },
};

const { creaturesSAB } = workerData;
const sabStateManager = new SABStateManager(workerData);
const creaturesArray = creaturesSAB ? new Int32Array(creaturesSAB) : null;

// --- HP Stagnation Detection ---
function checkHpStagnation(target) {
  const config = workerState.globalState?.targeting?.hpStagnationDetection;
  if (!config?.enabled) return;
  
  // Only perform HP stagnation detection if we're supposed to be attacking
  const targetingList = workerState.globalState?.targeting?.targetingList;
  const rule = findRuleForCreatureName(target.name, targetingList);
  if (!rule || rule.stance === 'Stand') {
    return; // Not attacking this creature
  }
  
  const now = Date.now();
  const { hpStagnationDetection } = targetingState;
  
  // Only check when adjacent to the target
  if (!target.isAdjacent) {
    hpStagnationDetection.hasBeenAdjacent = false;
    return;
  }
  
  // Mark that we've been adjacent at least once
  hpStagnationDetection.hasBeenAdjacent = true;
  
  // Check interval (default 500ms)
  if (now - hpStagnationDetection.lastCheckTime < config.checkInterval) {
    return;
  }
  
  hpStagnationDetection.lastCheckTime = now;
  
  const currentHp = target.hp;
  
  // Initialize if first check
  if (hpStagnationDetection.lastHpValue === null) {
    hpStagnationDetection.lastHpValue = currentHp;
    hpStagnationDetection.lastHpChangeTime = now;
    return;
  }
  
  // HP changed - reset timer
  if (currentHp !== hpStagnationDetection.lastHpValue) {
    hpStagnationDetection.lastHpValue = currentHp;
    hpStagnationDetection.lastHpChangeTime = now;
    return;
  }
  
  // HP stagnant for too long - send escape key
  const stagnantTime = now - hpStagnationDetection.lastHpChangeTime;
  if (stagnantTime >= config.stagnantTimeoutMs) {
    logger('warn', `[HP Stagnation] HP stagnant for ${stagnantTime}ms, sending escape key`);
    
    // Send escape key to untarget
    parentPort.postMessage({
      type: 'keypress',
      payload: {
        keyCode: 27, // Escape key
        ctrl: false,
        shift: false,
        alt: false
      }
    });
    
    // Reset tracking and transition to selecting new target
    hpStagnationDetection.lastHpValue = null;
    hpStagnationDetection.lastHpChangeTime = now;
    hpStagnationDetection.hasBeenAdjacent = false;
    
    transitionTo(FSM_STATE.SELECTING, 'HP stagnation detected - escaped');
  }
}

// --- State Transition Helper ---
function transitionTo(newState, reason = '') {
  if (targetingState.state === newState) return;
  logger(
    'debug',
    `[FSM] Transition: ${targetingState.state} -> ${newState}` +
      (reason ? ` (${reason})` : '')
  );
  targetingState.state = newState;

  if (newState === FSM_STATE.SELECTING) {
    targetingState.pathfindingTarget = null;
    targetingState.currentTarget = null;
    // Do NOT clear dynamic target immediately; request a clear after grace
    targetingState.dynamicTargetClearRequestedAt = Date.now();
    // Reset HP stagnation tracking
    targetingState.hpStagnationDetection = {
      lastHpValue: null,
      lastHpChangeTime: 0,
      lastCheckTime: 0,
      hasBeenAdjacent: false,
    };
  }
  if (newState === FSM_STATE.ACQUIRING) {
    targetingState.lastAcquireAttempt.timestamp = 0;
  }
  if (newState === FSM_STATE.ENGAGING) {
    // Initialize HP tracking when we start engaging
    const now = Date.now();
    targetingState.hpStagnationDetection = {
      lastHpValue: null,
      lastHpChangeTime: now,
      lastCheckTime: now,
      hasBeenAdjacent: false,
    };
  }
}

// --- FSM State Handlers ---

function handleIdleState() {
  if (
    workerState.globalState?.targeting?.enabled &&
    !sabStateManager.isLootingRequired()
  ) {
    transitionTo(FSM_STATE.SELECTING, 'Targeting enabled');
  }
}

function handleSelectingState() {
  const bestTarget = selectBestTarget(
    sabStateManager,
    workerState.globalState.targeting.targetingList
  );

  if (bestTarget) {
    targetingState.pathfindingTarget = bestTarget;
    updateDynamicTarget(
      parentPort,
      bestTarget,
      workerState.globalState.targeting.targetingList
    );
    targetingState.dynamicTargetLastSetAt = Date.now();
    transitionTo(FSM_STATE.ACQUIRING, `Found target: ${bestTarget.name}`);
  } else {
    transitionTo(FSM_STATE.IDLE, 'No valid targets');
  }
}

function handleAcquiringState() {
  const now = performance.now();
  const { pathfindingTarget } = targetingState;
  const creatures = sabStateManager.getCreatures();

  // 1. Always check for success first.
  const currentInGameTarget = sabStateManager.getCurrentTarget();
  const isTargetLive = currentInGameTarget
    ? creatures.some((c) => c.instanceId === currentInGameTarget.instanceId)
    : false;

  if (
    currentInGameTarget &&
    isTargetLive &&
    currentInGameTarget.name === pathfindingTarget.name &&
    currentInGameTarget.isReachable
  ) {
    targetingState.currentTarget = currentInGameTarget;
    
    // Update dynamic target with the actual acquired target to sync instance IDs
    // (The pathfindingTarget might have a different instance ID)
    const targetingList = workerState.globalState.targeting.targetingList;
    const rule = findRuleForCreatureName(currentInGameTarget.name, targetingList);
    if (rule && rule.stance !== 'Stand') {
      updateDynamicTarget(parentPort, currentInGameTarget, targetingList);
      targetingState.dynamicTargetLastSetAt = Date.now();
    }
    
    transitionTo(
      FSM_STATE.ENGAGING,
      `Acquired target ${currentInGameTarget.name}`
    );
    return;
  }

  // 2. Check if our desired target is still valid.
  const pathfindingTargetStillExists = creatures.some(
    (c) => c.instanceId === pathfindingTarget.instanceId && c.isReachable
  );

  if (!pathfindingTargetStillExists) {
    transitionTo(
      FSM_STATE.SELECTING,
      'Pathfinding target disappeared or became unreachable'
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

  if (targetingState.lastAcquireAttempt.targetName !== pathfindingTarget.name) {
    targetingState.lastAcquireAttempt.battleListIndex = -1;
    targetingState.lastAcquireAttempt.targetName = pathfindingTarget.name;
  }

  logger('debug', `[FSM-ACQUIRING] Attempting to click ${pathfindingTarget.name}`);
  const result = acquireTarget(
    sabStateManager,
    parentPort,
    pathfindingTarget.name,
    targetingState.lastAcquireAttempt.battleListIndex,
    workerState.globalState  // Pass globalState for region access
  );

  targetingState.lastAcquireAttempt.timestamp = now;

  if (result.success) {
    targetingState.lastAcquireAttempt.battleListIndex = result.clickedIndex;
  } else {
    transitionTo(FSM_STATE.SELECTING, `${pathfindingTarget.name} not in battle list`);
  }
}

async function handleEngagingState() {
  const now = performance.now();
  const creatures = sabStateManager.getCreatures();
  const { globalState } = workerState;
  const targetingList = globalState.targeting.targetingList;

  const actualInGameTarget = sabStateManager.getCurrentTarget();
  if (!targetingState.currentTarget || !actualInGameTarget || actualInGameTarget.instanceId !== targetingState.currentTarget.instanceId) {
    transitionTo(FSM_STATE.SELECTING, 'Target lost or changed');
    return;
  }

  const bestOverallTarget = selectBestTarget(sabStateManager, targetingList);
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

    if (bestRule && currentRule && bestRule.priority > currentRule.priority) {
      logger(
        'info',
        `[FSM] Preempting ${targetingState.currentTarget.name} (Prio: ${currentRule.priority}) for ${bestOverallTarget.name} (Prio: ${bestRule.priority})`
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
      updateDynamicTarget(parentPort, updatedTarget, targetingList);
      targetingState.dynamicTargetLastSetAt = Date.now();
    }
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
  } else {
    targetingState.unreachableSince = 0;
  }

  // Pass lastMovementTime by reference through targetingState
  const movementContext = {
    targetingList: globalState.targeting.targetingList,
    lastMovementTime: targetingState.lastMovementTime,
  };
  
  await manageMovement(
    { ...workerState, parentPort, sabStateManager },
    movementContext,
    targetingState.currentTarget
  );
  
  // Update lastMovementTime in targetingState if it was changed
  targetingState.lastMovementTime = movementContext.lastMovementTime;
  
  // HP stagnation detection
  checkHpStagnation(updatedTarget);
}

// --- Main Loop ---

function updateSABData() {
  if (!creaturesArray) return;
  const newWorldStateCounter = Atomics.load(
    creaturesArray,
    WORLD_STATE_UPDATE_COUNTER_INDEX
  );
  if (newWorldStateCounter > workerState.lastWorldStateCounter) {
    // Use getCurrentPlayerPosition() to always get the current position
    const playerPos = sabStateManager.getCurrentPlayerPosition();
    if (playerPos) {
      workerState.playerMinimapPosition = playerPos;
    }
    
    const pathData = sabStateManager.getPath();
    workerState.path = pathData.path;
    workerState.pathfindingStatus = pathData.status;
    workerState.pathWptId = pathData.wptId;
    workerState.pathInstanceId = pathData.instanceId;
    workerState.lastWorldStateCounter = newWorldStateCounter;
  }
}

async function performTargeting() {
  updateSABData();

  const { globalState, isInitialized } = workerState;
  if (!isInitialized || !globalState?.targeting) return;

  sabStateManager.writeTargetingList(globalState.targeting.targetingList);

  if (!globalState.targeting.enabled || sabStateManager.isLootingRequired()) {
    transitionTo(FSM_STATE.IDLE, 'Targeting disabled or looting');
  }

  const { controlState } = globalState.cavebot;

  if (controlState === 'HANDOVER_TO_TARGETING') {
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
    sabStateManager,
    globalState.targeting.targetingList
  );

  // Hysteresis: request/release control only after stability window
  const nowTs = Date.now();
  if (hasValidTarget && controlState === 'CAVEBOT') {
    if (!performTargeting._requestSince) performTargeting._requestSince = nowTs;
    if (nowTs - performTargeting._requestSince >= config.controlHysteresisMs) {
      parentPort.postMessage({ storeUpdate: true, type: 'cavebot/requestTargetingControl' });
      performTargeting._requestSince = 0;
    }
  } else {
    performTargeting._requestSince = 0;
  }

  if (!hasValidTarget && !anyValidTargetExists && controlState === 'TARGETING') {
    if (!performTargeting._releaseSince) performTargeting._releaseSince = nowTs;
    if (nowTs - performTargeting._releaseSince >= config.controlHysteresisMs) {
      parentPort.postMessage({ storeUpdate: true, type: 'cavebot/releaseTargetingControl' });
      performTargeting._releaseSince = 0;
    }
  } else {
    performTargeting._releaseSince = 0;
  }

  // Gracefully clear dynamic target if we've been SELECTING for longer than grace
  if (
    targetingState.state === FSM_STATE.SELECTING &&
    targetingState.dynamicTargetClearRequestedAt &&
    nowTs - targetingState.dynamicTargetClearRequestedAt >= config.dynamicGoalGraceMs &&
    nowTs - targetingState.dynamicTargetLastSetAt >= config.dynamicGoalGraceMs
  ) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: null,
    });
    targetingState.dynamicTargetClearRequestedAt = 0;
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