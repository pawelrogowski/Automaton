// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/core.js
// --- Definitive Version with Input Synchronization to Eliminate Race Conditions ---

import { parentPort, workerData } from 'worker_threads';
import Pathfinder from 'pathfinder-native';
import { createLogger } from '../../utils/logger.js';
import * as config from './config.js';
import { loadAllMapData } from './dataLoader.js';
import { runPathfindingLogic } from './logic.js';
import { PerformanceTracker } from './performanceTracker.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PLAYER_POS_UPDATE_COUNTER_INDEX,
} from '../sharedConstants.js';

const logger = createLogger({ info: true, error: true, debug: false });

// --- Worker State ---
let state = null;
let pathfinderInstance = null;

const logicContext = {
  lastPlayerPosKey: null,
  lastTargetWptId: null,
  lastJsonForType: new Map(),
};

const { playerPosSAB, pathDataSAB } = workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;

const perfTracker = new PerformanceTracker();
let lastPerfReportTime = Date.now();

const REDUX_UPDATE_INTERVAL_MS = 150;
let lastReduxUpdateTime = 0;
let reduxUpdateTimeout = null;
let pendingReduxUpdatePayload = null;

function postThrottledUpdate() {
  if (pendingReduxUpdatePayload) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'pathfinder/setPathfindingFeedback',
      payload: pendingReduxUpdatePayload,
    });
    lastReduxUpdateTime = Date.now();
    pendingReduxUpdatePayload = null;
  }
  if (reduxUpdateTimeout) {
    clearTimeout(reduxUpdateTimeout);
    reduxUpdateTimeout = null;
  }
}

function throttleReduxUpdate(payload) {
  pendingReduxUpdatePayload = payload;
  const now = Date.now();
  const timeSinceLastUpdate = now - lastReduxUpdateTime;
  if (timeSinceLastUpdate >= REDUX_UPDATE_INTERVAL_MS) {
    postThrottledUpdate();
  } else if (!reduxUpdateTimeout) {
    reduxUpdateTimeout = setTimeout(
      postThrottledUpdate,
      REDUX_UPDATE_INTERVAL_MS - timeSinceLastUpdate,
    );
  }
}

function logPerformanceReport() {
  if (!config.PERFORMANCE_LOGGING_ENABLED) return;
  const now = Date.now();
  if (now - lastPerfReportTime >= config.PERFORMANCE_LOG_INTERVAL_MS) {
    logger('info', perfTracker.getReport());
    perfTracker.reset();
    lastPerfReportTime = now;
  }
}

// --- MODIFIED: The main message handler is now the core of the synchronization logic ---
function handleMessage(message) {
  try {
    // 1. Update the worker's state from the main thread. This is our primary trigger.
    if (message.type === 'state_diff') {
      state = { ...state, ...message.payload };
    } else if (message.type === undefined) {
      state = message;
    } else if (message.type === 'shutdown') {
      if (reduxUpdateTimeout) clearTimeout(reduxUpdateTimeout);
      return;
    } else {
      // Ignore other message types
      return;
    }

    // Ensure we have a valid state to work with
    if (!state || !state.gameState) {
      return;
    }

    // 2. SYNCHRONIZATION POINT: As soon as we get a state update,
    //    perform a fresh, blocking read of the player's position from the SAB.
    //    This creates a consistent "snapshot" of the game state.
    let playerMinimapPosition = null;
    if (playerPosArray) {
      playerMinimapPosition = {
        x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
      };
    } else {
      // Fallback for safety, though SAB should always be present
      playerMinimapPosition = state.gameState.playerMinimapPosition;
    }

    // If we don't have a valid position, we can't do anything.
    if (!playerMinimapPosition || typeof playerMinimapPosition.x !== 'number') {
      return;
    }

    // 3. EXECUTION: Run the pathfinding logic with the synchronized snapshot.
    const synchronizedState = {
      ...state,
      gameState: { ...state.gameState, playerMinimapPosition },
    };

    const duration = runPathfindingLogic({
      ...logicContext,
      state: synchronizedState,
      pathfinderInstance,
      logger,
      pathDataArray,
      throttleReduxUpdate,
    });

    if (typeof duration === 'number') {
      perfTracker.addMeasurement(duration);
    }

    logPerformanceReport();
  } catch (error) {
    logger(
      'error',
      '[PathfinderCore] Unhandled error in message handler:',
      error,
    );
  }
}

export async function start() {
  logger('info', 'Pathfinder worker starting up...');
  try {
    pathfinderInstance = new Pathfinder.Pathfinder();
    logger('info', 'Native Pathfinder addon loaded successfully.');
    loadAllMapData(pathfinderInstance, logger);
  } catch (err) {
    logger(
      'error',
      `Pathfinder worker fatal error on startup: ${err.message}`,
      err,
    );
    if (parentPort) {
      parentPort.postMessage({
        fatalError: err.message || 'Unknown fatal error in worker',
      });
    }
    process.exit(1);
  }
  parentPort.on('message', handleMessage);
  parentPort.on('close', () => {
    logger('info', 'Parent port closed. Stopping pathfinder worker.');
    process.exit(0);
  });
}
