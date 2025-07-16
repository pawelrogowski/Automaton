import { keyPress, keyPressMultiple, type as typeText, rotate, getIsTyping } from '../keyboardControll/keyPress.js';
import { wait } from './exposedLuaFunctions.js';
import { setActionPaused, setenabled as setCavebotEnabled } from '../../frontend/redux/slices/cavebotSlice.js';

/**
 * Creates an object with getters for convenient, direct access to state in Lua.
 * This object will be exposed globally in Lua as `__BOT_STATE__`.
 * @param {function} getState - A function that returns the latest full Redux state.
 * @param {'script'|'cavebot'} type - The type of worker, to determine which variables to expose.
 * @returns {object} The state shortcut object.
 */
const createStateShortcutObject = (getState, type) => {
  const shortcuts = {};

  // --- Game State Getters (Available in ALL script types) ---
  Object.defineProperty(shortcuts, 'hppc', { get: () => getState().gameState?.hppc, enumerable: true });
  Object.defineProperty(shortcuts, 'mppc', { get: () => getState().gameState?.mppc, enumerable: true });
  Object.defineProperty(shortcuts, 'isLoggedIn', { get: () => getState().gameState?.isLoggedIn, enumerable: true });
  Object.defineProperty(shortcuts, 'isChatOff', { get: () => getState().gameState?.isChatOff, enumerable: true });
  Object.defineProperty(shortcuts, 'monsterNum', { get: () => getState().gameState?.monsterNum, enumerable: true });
  Object.defineProperty(shortcuts, 'partyNum', { get: () => getState().gameState?.partyNum, enumerable: true });
  Object.defineProperty(shortcuts, 'isTyping', { get: () => getState().gameState?.isTyping, enumerable: true });
  Object.defineProperty(shortcuts, 'isOnline', { get: () => getState().gameState?.isLoggedIn, enumerable: true }); // Re-added isOnline

  const gameState = getState().gameState;
  if (gameState && gameState.characterStatus) {
    for (const status in gameState.characterStatus) {
      Object.defineProperty(shortcuts, status, { get: () => getState().gameState.characterStatus[status], enumerable: true });
    }
  }

  Object.defineProperty(shortcuts, 'pos', {
    get: () => {
      const pos = getState().gameState?.playerMinimapPosition || {};
      return { x: pos.x, y: pos.y, z: pos.z };
    },
    enumerable: true,
  });

  // --- Cavebot-Specific Getters ---
  const cavebotState = getState().cavebot;
  if (type === 'cavebot' && cavebotState) {
    Object.defineProperty(shortcuts, 'cavebot', { get: () => getState().cavebot?.enabled, enumerable: true });
    Object.defineProperty(shortcuts, 'section', {
      get: () => getState().cavebot?.waypointSections[getState().cavebot?.currentSection]?.name,
      enumerable: true,
    });
    Object.defineProperty(shortcuts, 'wpt', {
      get: () => {
        const currentCavebotState = getState().cavebot;
        const currentWaypoints = currentCavebotState?.waypointSections[currentCavebotState?.currentSection]?.waypoints || [];
        const currentWptIndex = currentWaypoints.findIndex((wp) => wp.id === currentCavebotState?.wptId);
        const currentWpt = currentWptIndex !== -1 ? currentWaypoints[currentWptIndex] : null;
        if (currentWpt) {
          return {
            id: currentWptIndex + 1,
            x: currentWpt.x,
            y: currentWpt.y,
            z: currentWpt.z,
            type: currentWpt.type,
            label: currentWpt.label,
            distance: currentCavebotState.wptDistance,
          };
        }
        return null;
      },
      enumerable: true,
    });
  }

  return shortcuts;
};

/**
 * Creates a consolidated API (functions and state object) to be exposed to a Lua environment.
 * @param {object} context - The context object from the calling worker.
 * @returns {{api: object, asyncFunctionNames: string[], stateObject: object}}
 */
export const createLuaApi = (context) => {
  const { type, getState, postSystemMessage, logger, id } = context;
  const scriptName = type === 'script' ? `Script ${id}` : 'Cavebot';
  const asyncFunctionNames = ['wait', 'keyPress', 'keyPressMultiple', 'type', 'rotate'];
  const getWindowId = () => getState()?.global?.windowId;

  const baseApi = {
    getDistanceTo: (x, y, z) => {
      const playerPos = getState().gameState?.playerMinimapPosition;
      if (!playerPos) return 9999;
      if (z !== undefined && playerPos.z !== z) return 9999;
      return Math.max(Math.abs(playerPos.x - x), Math.abs(playerPos.y - y));
    },
    isLocation: (range = 0) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const { waypointSections, currentSection, wptId } = state.cavebot;
      if (!playerPos || !wptId || !waypointSections || !waypointSections[currentSection]) return false;
      const targetWpt = waypointSections[currentSection].waypoints.find((wp) => wp.id === wptId);
      if (!targetWpt || playerPos.z !== targetWpt.z) return false;
      return Math.max(Math.abs(playerPos.x - targetWpt.x), Math.abs(playerPos.y - targetWpt.y)) <= range;
    },
    log: (level, ...messages) => logger(String(level).toLowerCase(), `[Lua/${scriptName}] ${messages.map(String).join(' ')}`),
    print: (...messages) => {
      const message = messages.map(String).join(' ');
      logger('info', `[Lua/${scriptName}] print: ${message}`);
      if (type === 'cavebot') {
        const scriptId = getState().cavebot.wptId;
        context.postStoreUpdate('cavebot/addWaypointLogEntry', { id: scriptId, message: message });
      } else {
        context.postStoreUpdate('lua/addLogEntry', { id: id, message: message });
      }
    },
    alert: () => postSystemMessage({ type: 'play_alert' }),
    wait: wait,
    keyPress: (key, modifier = null) => keyPress(String(getWindowId()), key, { modifier }),
    keyPressMultiple: (key, count = 1, modifier = null, delayMs = 50) =>
      keyPressMultiple(String(getWindowId()), key, { count, modifier, delayMs }),
    type: (...args) => {
      let [startAndEndWithEnter, ...texts] = typeof args[0] === 'boolean' ? args : [true, ...args];
      return typeText(String(getWindowId()), texts.map(String), startAndEndWithEnter);
    },
    rotate: (direction) => rotate(String(getWindowId()), direction),
    isTyping: () => getIsTyping(),
  };

  let navigationApi = {};
  if (type === 'cavebot') {
    // For CAVEBOT, use the direct function references passed from the worker.
    navigationApi = {
      skipWaypoint: context.advanceToNextWaypoint,
      goToLabel: context.goToLabel,
      goToSection: context.goToSection,
      goToWpt: context.goToWpt,
      pauseActions: (paused) => context.postStoreUpdate('cavebot/setActionPaused', !!paused),
      setCavebotEnabled: (enabled) => context.postStoreUpdate('cavebot/setenabled', !!enabled),
    };
  } else {
    // For SCRIPT, generate functions that dispatch Redux actions.
    const { postStoreUpdate, getState } = context;
    navigationApi = {
      skipWaypoint: () => {
        const state = getState();
        const { waypointSections, currentSection, wptId } = state.cavebot;
        const waypoints = waypointSections[currentSection]?.waypoints || [];
        const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + 1) % waypoints.length;
        if (waypoints[nextIndex]) postStoreUpdate('cavebot/setwptId', waypoints[nextIndex].id);
      },
      goToLabel: (label) => {
        const state = getState();
        const targetWpt = state.cavebot.waypointSections[state.cavebot.currentSection]?.waypoints.find((wp) => wp.label === label);
        if (targetWpt) postStoreUpdate('cavebot/setwptId', targetWpt.id);
      },
      goToSection: (sectionName) => {
        const state = getState();
        const foundEntry = Object.entries(state.cavebot.waypointSections).find(([, s]) => s.name === sectionName);
        if (foundEntry) {
          const [targetSectionId, targetSection] = foundEntry;
          if (targetSection.waypoints?.length > 0) {
            postStoreUpdate('cavebot/setCurrentWaypointSection', targetSectionId);
            postStoreUpdate('cavebot/setwptId', targetSection.waypoints[0].id);
          }
        }
      },
      goToWpt: (index) => {
        const arrayIndex = parseInt(index, 10) - 1;
        if (isNaN(arrayIndex) || arrayIndex < 0) return;
        const state = getState();
        const waypoints = state.cavebot.waypointSections[state.cavebot.currentSection]?.waypoints || [];
        if (arrayIndex < waypoints.length) postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
      },
      pauseActions: (paused) => postStoreUpdate('cavebot/setActionPaused', !!paused),
      setCavebotEnabled: (enabled) => postStoreUpdate('cavebot/setenabled', !!enabled),
    };
  }

  const finalApi = { ...baseApi, ...navigationApi };
  const stateObject = createStateShortcutObject(getState, type);

  return { api: finalApi, asyncFunctionNames, stateObject };
};
