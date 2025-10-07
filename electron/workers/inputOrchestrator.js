import { parentPort } from 'worker_threads';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ info: false, error: true, debug: false });
const PRIORITY_MAP = { userRule: 0, looting: 1, script: 2, targeting: 3, movement: 4, hotkey: 5, default: 10 };
const THROTTLE_MS = 50;
const MAX_DEFERRALS = 4;
const FAST_MOVEMENT_KEYS = new Set(['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c', 'up', 'down', 'left', 'right']);

let globalState = null;
const queues = {
  keyboard: { items: [], processing: false, lastTime: 0 },
  mouse: { items: [], processing: false, lastTime: 0 },
  movement: { items: [], processing: false, lastTime: 0 },
};

function applyStarvationPrevention(items) {
  const highestPriority = Math.min(...items.map(i => i.priority));
  items.forEach(item => {
    if (item.priority > highestPriority && item.priority !== -1 && ++item.deferralCount >= MAX_DEFERRALS) {
      item.priority = -1;
    }
  });
}

async function processQueue(queueType) {
  const q = queues[queueType];
  if (q.processing || !q.items.length || !globalState?.global?.display) return;

  const now = Date.now();
  if (now - q.lastTime < THROTTLE_MS) {
    setTimeout(() => processQueue(queueType), THROTTLE_MS - (now - q.lastTime));
    return;
  }

  q.processing = true;
  if (queueType !== 'movement') {
    applyStarvationPrevention(q.items);
    q.items.sort((a, b) => a.priority - b.priority);
  }
  const item = q.items.shift();

  try {
    const { action, actionId } = item;
    const display = globalState.global.display;

    if (queueType === 'mouse') {
      const windowId = parseInt(globalState.global.windowId, 10);
      await mouseController[action.method](windowId, action.args[0], action.args[1], display);
    } else {
      const method = action.method;
      if (['sendKey', 'keyDown', 'keyUp'].includes(method)) {
        await keypress[method](action.args[0], display, action.args[1]);
      } else if (method === 'typeArray') {
        await keypress.typeArray(action.args[0], display, action.args[1]);
      } else if (method === 'rotate') {
        await keypress.rotate(display, action.args[0]);
      } else {
        await keypress[method](...action.args, display);
      }
    }

    q.lastTime = Date.now();
    if (actionId) parentPort.postMessage({ type: 'inputActionCompleted', payload: { actionId, success: true } });
  } catch (error) {
    log('error', `[${queueType}] Error:`, error);
  } finally {
    q.processing = false;
    if (q.items.length) processQueue(queueType);
  }
}

parentPort.on('message', (msg) => {
  if (msg.type === 'state_full_sync' || msg.type === 'state_diff') {
    globalState = msg.payload;
    Object.keys(queues).forEach(type => !queues[type].processing && processQueue(type));
    return;
  }

  if (msg.type === 'inputAction') {
    const { payload } = msg;
    const item = {
      action: payload.action,
      priority: PRIORITY_MAP[payload.type] || PRIORITY_MAP.default,
      type: payload.type,
      deferralCount: 0,
      actionId: payload.actionId,
    };

    let queueType;
    if (payload.action.module === 'mouseController') {
      queueType = 'mouse';
    } else if (payload.action.module === 'keypress') {
      const isFastKey = ['sendKey', 'keyDown', 'keyUp'].includes(payload.action.method) &&
                        FAST_MOVEMENT_KEYS.has(payload.action.args[0]?.toLowerCase());
      queueType = (isFastKey && payload.type === 'movement') ? 'movement' : 'keyboard';
    }

    if (queueType) {
      queues[queueType].items.push(item);
      processQueue(queueType);
    }
  }
});
