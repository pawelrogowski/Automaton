import { keyPress, keyPressMultiple, type as typeText, rotate, getIsTyping } from '../keyboardControll/keyPress.js';
import { wait } from './exposedLuaFunctions.js';
import { setActionPaused, setenabled as setCavebotEnabled, setActionScriptFeedback } from '../../frontend/redux/slices/cavebotSlice.js';

/**
 * Creates a consolidated table of functions to be exposed to a Lua environment.
 * The API is context-aware and will expose different functions based on the
 * type of worker that is creating it ('script' or 'cavebot').
 *
 * @param {object} context - The context object from the calling worker.
 * @param {'script'|'cavebot'} context.type - The type of worker.
 * @param {function} context.getState - A function that returns the latest full Redux state.
 * @param {function} context.postSystemMessage - A function to post a non-Redux message to the parent (e.g., parentPort.postMessage).
 * @param {function} context.logger - The worker's logger instance.
 * @param {string} [context.id] - The script ID (for 'script' type).
 * @param {function} [context.postStoreUpdate] - Dispatches a Redux action (for 'cavebot' type).
 * @param {function} [context.advanceToNextWaypoint] - Advances cavebot to the next waypoint (for 'cavebot' type).
 * @param {function} [context.goToLabel] - Jumps cavebot to a labeled waypoint (for 'cavebot' type).
 * @returns {object} An object containing the API functions to be exposed to Lua.
 */
export function createLuaApi(context) {
  const { type, getState, postSystemMessage, logger, id } = context;
  const scriptName = type === 'script' ? `Script ${id}` : 'Cavebot';

  // Define which functions are async and need to be awaited in Lua.
  const asyncFunctionNames = ['wait', 'keyPress', 'keyPressMultiple', 'type', 'rotate'];

  const getWindowId = () => {
    const state = getState();
    return state?.global?.windowId;
  };

  // --- Base API (available to all Lua workers) ---
  const baseApi = {
    // Logging and System
    log: (level, ...messages) => {
      const validLevels = ['error', 'warn', 'info', 'debug'];
      const normalizedLevel = String(level).toLowerCase();
      const message = messages.map(String).join(' ');

      if (validLevels.includes(normalizedLevel)) {
        logger(normalizedLevel, `[Lua/${scriptName}] ${message}`);
      } else {
        logger('info', `[Lua/${scriptName}] [${level}] ${message}`);
      }
    },
    print: (...messages) => {
      const message = messages.map(String).join(' ');
      logger('info', `[Lua/${scriptName}] print: ${message}`);
      if (type === 'script') {
        postSystemMessage({ type: 'luaPrint', scriptId: id, message });
      } else {
        // For cavebot, we use a dedicated redux action for feedback.
        context.postStoreUpdate('cavebot/setActionScriptFeedback', { timestamp: Date.now(), message });
      }
    },
    alert: () => {
      logger('debug', `[Lua/${scriptName}] alert() called.`);
      postSystemMessage({ type: 'play_alert' });
    },
    wait: wait,

    // Keyboard & Mouse
    keyPress: (key, options = {}) => {
      const windowId = getWindowId();
      if (!windowId) throw new Error('Window ID not available for keyPress.');
      const { speed, ...restOptions } = options; // Destructure speed, but don't pass it to keyPress
      return keyPress(String(windowId), key, restOptions);
    },
    keyPressMultiple: (key, options = {}) => {
      const windowId = getWindowId();
      if (!windowId) throw new Error('Window ID not available for keyPressMultiple.');
      const { speed, ...restOptions } = options; // Destructure speed, but don't pass it to keyPressMultiple
      return keyPressMultiple(String(windowId), key, restOptions);
    },
    type: (...args) => {
      const windowId = getWindowId();
      if (!windowId) throw new Error('Window ID not available for type.');

      let startAndEndWithEnter = true;
      let texts = [];

      if (typeof args[0] === 'boolean') {
        startAndEndWithEnter = args[0];
        texts = args.slice(1).map(String);
      } else {
        texts = args.map(String);
      }
      return typeText(String(windowId), texts, startAndEndWithEnter);
    },
    rotate: (direction) => {
      const windowId = getWindowId();
      if (!windowId) throw new Error('Window ID not available for rotate.');
      return rotate(String(windowId), direction);
    },
    isTyping: () => getIsTyping(),

    // Read-only State Getters
    getGameState: () => getState().gameState || {},
    getCavebotState: () => getState().cavebot || {},
    getGlobalState: () => getState().global || {},
  };

  // --- Cavebot-specific API ---
  if (type === 'cavebot') {
    const { postStoreUpdate, advanceToNextWaypoint, goToLabel } = context;
    const cavebotApi = {
      pauseActions: (paused) => {
        logger('info', `[Lua/Cavebot] Setting action paused state to: ${paused}`);
        postStoreUpdate('cavebot/setActionPaused', !!paused);
      },
      setCavebotEnabled: (enabled) => {
        logger('info', `[Lua/Cavebot] Setting cavebot enabled state to: ${enabled}`);
        postStoreUpdate('cavebot/setenabled', !!enabled);
      },
      skipWaypoint: () => {
        logger('info', '[Lua/Cavebot] Advancing to next waypoint.');
        advanceToNextWaypoint();
      },
      goToLabel: (label) => {
        logger('info', `[Lua/Cavebot] Attempting to go to label: "${label}"`);
        goToLabel(label);
      },
    };
    const finalApi = { ...baseApi, ...cavebotApi };
    return { api: finalApi, asyncFunctionNames };
  }

  // For 'script' type, return only the base API
  return { api: baseApi, asyncFunctionNames };
}
