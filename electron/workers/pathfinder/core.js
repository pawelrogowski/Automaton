// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/core.js

import { parentPort, workerData } from 'worker_threads';
import Pathfinder from 'pathfinder-native';
import { createLogger } from '../../utils/logger.js';
import * as config from './config.js';
import { loadAllMapData } from './dataLoader.js';
import { runPathfindingLogic, setSABInterface } from './logic.js';
import { createWorkerInterface, WORKER_IDS } from '../sabState/index.js';

const logger = createLogger({ info: false, error: true, debug: false });

let state = null;
let pathfinderInstance = null;

const logicContext = {};

const REDUX_UPDATE_INTERVAL_MS = 25;
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

function handleMessage(message) {
  try {
    // ====================== DEBUG LOGGING START ======================
    if (message.type === 'state_diff') {
      logger('debug', `[PathfinderCore] Received state_diff. Keys: ${Object.keys(message.payload).join(', ')}`);
      if (message.payload.cavebot) {
        logger('debug', `[PathfinderCore] New cavebot state received. WptId: ${message.payload.cavebot.wptId}, Section: ${message.payload.cavebot.currentSection}`);
      }
      if (message.payload.targeting) {
        logger('debug', `[PathfinderCore] New targeting state received. Creature count: ${message.payload.targeting.creatures?.length || 0}`);
      }
    } else if (typeof message === 'object' && !message.type) {
        logger('debug', `[PathfinderCore] Received FULL state sync.`);
    }
    // ======================= DEBUG LOGGING END =======================

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

    if (!state || !state.gameState || !state.targeting || !state.cavebot) {
      return;
    }

    // Early exit if both cavebot and targeting are disabled
    if (!state.cavebot.enabled && !state.targeting.enabled) {
      return;
    }

    const playerMinimapPosition = state.gameState.playerMinimapPosition;

    if (!playerMinimapPosition || typeof playerMinimapPosition.x !== 'number') {
      return;
    }

    runPathfindingLogic({
      logicContext: logicContext,
      state: state,
      pathfinderInstance,
      logger,
      throttleReduxUpdate,
    });
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
  
  // Initialize unified SAB interface
  if (workerData.unifiedSAB) {
    const sabInterface = createWorkerInterface(workerData.unifiedSAB, WORKER_IDS.PATHFINDER);
    setSABInterface(sabInterface);
    logger('info', 'Unified SAB interface initialized');
  }
  
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