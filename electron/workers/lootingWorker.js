import { parentPort } from 'worker_threads';
import keypress from 'keypress-native';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ info: false, error: true, debug: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let isProcessing = false;
let previousBattleListLength = 0;

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

    if (isProcessing || !globalState?.battleList?.entries) return;

    isProcessing = true;

    try {
      const currentBattleListEntries = globalState.battleList.entries;
      const currentBattleListLength = currentBattleListEntries.length;

      if (isInitialized && currentBattleListLength < previousBattleListLength) {
        logger(
          'info',
          `[LootingWorker] BattleList entries decreased from ${previousBattleListLength} to ${currentBattleListLength}. Pressing F8.`,
        );
        keypress.sendKey('f8', globalState.global.display);
        await delay(50);
      }

      previousBattleListLength = currentBattleListLength;
    } catch (err) {
      logger('error', '[LootingWorker] Error in processing logic:', err);
    } finally {
      isProcessing = false;
    }
  } catch (error) {
    logger('error', '[LootingWorker] Error handling message:', error);
    isProcessing = false;
  }
});
