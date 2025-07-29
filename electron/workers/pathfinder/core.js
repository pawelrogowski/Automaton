import { parentPort } from 'worker_threads';
import Pathfinder from 'pathfinder-native';
import { createLogger } from '../../utils/logger.js';
import * as config from './config.js';
import { loadAllMapData } from './dataLoader.js';
import { runPathfindingLogic } from './logic.js';
import { PerformanceTracker } from './performanceTracker.js';

const logger = createLogger({ info: true, error: true, debug: false });

// --- Worker State ---
let state = null;
let pathfinderInstance = null;
const logicContext = {
  lastPlayerPosKey: null,
  lastTargetWptId: null,
  lastJsonForType: new Map(),
};

// --- Performance Tracking ---
const perfTracker = new PerformanceTracker();
let lastPerfReportTime = Date.now();

function logPerformanceReport() {
  if (!config.PERFORMANCE_LOGGING_ENABLED) return;

  const now = Date.now();
  if (now - lastPerfReportTime >= config.PERFORMANCE_LOG_INTERVAL_MS) {
    console.log(perfTracker.getReport());
    perfTracker.reset();
    lastPerfReportTime = now;
  }
}

function handleMessage(message) {
  // Update local state from main thread
  if (message.type === 'state_diff') {
    state = { ...state, ...message.payload };
  } else if (message.type === undefined) {
    state = message;
  } else {
    return; // Ignore other message types
  }

  // Only run logic if the cavebot is enabled in the state
  if (state?.cavebot?.enabled) {
    const duration = runPathfindingLogic({
      ...logicContext, // Pass all context properties
      state,
      pathfinderInstance,
      logger,
    });

    if (typeof duration === 'number') {
      perfTracker.addMeasurement(duration);
    }
  }

  // Always check if it's time to log, regardless of whether logic ran
  logPerformanceReport();
}

export async function start() {
  logger('info', 'Pathfinder worker starting up...');

  try {
    pathfinderInstance = new Pathfinder.Pathfinder();
    logger('info', 'Native Pathfinder addon loaded successfully.');
    loadAllMapData(pathfinderInstance, logger);
  } catch (err) {
    logger('error', `Pathfinder worker fatal error: ${err.message}`, err);
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
