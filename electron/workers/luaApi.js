import { parentPort } from 'worker_threads';
import { keyPress, keyPressType, keyPressRotate } from '../keyboardControll/keyPress.js';
import { wait } from './exposedLuaFunctions.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger();

export function createLuaApi(scriptId, currentState) {
  return {
    print: (...messages) => {
      const message = messages.map(String).join(' ');
      log('info', `[Lua Script Worker ${scriptId}] Lua print: ${message}`);
      parentPort.postMessage({ type: 'luaPrint', scriptId: scriptId, message });
    },

    keyPress: (key, rule) => {
      const windowId = currentState?.global?.windowId;
      log('debug', `[Lua Script Worker ${scriptId}] keyPress called with key: ${key}, rule: ${rule}, windowId: ${windowId}`);
      if (windowId === undefined || windowId === null) {
        log('error', `[Lua Script Worker ${scriptId}] keyPress wrapper called without windowId in state.`);
        throw new Error('Window ID not available for keyPress.');
      }
      keyPress(String(windowId), key, rule);
    },

    type: (str, delayMs, finishWithEnter) => {
      const windowId = currentState?.global?.windowId;
      log(
        'debug',
        `[Lua Script Worker ${scriptId}] type called with str: "${str}", delayMs: ${delayMs}, finishWithEnter: ${finishWithEnter}, windowId: ${windowId}`,
      );
      if (windowId === undefined || windowId === null) {
        log('error', `[Lua Script Worker ${scriptId}] type wrapper called without windowId in state.`);
        throw new Error('Window ID not available for type.');
      }
      keyPressType(String(windowId), str, delayMs, finishWithEnter);
    },

    rotate: () => {
      const windowId = currentState?.global?.windowId;
      log('debug', `[Lua Script Worker ${scriptId}] rotate called with windowId: ${windowId}`);
      if (windowId === undefined || windowId === null) {
        log('error', `[Lua Script Worker ${scriptId}] rotate wrapper called without windowId in state.`);
        throw new Error('Window ID not available for rotate.');
      }
      keyPressRotate(String(windowId));
    },

    wait: wait,

    alert: () => {
      log('debug', `[Lua Script Worker ${scriptId}] alert called. Sending play_alert message.`);
      parentPort.postMessage({ type: 'play_alert' });
    },
  };
}
