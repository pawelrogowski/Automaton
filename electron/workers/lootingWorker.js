import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ info: false, error: true, debug: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;

parentPort.on('message', async (message) => {
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
          '[LootingWorker] Initial state received. Worker is now active.',
        );
      }
    }

    try {
      // The looting logic has been moved to targetingWorker.js
      // This worker will now only handle state updates and shutdown messages.
    } catch (err) {
      logger('error', '[LootingWorker] Error in processing logic:', err);
    } finally {
    }
  } catch (error) {
    logger('error', '[LootingWorker] Error handling message:', error);
  }
});
