import { parentPort } from 'worker_threads';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { createLogger } from '../utils/logger.js';

const log = createLogger({
  info: false,
  error: true,
  debug: false,
});

const PRIORITY_MAP = {
  userRule: 0,
  looting: 1,
  script: 2,
  targeting: 3,
  movement: 4,
  hotkey: 5,
  default: 10,
};

const DELAY_MAP = {
  userRule: { min: 50, max: 75 },
  looting: { min: 50, max: 150 },
  script: { min: 50, max: 100 },
  targeting: { min: 50, max: 200 },
  movement: { min: 50, max: 100 },
  hotkey: { min: 50, max: 200 },
  default: { min: 50, max: 100 },
};

const getRandomDelay = (type) => {
  const config = DELAY_MAP[type] || DELAY_MAP.default;
  return Math.floor(Math.random() * (config.max - config.min + 1)) + config.min;
};

const MAX_DEFERRALS = 4;

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

  // NEW: Defer processing if globalState is not yet available
  if (
    !globalState ||
    !globalState.global?.windowId ||
    !globalState.global?.display
  ) {
    log(
      'warn',
      '[InputOrchestrator] Deferring action processing: Missing windowId or display from globalState.',
    );
    isProcessing = false; // Allow other messages to be processed
    return; // Exit and wait for state update
  }

  isProcessing = true;

  // --- Starvation Prevention Logic ---
  // First, identify the highest priority currently in the queue
  let highestPriorityInQueue = Infinity;
  if (eventQueue.length > 0) {
    highestPriorityInQueue = eventQueue.reduce(
      (min, item) => Math.min(min, item.priority),
      Infinity,
    );
  }

  // Iterate through the queue to update deferral counts and elevate priority if needed
  eventQueue.forEach((item) => {
    // Only increment deferral count if there's a higher priority item currently in the queue
    // and this item is not already at the highest possible priority (-1)
    if (item.priority > highestPriorityInQueue && item.priority !== -1) {
      item.deferralCount++;
      if (item.deferralCount >= MAX_DEFERRALS) {
        // Elevate priority to be higher than any existing priority, but lower than userRule (0)
        // Let's use -1 for anti-starvation priority.
        item.priority = -1;
        log(
          'warn',
          `[InputOrchestrator] Elevated priority for ${item.type} due to starvation (${item.deferralCount} deferrals).`,
        );
      }
    }
  });
  // --- End Starvation Prevention Logic ---

  eventQueue.sort((a, b) => a.priority - b.priority);
  const {
    action,
    priority,
    type,
    originalPriority,
    deferralCount,
    insertionTime,
    actionId, // Extract actionId
  } = eventQueue.shift();

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
        switch (action.method) {
          case 'sendKey':
          case 'keyDown':
          case 'keyUp':
            await keypress[action.method](
              action.args[0],
              display,
              action.args[1],
            );
            break;
          case 'typeArray':
            await keypress.typeArray(action.args[0], display, action.args[1]);
            break;
          case 'rotate':
            await keypress.rotate(display, action.args[0]);
            break;
          default:
            await keypress[action.method](...action.args, display);
            break;
        }
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
    // NEW: Send completion message if an actionId was provided
    if (actionId !== undefined) {
      parentPort.postMessage({
        type: 'inputActionCompleted',
        payload: { actionId, success: true },
      });
    }
    const delayMs = getRandomDelay(type);
    await delay(delayMs);
    isProcessing = false;
    processQueue();
  }
}

parentPort.on('message', (message) => {
  if (message.type === 'state_full_sync' || message.type === 'state_diff') {
    globalState = message.payload;
    // NEW: If state is updated, try processing the queue again
    if (!isProcessing && eventQueue.length > 0) {
      processQueue();
    }
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
      actionId: payload.actionId, // Store actionId
    });

    if (!isProcessing) {
      processQueue();
    }
  }
});

log('info', '[InputOrchestrator] Worker started and listening for messages.');
