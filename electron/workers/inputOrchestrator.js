import { parentPort } from 'worker_threads';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ info: false, error: true, debug: false });
const PRIORITY_MAP = {
  userRule: { priority: 0, defer: false },
  targeting: { priority: 1, defer: false },
  looting: { priority: 2, defer: false },
  script: { priority: 3, defer: true },
  movement: { priority: 4, defer: true },
  hotkey: { priority: 5, defer: true },
  default: { priority: 10, defer: true },
};
const THROTTLE_MS = 50;
const MAX_DEFERRALS = 4;

let globalState = null;
// Unified queue for all input types to prevent cross-queue collisions
const queue = { items: [], processing: false, lastTime: 0 };

function applyStarvationPrevention(items) {
  const highestPriority = Math.min(...items.map((i) => i.priority));
  items.forEach((item) => {
    if (
      item.canDefer &&
      item.priority > highestPriority &&
      item.priority !== -1 &&
      ++item.deferralCount >= MAX_DEFERRALS
    ) {
      item.priority = -1;
    }
  });
}

async function processQueue() {
  if (queue.processing || !queue.items.length) return;
  
  // If we don't have state yet, try again soon
  if (!globalState?.global?.display) {
    setTimeout(() => processQueue(), 100);
    return;
  }

  const now = Date.now();
  if (now - queue.lastTime < THROTTLE_MS) {
    setTimeout(() => processQueue(), THROTTLE_MS - (now - queue.lastTime));
    return;
  }

  queue.processing = true;
  applyStarvationPrevention(queue.items);
  queue.items.sort((a, b) => a.priority - b.priority);
  const item = queue.items.shift();

  // Check TTL (time-to-live) - discard action if it expired
  if (item.ttl !== undefined && item.queuedAt !== undefined) {
    const timeInQueue = Date.now() - item.queuedAt;
    if (timeInQueue > item.ttl) {
      log(
        'info',
        `[INPUT] Discarded stale action (TTL expired) | Source: ${item.type} | Time in queue: ${timeInQueue}ms | TTL: ${item.ttl}ms`,
      );
      queue.processing = false;
      if (queue.items.length) processQueue();
      return;
    }
  }

  try {
    const { action, actionId, inputType, type: inputSource } = item;
    const display = globalState.global.display;

    if (inputType === 'mouse') {
      const windowId = parseInt(globalState.global.windowId, 10);
      log(
        'info',
        `[INPUT] Mouse ${action.method} at (${action.args[0]}, ${action.args[1]}) | Source: ${inputSource} | Priority: ${item.priority}`,
      );
      await mouseController[action.method](
        windowId,
        action.args[0],
        action.args[1],
        display,
      );
    } else {
      const method = action.method;
      if (['sendKey', 'keyDown', 'keyUp'].includes(method)) {
        log(
          'info',
          `[INPUT] Keyboard ${method}(${action.args[0]}) | Source: ${inputSource} | Priority: ${item.priority}`,
        );
        await keypress[method](action.args[0], display, action.args[1]);
      } else if (method === 'typeArray') {
        log(
          'info',
          `[INPUT] Keyboard typeArray([${action.args[0].length} chars]) | Source: ${inputSource} | Priority: ${item.priority}`,
        );
        await keypress.typeArray(action.args[0], display, action.args[1]);
      } else if (method === 'rotate') {
        log(
          'info',
          `[INPUT] Keyboard rotate(${action.args[0]}) | Source: ${inputSource} | Priority: ${item.priority}`,
        );
        await keypress.rotate(display, action.args[0]);
      } else {
        log(
          'info',
          `[INPUT] Keyboard ${method}(...) | Source: ${inputSource} | Priority: ${item.priority}`,
        );
        await keypress[method](...action.args, display);
      }
    }

    queue.lastTime = Date.now();
    if (actionId !== undefined)
      parentPort.postMessage({
        type: 'inputActionCompleted',
        payload: { actionId, success: true },
      });
  } catch (error) {
    log('error', `[${inputType || 'input'}] Error:`, error);
    // CRITICAL: Send failure message so promise doesn't hang
    if (item.actionId !== undefined) {
      parentPort.postMessage({
        type: 'inputActionCompleted',
        payload: { actionId: item.actionId, success: false, error: error.message },
      });
    }
  } finally {
    queue.processing = false;
    if (queue.items.length) processQueue();
  }
}

parentPort.on('message', (msg) => {
  if (msg.type === 'state_full_sync' || msg.type === 'state_diff') {
    globalState = msg.payload;
    if (!queue.processing) processQueue();
    return;
  }

  if (msg.type === 'inputAction') {
    const { payload } = msg;

    // Determine input type for error logging
    let inputType = 'keyboard';
    if (payload.action.module === 'mouseController') {
      inputType = 'mouse';
    }

    const priorityConfig = PRIORITY_MAP[payload.type] || PRIORITY_MAP.default;
    const item = {
      action: payload.action,
      priority: priorityConfig.priority,
      canDefer: priorityConfig.defer,
      type: payload.type,
      deferralCount: 0,
      actionId: payload.actionId,
      inputType,
      ttl: payload.ttl, // Optional time-to-live in milliseconds
      queuedAt: Date.now(), // Timestamp when action entered queue
    };

    queue.items.push(item);
    processQueue();
  }
});
