import { parentPort } from 'worker_threads';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { createLogger } from '../utils/logger.js';

const log = createLogger({
  info: true,
  error: true,
  debug: false,
});

const PRIORITY_MAP = {
  userRule: 0, // New highest priority
  hotkey: 1,
  movement: 2,
  looting: 2, // Added looting priority
  default: 3,
};

const MAX_DEFERRALS = 4; // Max times a lower priority item can be deferred

let globalState = null;
const eventQueue = [];
let isProcessing = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (isProcessing || eventQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;

  // --- Starvation Prevention Logic ---
  // First, identify the highest priority currently in the queue
  let highestPriorityInQueue = Infinity;
  if (eventQueue.length > 0) {
    highestPriorityInQueue = eventQueue.reduce((min, item) => Math.min(min, item.priority), Infinity);
  }

  // Iterate through the queue to update deferral counts and elevate priority if needed
  eventQueue.forEach(item => {
    // Only increment deferral count if there's a higher priority item currently in the queue
    // and this item is not already at the highest possible priority (-1)
    if (item.priority > highestPriorityInQueue && item.priority !== -1) {
      item.deferralCount++;
      if (item.deferralCount >= MAX_DEFERRALS) {
        // Elevate priority to be higher than any existing priority, but lower than userRule (0)
        // Let's use -1 for anti-starvation priority.
        item.priority = -1;
        log('warn', `[InputOrchestrator] Elevated priority for ${item.type} due to starvation (${item.deferralCount} deferrals).`);
      }
    }
  });
  // --- End Starvation Prevention Logic ---

  eventQueue.sort((a, b) => a.priority - b.priority);
  const { action, priority, type, originalPriority, deferralCount, insertionTime } = eventQueue.shift();

  try {
    if (
      !globalState ||
      !globalState.global?.windowId ||
      !globalState.global?.display
    ) {
      throw new Error('Missing windowId or display from globalState');
    }

    const windowId = parseInt(globalState.global.windowId, 10);
    const display = globalState.global.display;

    log(
      'info',
      `[InputOrchestrator] Executing action of type: ${type} (Original Prio: ${originalPriority}, Current Prio: ${priority}, Deferrals: ${deferralCount})`,
    );

    switch (action.module) {
      case 'keypress':
        await keypress[action.method](...action.args, display);
        break;
      case 'mouseController':
        await mouseController[action.method](windowId, ...action.args, display);
        break;
      default:
        log('warn', `[InputOrchestrator] Unknown module: ${action.module}`);
    }
  } catch (error) {
    log('error', '[InputOrchestrator] Error executing action:', error);
  } finally {
    // The item is already shifted out, so we don't need to reset its properties.
    // The deferral count and priority are only relevant for items *waiting* in the queue.
    // When an item is executed, its state is effectively "consumed".

    await delay(50);
    isProcessing = false;
    processQueue();
  }
}

parentPort.on('message', (message) => {
  if (message.type === 'state_full_sync' || message.type === 'state_diff') {
    globalState = message.payload;
    return;
  }

  if (message.type === 'inputAction') {
    const { payload } = message;
    const priority = PRIORITY_MAP[payload.type] || PRIORITY_MAP.default;
    eventQueue.push({
      action: payload.action,
      priority: priority,
      originalPriority: priority, // Store original priority
      type: payload.type,
      deferralCount: 0, // Initialize deferral count
      insertionTime: Date.now(), // Timestamp for tie-breaking if needed
    });

    if (!isProcessing) {
      processQueue();
    }
  }
});

log('info', '[InputOrchestrator] Worker started and listening for messages.');