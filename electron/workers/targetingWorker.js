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
};

const { creaturesSAB } = workerData;
const sabStateManager = new SABStateManager(workerData);
const creaturesArray = creaturesSAB ? new Int32Array(creaturesSAB) : null;

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
    updateDynamicTarget(parentPort, null, []);
  }
  if (newState === FSM_STATE.ACQUIRING) {
    targetingState.lastAcquireAttempt.timestamp = 0;
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
    targetingState.lastAcquireAttempt.battleListIndex
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
    const currentRule = targetingList.find(
      (r) => r.name === targetingState.currentTarget.name
    );
    const bestRule = targetingList.find(
      (r) => r.name === bestOverallTarget.name
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

  targetingState.currentTarget = updatedTarget;

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

  await manageMovement(
    { ...workerState, parentPort, sabStateManager },
    {
      targetingList: globalState.targeting.targetingList,
      lastMovementTime: targetingState.lastMovementTime,
    },
    targetingState.currentTarget
  );
}

// --- Main Loop ---

function updateSABData() {
  if (!creaturesArray) return;
  const newWorldStateCounter = Atomics.load(
    creaturesArray,
    WORLD_STATE_UPDATE_COUNTER_INDEX
  );
  if (newWorldStateCounter > workerState.lastWorldStateCounter) {
    workerState.playerMinimapPosition = sabStateManager.getPlayerPosition();
    const pathData = sabStateManager.getPath();
    workerState.path = pathData.path;
    workerState.pathfindingStatus = pathData.status;
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

  // <<< ADDED: Report visited tiles whenever targeting has control.
  if (controlState === 'TARGETING' && workerState.playerMinimapPosition) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/addVisitedTile',
      payload: workerState.playerMinimapPosition,
    });
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

  if (hasValidTarget && controlState === 'CAVEBOT') {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/requestTargetingControl',
    });
  } else if (!hasValidTarget && !anyValidTargetExists && controlState === 'TARGETING') {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/releaseTargetingControl',
    });
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