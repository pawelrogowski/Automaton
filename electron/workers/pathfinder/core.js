// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/core.js

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
} from '../sharedConstants.js';

const logger = createLogger({ info: true, error: true, debug: false });

let state = null;
let pathfinderInstance = null;

const logicContext = {
  lastPlayerPosKey: null,
  lastTargetWptId: null,
  lastJsonForType: new Map(),
  lastCreatureDataHash: null, // NEW: Cache based on creature data hash
};

const { playerPosSAB, pathDataSAB } = workerData; // creaturePosSAB is removed
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

function handleMessage(message) {
  try {
    if (message.type === 'state_diff') {
      state = { ...state, ...message.payload };
    } else if (message.type === undefined) {
      state = message;
    } else if (message.type === 'shutdown') {
      if (reduxUpdateTimeout) clearTimeout(reduxUpdateTimeout);
      return;
    } else {
      return;
    }

    if (!state || !state.gameState || !state.targeting) {
      // Ensure targeting slice exists
      return;
    }

    let playerMinimapPosition = null;
    if (playerPosArray) {
      playerMinimapPosition = {
        x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
      };
    } else {
      playerMinimapPosition = state.gameState.playerMinimapPosition;
    }

    if (!playerMinimapPosition || typeof playerMinimapPosition.x !== 'number') {
      return;
    }

    // REMOVED: All logic reading from creaturePosSAB is gone.

    const synchronizedState = {
      ...state,
      gameState: { ...state.gameState, playerMinimapPosition },
    };

    const duration = runPathfindingLogic({
      logicContext: logicContext,
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
