import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ info: false, error: true, debug: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let isProcessing = false;
let previousTargetedCreatureNamesInBattleList = new Set();

// Helper function to check if a targeted creature is present in the battle list,
// accounting for truncated names.
function isCreaturePresent(targetingCreatureName, battleListEntries) {
    for (const battleListEntry of battleListEntries) {
        const battleListName = battleListEntry.name;

        // Exact match
        if (targetingCreatureName === battleListName) {
            return true;
        }

        // Truncated match: battleListName ends with "..." and targetingCreatureName starts with the non-"..." part
        if (battleListName.endsWith('...') && targetingCreatureName.startsWith(battleListName.slice(0, -3))) {
            return true;
        }
    }
    return false;
}

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
      const targetingList = globalState.targeting.targetingList || [];

      const currentTargetedCreatureNamesInBattleList = new Set();

      for (const targetingCreature of targetingList) {
        if (isCreaturePresent(targetingCreature.name, currentBattleListEntries)) {
          currentTargetedCreatureNamesInBattleList.add(targetingCreature.name);
        }
      }

      // Identify creatures that were previously targeted and in the battle list, but are now gone.
      const disappearedCreatures = [...previousTargetedCreatureNamesInBattleList].filter(
        (creatureName) => !currentTargetedCreatureNamesInBattleList.has(creatureName)
      );

      if (disappearedCreatures.length > 0) {
        logger(
          'info',
          `[LootingWorker] Targeted creatures disappeared from battle list: ${Array.from(disappearedCreatures).join(', ')}. Pressing F8.`,
        );
        parentPort.postMessage({
          type: 'inputAction',
          payload: {
            type: 'looting',
            action: {
              module: 'keypress',
              method: 'sendKey',
              args: ['f8']
            }
          }
        });
        await delay(50);
      }

      previousTargetedCreatureNamesInBattleList = currentTargetedCreatureNamesInBattleList;
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