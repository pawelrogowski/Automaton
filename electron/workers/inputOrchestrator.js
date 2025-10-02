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

// Separate queues for keyboard and mouse to allow parallel execution
let globalState = null;
const keyboardQueue = [];
const mouseQueue = [];
let isProcessingKeyboard = false;
let isProcessingMouse = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate random cooldown between actions (50-125ms)
function getRandomCooldown() {
  return 50 + Math.floor(Math.random() * 76); // 50-125ms
}

// Starvation prevention helper
function applyStarvationPrevention(queue) {
  if (queue.length === 0) return;
  
  const highestPriority = queue.reduce(
    (min, item) => Math.min(min, item.priority),
    Infinity
  );
  
  queue.forEach((item) => {
    if (item.priority > highestPriority && item.priority !== -1) {
      item.deferralCount++;
      if (item.deferralCount >= MAX_DEFERRALS) {
        item.priority = -1;
        log(
          'warn',
          `[InputOrchestrator] Elevated priority for ${item.type} due to starvation.`
        );
      }
    }
  });
}

// Process keyboard queue (runs independently)
async function processKeyboardQueue() {
  if (isProcessingKeyboard || keyboardQueue.length === 0) {
    isProcessingKeyboard = false;
    return;
  }

  if (!globalState?.global?.windowId || !globalState?.global?.display) {
    isProcessingKeyboard = false;
    return;
  }

  isProcessingKeyboard = true;

  // Apply starvation prevention
  applyStarvationPrevention(keyboardQueue);

  // Sort by priority and get highest priority item
  keyboardQueue.sort((a, b) => a.priority - b.priority);
  const item = keyboardQueue.shift();

  try {
    const display = globalState.global.display;
    const { action, type, actionId } = item;

    log('info', `[Keyboard] Executing ${type}: ${action.method}`);

    switch (action.method) {
      case 'sendKey':
      case 'keyDown':
      case 'keyUp':
        await keypress[action.method](action.args[0], display, action.args[1]);
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

    if (actionId !== undefined) {
      parentPort.postMessage({
        type: 'inputActionCompleted',
        payload: { actionId, success: true },
      });
    }
  } catch (error) {
    log('error', '[Keyboard] Error executing action:', error);
  } finally {
    // Randomized cooldown 50-125ms
    await delay(getRandomCooldown());
    isProcessingKeyboard = false;
    processKeyboardQueue();
  }
}

// Process mouse queue (runs independently)
async function processMouseQueue() {
  if (isProcessingMouse || mouseQueue.length === 0) {
    isProcessingMouse = false;
    return;
  }

  if (!globalState?.global?.windowId || !globalState?.global?.display) {
    isProcessingMouse = false;
    return;
  }

  isProcessingMouse = true;

  // Apply starvation prevention
  applyStarvationPrevention(mouseQueue);

  // Sort by priority and get highest priority item
  mouseQueue.sort((a, b) => a.priority - b.priority);
  const item = mouseQueue.shift();

  try {
    const windowId = parseInt(globalState.global.windowId, 10);
    const display = globalState.global.display;
    const { action, type, actionId } = item;

    log('info', `[Mouse] Executing ${type}: ${action.method}`);

    // Extract mouse parameters
    const mouseArgs = action.args || [];
    const maxDuration = mouseArgs[2];
    const returnPosition = mouseArgs[3];

    // Build parameter list
    const params = [windowId, mouseArgs[0], mouseArgs[1], display];
    if (maxDuration !== undefined) {
      params.push(maxDuration);
    }
    if (returnPosition !== undefined) {
      if (maxDuration === undefined) {
        params.push(300);
      }
      params.push(returnPosition);
    }

    await mouseController[action.method](...params);

    if (actionId !== undefined) {
      parentPort.postMessage({
        type: 'inputActionCompleted',
        payload: { actionId, success: true },
      });
    }
  } catch (error) {
    log('error', '[Mouse] Error executing action:', error);
  } finally {
    // Randomized cooldown 50-125ms
    await delay(getRandomCooldown());
    isProcessingMouse = false;
    processMouseQueue();
  }
}

parentPort.on('message', (message) => {
  if (message.type === 'state_full_sync' || message.type === 'state_diff') {
    globalState = message.payload;
    
    // Try processing both queues if state is updated
    if (!isProcessingKeyboard && keyboardQueue.length > 0) {
      processKeyboardQueue();
    }
    if (!isProcessingMouse && mouseQueue.length > 0) {
      processMouseQueue();
    }
    return;
  }

  if (message.type === 'inputAction') {
    const { payload } = message;
    const priority = PRIORITY_MAP[payload.type] || PRIORITY_MAP.default;
    
    const item = {
      action: payload.action,
      priority: priority,
      originalPriority: priority,
      type: payload.type,
      deferralCount: 0,
      insertionTime: Date.now(),
      actionId: payload.actionId,
    };

    // Route to appropriate queue based on module
    if (payload.action.module === 'keypress') {
      keyboardQueue.push(item);
      if (!isProcessingKeyboard) {
        processKeyboardQueue();
      }
    } else if (payload.action.module === 'mouseController') {
      mouseQueue.push(item);
      if (!isProcessingMouse) {
        processMouseQueue();
      }
    } else {
      log('warn', `[InputOrchestrator] Unknown module: ${payload.action.module}`);
    }
  }
});

log('info', '[InputOrchestrator] Worker started and listening for messages.');
