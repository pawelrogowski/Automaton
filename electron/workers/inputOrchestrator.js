import { parentPort } from 'worker_threads';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { createLogger } from '../utils/logger.js';

const log = createLogger({
  info: false,  // Enable to see mouseNoise actions
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
  mouseNoise: 100,  // Very low priority - gets interrupted by everything
  default: 10,
};

// Actions that should pause mouse noise while executing
const PAUSE_MOUSE_NOISE_FOR = new Set([
  'userRule',
  'looting',
  'script',
  'targeting',
  'movement',
  'hotkey',
]);

const DELAY_MAP = {
  userRule: { min: 50, max: 75 },
  looting: { min: 50, max: 150 },
  script: { min: 50, max: 100 },
  targeting: { min: 50, max: 200 },
  movement: { min: 50, max: 100 },
  hotkey: { min: 50, max: 200 },
  mouseNoise: { min: 0, max: 0 },  // No delay for noise movements
  default: { min: 50, max: 100 },
};

const getRandomDelay = (type) => {
  const config = DELAY_MAP[type] || DELAY_MAP.default;
  return Math.floor(Math.random() * (config.max - config.min + 1)) + config.min;
};

const MAX_DEFERRALS = 4;

// Directional keys that bypass the main keyboard queue
const FAST_MOVEMENT_KEYS = new Set([
  'q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c',  // Diagonal + cardinal directions
  'up', 'down', 'left', 'right',  // Arrow keys
]);

// Separate queues for keyboard and mouse to allow parallel execution
let globalState = null;
const keyboardQueue = [];
const mouseQueue = [];
const fastMovementQueue = [];  // NEW: Separate queue for directional keys
let isProcessingKeyboard = false;
let isProcessingMouse = false;
let isProcessingFastMovement = false;  // NEW: Fast movement queue processor flag

// Track previous action types for context switching
let previousKeyboardActionType = null;
let previousMouseActionType = null;

// Mouse noise pause state
let mouseNoisePaused = false;
let mouseNoiseResumeTimeout = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Beta distribution for human-like timing (clusters near mode with long tails)
function getBetaRandom(alpha, beta, min, max) {
  // Simple beta distribution approximation
  const u1 = Math.random();
  const u2 = Math.random();
  const v1 = Math.pow(u1, 1.0 / alpha);
  const v2 = Math.pow(u2, 1.0 / beta);
  const betaValue = v1 / (v1 + v2);
  return Math.floor(min + betaValue * (max - min));
}

// Context-aware cooldown generation
function getContextAwareCooldown(actionType, previousActionType) {
  let base, variance;
  
  // Different ranges per action type
  // IMPORTANT: Movement and hotkeys are time-critical for gameplay!
  switch (actionType) {
    case 'hotkey':
      base = 80;   // Reduced from 250
      variance = 60; // 50-110ms (fast response for healing/buffs)
      break;
    case 'targeting':
      base = 200;  // Reduced from 325
      variance = 250; // 75-325ms (still human-like but faster)
      break;
    case 'movement':
      base = 60;   // Reduced from 125  
      variance = 40; // 40-80ms (fast movement for cavebot reliability)
      break;
    case 'userRule':
    case 'looting':
      base = 100;  // Reduced from 150
      variance = 100; // 50-150ms
      break;
    case 'script':
      base = 100;  // Reduced from 150
      variance = 100; // 50-150ms
      break;
    default:
      base = 75;
      variance = 75; // 37-112ms
  }
  
  // Add small delay on context switches (reduced for gameplay)
  // Skip context switch penalty for movement (needs to be fast)
  if (previousActionType && previousActionType !== actionType && actionType !== 'movement') {
    base += 50; // Reduced from 200ms - just a small "reaction" delay
  }
  
  // Use beta distribution for more natural clustering
  // Alpha=2, Beta=5 creates a right-skewed distribution (most values low, some high)
  return getBetaRandom(2, 5, base - variance / 2, base + variance / 2);
}

// Check if we should add a thinking pause
// Only for non-critical actions (not movement or hotkeys)
function shouldAddThinkingPause(actionType) {
  // Never add thinking pauses for time-critical actions
  if (actionType === 'movement' || actionType === 'hotkey') {
    return false;
  }
  // Reduced from 7% to 3% for faster overall gameplay
  return Math.random() < 0.03;
}

// Generate thinking pause duration
function getThinkingPauseDuration() {
  // Most thinking pauses are short, some are longer
  return getBetaRandom(2, 3, 500, 1500); // 500-1500ms
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

// NEW: Process fast movement queue (QWEASDZXC + arrow keys) - runs independently with minimal delay
async function processFastMovementQueue() {
  if (isProcessingFastMovement || fastMovementQueue.length === 0) {
    isProcessingFastMovement = false;
    return;
  }

  if (!globalState?.global?.windowId || !globalState?.global?.display) {
    isProcessingFastMovement = false;
    return;
  }

  isProcessingFastMovement = true;

  // FIFO - no sorting needed, process in order received
  const item = fastMovementQueue.shift();

  try {
    const display = globalState.global.display;
    const { action, type, actionId } = item;

    log('debug', `[FastMovement] Executing ${type}: ${action.args[0]}`);

    // Execute immediately with minimal overhead
    switch (action.method) {
      case 'sendKey':
      case 'keyDown':
      case 'keyUp':
        await keypress[action.method](action.args[0], display, action.args[1]);
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
    log('error', '[FastMovement] Error executing action:', error);
  } finally {
    // Minimal delay - just enough for the game to register the key
    // No context-aware cooldown, no thinking pauses - pure speed!
    await delay(10);  // 10ms minimum between movement keys
    
    isProcessingFastMovement = false;
    processFastMovementQueue();
  }
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
    // Context-aware cooldown with beta distribution
    const cooldown = getContextAwareCooldown(item.type, previousKeyboardActionType);
    previousKeyboardActionType = item.type;
    await delay(cooldown);
    
    // Thinking pauses only for non-critical actions
    if (shouldAddThinkingPause(item.type)) {
      const thinkingPause = getThinkingPauseDuration();
      await delay(thinkingPause);
    }
    
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

  // Apply starvation prevention
  applyStarvationPrevention(mouseQueue);

  // Sort by priority and get highest priority item
  mouseQueue.sort((a, b) => a.priority - b.priority);
  const item = mouseQueue[0]; // Peek at next item without removing it yet
  
  // CRITICAL FIX: Pause mouse noise BEFORE we start processing if it's a critical action
  // This prevents noise moves from being queued while we're setting up
  if (PAUSE_MOUSE_NOISE_FOR.has(item.type) && !mouseNoisePaused) {
    mouseNoisePaused = true;
    parentPort.postMessage({
      type: 'pauseMouseNoise',
    });
    log('debug', '[InputOrchestrator] Paused mouse noise for critical action');
    
    // Wait a tick to ensure noise worker has processed the pause message
    await delay(10);
  }
  
  // Now remove the item and set processing flag
  mouseQueue.shift();
  isProcessingMouse = true;

  try {
    const windowId = parseInt(globalState.global.windowId, 10);
    const display = globalState.global.display;
    const { action, type, actionId } = item;

    log('info', `[Mouse] Executing ${type}: ${action.method}`);

    // Special handling for xtestMoveCursor (absolute coordinates, no windowId)
    if (action.method === 'xtestMoveCursor') {
      const mouseArgs = action.args || [];
      // Args: [x, y, display]
      await mouseController.xtestMoveCursor(...mouseArgs);
    } else {
      // Standard mouse actions (window-relative)
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
    }

    if (actionId !== undefined) {
      parentPort.postMessage({
        type: 'inputActionCompleted',
        payload: { actionId, success: true },
      });
    }
  } catch (error) {
    log('error', '[Mouse] Error executing action:', error);
  } finally {
    // Context-aware cooldown with beta distribution
    const cooldown = getContextAwareCooldown(item.type, previousMouseActionType);
    previousMouseActionType = item.type;
    await delay(cooldown);
    
    // Thinking pauses only for non-critical actions
    if (shouldAddThinkingPause(item.type)) {
      const thinkingPause = getThinkingPauseDuration();
      await delay(thinkingPause);
    }
    
    // Resume mouse noise after ensuring no more critical actions are queued
    if (PAUSE_MOUSE_NOISE_FOR.has(item.type) && mouseNoisePaused) {
      // Clear any pending resume
      if (mouseNoiseResumeTimeout) {
        clearTimeout(mouseNoiseResumeTimeout);
      }
      // Resume after a delay, but ONLY if no high-priority actions remain
      // Increased to 500ms to ensure mouse movement has fully completed
      mouseNoiseResumeTimeout = setTimeout(() => {
        // Only resume if queue is empty or only has mouseNoise actions
        const hasHighPriorityActions = mouseQueue.some(q => PAUSE_MOUSE_NOISE_FOR.has(q.type));
        if (!hasHighPriorityActions) {
          mouseNoisePaused = false;
          parentPort.postMessage({
            type: 'resumeMouseNoise',
          });
          log('debug', '[InputOrchestrator] Resumed mouse noise');
        } else {
          log('debug', '[InputOrchestrator] High-priority actions still queued, keeping noise paused');
        }
      }, 500);
    }
    
    isProcessingMouse = false;
    processMouseQueue();
  }
}

parentPort.on('message', (message) => {
  if (message.type === 'state_full_sync' || message.type === 'state_diff') {
    globalState = message.payload;
    
    // Try processing all three queues if state is updated
    if (!isProcessingKeyboard && keyboardQueue.length > 0) {
      processKeyboardQueue();
    }
    if (!isProcessingMouse && mouseQueue.length > 0) {
      processMouseQueue();
    }
    if (!isProcessingFastMovement && fastMovementQueue.length > 0) {
      processFastMovementQueue();
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

    // Route to appropriate queue based on module and action type
    if (payload.action.module === 'keypress') {
      // Check if this is a fast movement key AND it's a movement type action
      const isFastMovementKey = 
        (payload.action.method === 'sendKey' || 
         payload.action.method === 'keyDown' || 
         payload.action.method === 'keyUp') &&
        payload.action.args[0] && 
        FAST_MOVEMENT_KEYS.has(payload.action.args[0].toLowerCase());
      
      const isMovementType = payload.type === 'movement';
      
      // Route to fast queue if it's a movement directional key
      if (isFastMovementKey && isMovementType) {
        fastMovementQueue.push(item);
        if (!isProcessingFastMovement) {
          processFastMovementQueue();
        }
        log('debug', `[InputOrchestrator] Routed ${payload.action.args[0]} to fast movement queue`);
      } else {
        // Regular keyboard queue for non-movement keys
        keyboardQueue.push(item);
        if (!isProcessingKeyboard) {
          processKeyboardQueue();
        }
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
