import { keyPress, keyPressMultiple, type as typeText, rotate, getIsTyping } from '../keyboardControll/keyPress.js';
import { wait } from './exposedLuaFunctions.js';
import { setActionPaused, setenabled as setCavebotEnabled, setScriptFeedback } from '../../frontend/redux/slices/cavebotSlice.js';

export const createLuaApi = (context) => {
  const { type, getState, postSystemMessage, logger, id } = context;
  const scriptName = type === 'script' ? `Script ${id}` : 'Cavebot';

  const asyncFunctionNames = ['wait', 'keyPress', 'keyPressMultiple', 'type', 'rotate'];

  const getWindowId = () => {
    const state = getState();
    return state?.global?.windowId;
  };

  const baseApi = {
    // --- NEW FUNCTION START ---
    getDistanceTo: (x, y, z) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!playerPos) {
        logger('warn', '[Lua/getDistanceTo] Could not determine player position from state.');
        return 9999; // Return a large number if player position is unknown
      }

      // If a Z coordinate is provided, check if we are on the same floor.
      // If not, the distance is effectively infinite for pathfinding purposes.
      if (z !== undefined && playerPos.z !== z) {
        return 9999;
      }

      // Calculate Chebyshev distance (the number of steps on a grid)
      const chebyshevDist = Math.max(Math.abs(playerPos.x - x), Math.abs(playerPos.y - y));
      return chebyshevDist;
    },
    // --- NEW FUNCTION END ---

    isLocation: (range = 0) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const { waypointSections, currentSection, wptId } = state.cavebot;
      if (!playerPos || !wptId || !waypointSections || !waypointSections[currentSection]) {
        logger('warn', '[Lua/isLocation] Could not determine player or waypoint position from state.');
        return false;
      }
      const targetWpt = waypointSections[currentSection].waypoints.find((wp) => wp.id === wptId);
      if (!targetWpt) {
        logger('warn', `[Lua/isLocation] Could not find current waypoint with ID: ${wptId}`);
        return false;
      }
      if (playerPos.z !== targetWpt.z) {
        return false;
      }
      const chebyshevDist = Math.max(Math.abs(playerPos.x - targetWpt.x), Math.abs(playerPos.y - targetWpt.y));
      return chebyshevDist <= range;
    },
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
        context.postStoreUpdate('cavebot/setScriptFeedback', { timestamp: Date.now(), message });
      }
    },
    alert: () => {
      logger('debug', `[Lua/${scriptName}] alert() called.`);
      postSystemMessage({ type: 'play_alert' });
    },
    wait: wait,
    keyPress: (key, options = {}) => {
      const windowId = getWindowId();
      if (!windowId) throw new Error('Window ID not available for keyPress.');
      const { speed, ...restOptions } = options;
      return keyPress(String(windowId), key, restOptions);
    },
    keyPressMultiple: (key, options = {}) => {
      const windowId = getWindowId();
      if (!windowId) throw new Error('Window ID not available for keyPressMultiple.');
      const { speed, ...restOptions } = options;
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
    getGameState: () => getState().gameState || {},
    getCavebotState: () => getState().cavebot || {},
    getGlobalState: () => getState().global || {},
  };

  if (type === 'cavebot') {
    const { postStoreUpdate } = context;
    const cavebotApi = {
      pauseActions: (paused) => {
        logger('info', `[Lua/Cavebot] Setting action paused state to: ${paused}`);
        postStoreUpdate('cavebot/setActionPaused', !!paused);
      },
      setCavebotEnabled: (enabled) => {
        logger('info', `[Lua/Cavebot] Setting cavebot enabled state to: ${enabled}`);
        postStoreUpdate('cavebot/setenabled', !!enabled);
      },
    };
    const finalApi = { ...baseApi, ...cavebotApi };
    return { api: finalApi, asyncFunctionNames };
  }

  return { api: baseApi, asyncFunctionNames };
};
