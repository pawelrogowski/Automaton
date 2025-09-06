import {
  keyPress,
  keyPressMultiple,
  typeArray,
  rotate,
  getIsTyping,
} from '../keyboardControll/keyPress.js';
import mouseController from 'mouse-controller';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import { wait } from './exposedLuaFunctions.js';

const getNested = (obj, path) => {
  if (path === null || path === undefined) return obj;
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

/**
 * Creates an object with getters for convenient, direct access to state in Lua.
 * This object will be exposed globally in Lua as `__BOT_STATE__`.
 * @param {function} getState - A function that returns the latest full Redux state.
 * @param {'script'|'cavebot'} type - The type of worker, to determine which variables to expose.
 * @returns {object} The state shortcut object.
 */
export const createStateShortcutObject = (getState, type) => {
  const shortcuts = {};

  Object.defineProperty(shortcuts, 'hppc', {
    get: () => getState().gameState?.hppc,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'mppc', {
    get: () => getState().gameState?.mppc,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'characterName', {
    get: () => getState().gameState?.characterName,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'lastCharacterName', {
    get: () => getState().gameState?.lastCharacterName,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'lastLabel', {
    get: () => getState().cavebot?.lastLabel,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'cap', {
    get: () => getState().uiValues?.skillsWidget?.capacity || 0,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'stamina', {
    get: () => getState().uiValues?.skillsWidget?.stamina || 0,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'level', {
    get: () => getState().uiValues?.skillsWidget?.level,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'exp', {
    get: () => getState().uiValues?.skillsWidget?.experience,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'soul', {
    get: () => getState().uiValues?.skillsWidget?.soulPoints,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'speed', {
    get: () => getState().uiValues?.skillsWidget?.speed,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'xpRate', {
    get: () => getState().uiValues?.skillsWidget?.xpGainRate,
    enumerable: true,
  });

  Object.defineProperty(shortcuts, 'food', {
    get: () => getState().uiValues?.skillsWidget?.food,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'isChatOff', {
    get: () => getState().gameState?.isChatOff,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'monsterNum', {
    get: () =>
      getState().regionCoordinates.regions.battleList?.children?.entries?.list
        ?.length,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'battleList', {
    get: () => ({
      entries:
        getState().regionCoordinates.regions.battleList?.children?.entries
          ?.list || [],
    }),
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'partyNum', {
    get: () => getState().gameState?.partyNum,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'isTyping', {
    get: () => getState().gameState?.isTyping,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'isOnline', {
    get: () => !!getState().regionCoordinates?.regions?.onlineMarker,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'stowText', {
    get: () => getState().regionCoordinates?.regions?.stowText,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'stashIcon', {
    get: () => getState().regionCoordinates?.regions?.stashIcon,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'pk', {
    get: () =>
      getState().regionCoordinates?.regions?.playerList?.children?.whiteSkull,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'activeTab', {
    get: () => getState().uiValues?.chatboxTabs?.activeTab || 'unknown',
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'actionItems', {
    get: () => {
      const hotkeyBarChildren =
        getState().regionCoordinates?.regions?.hotkeyBar?.children || {};
      return new Proxy(
        {},
        {
          get(target, prop) {
            const child = hotkeyBarChildren[prop];
            return !!(child && child.x !== undefined && child.y !== undefined);
          },
          has(target, prop) {
            return true;
          },
          ownKeys() {
            return Object.keys(hotkeyBarChildren);
          },
        },
      );
    },
    enumerable: true,
  });

  const charStatus = getState().gameState?.characterStatus;
  if (charStatus) {
    for (const status in charStatus) {
      Object.defineProperty(shortcuts, status, {
        get: () => getState().gameState.characterStatus[status],
        enumerable: true,
      });
    }
  }

  Object.defineProperty(shortcuts, 'pos', {
    get: () => {
      const pos = getState().gameState?.playerMinimapPosition || {};
      return { x: pos.x, y: pos.y, z: pos.z };
    },
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'wpt', {
    get: () => {
      const cavebotState = getState().cavebot;
      const currentWaypoints =
        cavebotState?.waypointSections[cavebotState?.currentSection]
          ?.waypoints || [];
      const currentWptIndex = currentWaypoints.findIndex(
        (wp) => wp.id === cavebotState?.wptId,
      );
      const currentWpt =
        currentWptIndex !== -1 ? currentWaypoints[currentWptIndex] : null;
      if (currentWpt) {
        return {
          id: currentWptIndex + 1,
          x: currentWpt.x,
          y: currentWpt.y,
          z: currentWpt.z,
          type: currentWpt.type,
          label: currentWpt.label,
          distance: cavebotState.wptDistance,
        };
      }
      return null;
    },
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'cavebot', {
    get: () => getState().cavebot?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'section', {
    get: () =>
      getState().cavebot?.waypointSections[getState().cavebot?.currentSection]
        ?.name,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'healing', {
    get: () => getState().rules?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'targeting', {
    get: () => getState().targeting?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'scripts', {
    get: () => getState().lua?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'players', {
    get: () => getState().uiValues?.players || [],
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'standTime', {
    get: () => {
      const lastMoveTime = getState().gameState?.lastMoveTime;
      if (lastMoveTime) {
        return Date.now() - lastMoveTime;
      }
      return 0;
    },
    enumerable: true,
  });
  return shortcuts;
};

/**
 * Creates a consolidated API (functions and state object) to be exposed to a Lua environment.
 * @param {object} context - The context object from the calling worker.
 * @returns {{api: object, asyncFunctionNames: string[], stateObject: object, sharedGlobalsProxy: object}}
 */
export const createLuaApi = async (context) => {
  const { onAsyncStart, onAsyncEnd, sharedLuaGlobals, lua } = context;
  const { type, getState, postSystemMessage, logger, id } = context;
  const scriptName = type === 'script' ? `Script ${id}` : 'Cavebot';
  const asyncFunctionNames = [
    'wait',
    'keyPress',
    'keyPressMultiple',
    'typeText',
    'typeSequence',
    'rotate',
    'clickTile',
    'clickAbsolute',
    'mapClick',
    'drag',
    'dragAbsolute',
    'focusTab',
    'login',
    'waitFor',
  ];
  const getWindowId = () => getState()?.global?.windowId;
  const getDisplay = () => getState()?.global?.display || ':0';

  const waitFor = async (
    path,
    comparison = 'exists',
    value = null,
    timeout = 5000,
    interval = 200,
  ) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      await context.refreshLuaGlobalState();
      const state = getState();
      const actualValue = getNested(state, path);

      let conditionMet = false;
      switch (comparison) {
        case 'equals':
          conditionMet = actualValue === value;
          break;
        case 'notEquals':
          conditionMet = actualValue !== value;
          break;
        case 'greaterThan':
          conditionMet = actualValue > value;
          break;
        case 'lessThan':
          conditionMet = actualValue < value;
          break;
        case 'exists':
          conditionMet = actualValue !== undefined && actualValue !== null;
          break;
        case 'notExists':
          conditionMet = actualValue === undefined || actualValue === null;
          break;
        default:
          logger(
            'warn',
            `[Lua/${scriptName}] waitFor: unknown comparison '${comparison}'`,
          );
          return false;
      }

      if (conditionMet) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    logger('info', `[Lua/${scriptName}] waitFor timed out for path: '${path}'`);
    return false;
  };

  const closeAllModals = async (timeout = 10000) => {
    const modalsToClose = [
      { name: 'pleaseWaitModal' },
      { name: 'ipChangedModal' },
      { name: 'wrongPasswordModal' },
      { name: 'connectionLostModal' },
      { name: 'connectionFailedModal' },
      { name: 'warningModal' },
      { name: 'notLoggedInAnymoreModal' },
    ];
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      await context.refreshLuaGlobalState();
      const state = getState();
      const regions = state.regionCoordinates?.regions;
      if (!regions) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      let foundModal = false;
      for (const modalInfo of modalsToClose) {
        const modal = regions[modalInfo.name];
        const button =
          modal?.children?.abort || modal?.children?.close || modal?.children?.ok;

        if (button?.x && button?.y) {
          logger('info', `[Lua/${scriptName}] Closing '${modalInfo.name}'`);
          if (
            modalInfo.name === 'ipChangedModal' ||
            modalInfo.name === 'notLoggedInAnymoreModal'
          ) {
            await keyPress(getDisplay(), 'Escape');
            await wait(500);
            await keyPress(getDisplay(), 'Escape');
            await wait(500);
          } else {
            mouseController.leftClick(
              parseInt(String(getWindowId())),
              button.x,
              button.y,
              getDisplay(),
            );
            await wait(500);
          }
          foundModal = true;
          break; // Restart the scan for modals
        }
      }

      if (!foundModal) {
        return true; // No modals found, we are done.
      }
    }
    logger('warn', `[Lua/${scriptName}] closeAllModals timed out.`);
    return false; // Timed out
  };

  const baseApi = {
    getDistanceTo: (x, y, z) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      if (!playerPos) return 9999;
      if (z !== undefined && playerPos.z !== z) return 9999;
      return Math.max(Math.abs(playerPos.x - x), Math.abs(playerPos.y - y));
    },
    isLocation: (range = 0) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const { waypointSections, currentSection, wptId } = state.cavebot || {};

      if (
        !playerPos ||
        wptId == null ||
        !waypointSections ||
        !waypointSections[currentSection]
      ) {
        console.log('isLocation failed, missing data.', {
          playerPos,
          wptId,
          currentSection,
        });
        return false;
      }

      const targetWpt = waypointSections[currentSection].waypoints.find(
        (wp) => wp.id === wptId,
      );
      if (!targetWpt) {
        console.log('isLocation: target waypoint not found for wptId', wptId);
        return false;
      }
      if (playerPos.z !== targetWpt.z) {
        console.log('isLocation: z mismatch', playerPos.z, targetWpt.z);
        return false;
      }

      const px = Number(playerPos.x);
      const py = Number(playerPos.y);
      const tx = Number(targetWpt.x);
      const ty = Number(targetWpt.y);

      if ([px, py, tx, ty].some(Number.isNaN)) {
        console.log('isLocation: numeric conversion failed', {
          px,
          py,
          tx,
          ty,
        });
        return false;
      }

      if (px === tx && py === ty) {
        return true; // exact match fast-path
      }

      const dist = Math.max(Math.abs(px - tx), Math.abs(py - ty));
      return dist <= range;
    },
    log: (level, ...messages) =>
      logger(
        String(level).toLowerCase(),
        `[Lua/${scriptName}] ${messages.map(String).join(' ')}`,
      ),
    print: (...messages) => {
      const message = messages.map(String).join(' ');
      logger('info', `[Lua/${scriptName}] print: ${message}`);
      if (type === 'cavebot') {
        const state = getState();
        const scriptId = state.cavebot.wptId;
        context.postStoreUpdate('cavebot/addWaypointLogEntry', {
          id: scriptId,
          message: message,
        });
      } else {
        context.postStoreUpdate('lua/addLogEntry', {
          id: id,
          message: message,
        });
      }
    },
    alert: () => postSystemMessage({ type: 'play_alert' }),
    wait: (min_ms, max_ms) =>
      wait(min_ms, max_ms, context.refreshLuaGlobalState),
    keyPress: (key, modifier = null) =>
      keyPress(getDisplay(), key, { modifier }),
    keyPressMultiple: (key, count = 1, modifier = null, delayMs = 50) =>
      keyPressMultiple(getDisplay(), key, {
        count,
        modifier,
        delayMs,
      }),
    typeText: async (...args) => {
      const display = getDisplay();
      if (args.length === 0) {
        logger(
          'warn',
          `[Lua/${scriptName}] 'type' function called with no arguments.`,
        );
        return false;
      }

      let texts = [];
      let startAndEndWithEnter = true;

      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'boolean') {
        startAndEndWithEnter = lastArg;
        texts = args.slice(0, -1);
      } else {
        texts = args;
      }

      const stringArgs = texts.map(String);

      if (stringArgs.length === 0) {
        logger(
          'warn',
          `[Lua/${scriptName}] 'type' function called without any text to type.`,
        );
        return false;
      }

      try {
        await typeArray(display, stringArgs, startAndEndWithEnter);
        return true;
      } catch (error) {
        logger(
          'error',
          `[Lua/${scriptName}] Error in 'type' function: ${error.message}`,
        );
        throw error;
      }
    },
    typeSequence: async (texts, delayBetween = 100) => {
      for (const text of texts) {
        await typeArray(getDisplay(), [text], true);
        if (delayBetween > 0) {
          await wait(delayBetween);
        }
      }
    },
    rotate: (direction) => rotate(getDisplay(), direction),
    isTyping: () => getIsTyping(),
    clickTile: async (button, x, y, position = 'center') => {
      const windowId = String(getWindowId());
      const state = getState();
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;
      if (!gameWorld || !tileSize || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform game click: missing region data or player position`,
        );
        return false;
      }
      const clickCoords = getAbsoluteGameWorldClickCoordinates(
        x,
        y,
        playerPos,
        gameWorld,
        tileSize,
        position,
      );
      if (!clickCoords) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform game click: invalid coordinates`,
        );
        return false;
      }

      if (button === 'right') {
        mouseController.rightClick(
          parseInt(windowId),
          clickCoords.x,
          clickCoords.y,
          getDisplay(),
        );
      } else {
        mouseController.leftClick(
          parseInt(windowId),
          clickCoords.x,
          clickCoords.y,
          getDisplay(),
        );
      }
      await wait(100);
      return true;
    },
    clickAbsolute: async (button, x, y) => {
      const windowId = String(getWindowId());
      if (button === 'right') {
        mouseController.rightClick(parseInt(windowId), x, y, getDisplay());
      } else {
        mouseController.leftClick(parseInt(windowId), x, y, getDisplay());
      }
      await wait(100);
      return true;
    },
    mapClick: async (x, y, position = 'center') => {
      const windowId = String(getWindowId());
      const state = getState();
      const minimapRegionDef = state.regionCoordinates?.regions?.minimapFull;
      const playerPos = state.gameState?.playerMinimapPosition;
      if (!minimapRegionDef || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform minimap click: missing region data or player position`,
        );
        return false;
      }
      const clickCoords = getAbsoluteClickCoordinates(
        x,
        y,
        playerPos,
        minimapRegionDef,
      );
      if (!clickCoords) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform minimap click: invalid coordinates`,
        );
        return false;
      }
      mouseController.leftClick(
        parseInt(windowId),
        clickCoords.x,
        clickCoords.y,
        getDisplay(),
      );
      await wait(100);
      return true;
    },
    drag: async (startX, startY, endX, endY, button = 'left') => {
      const windowId = String(getWindowId());
      const state = getState();
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;
      if (!gameWorld || !tileSize || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform drag: missing region data or player position`,
        );
        return false;
      }
      const startCoords = getAbsoluteGameWorldClickCoordinates(
        startX,
        startY,
        playerPos,
        gameWorld,
        tileSize,
        'bottomRight',
      );
      const endCoords = getAbsoluteGameWorldClickCoordinates(
        endX,
        endY,
        playerPos,
        gameWorld,
        tileSize,
        'bottomRight',
      );
      if (!startCoords || !endCoords) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform drag: invalid coordinates`,
        );
        return false;
      }
      mouseController.mouseMove(
        parseInt(windowId),
        startCoords.x,
        startCoords.y,
        getDisplay(),
      );
      await wait(50);
      if (button === 'right') {
        mouseController.rightMouseDown(
          parseInt(windowId),
          startCoords.x,
          startCoords.y,
        );
      } else {
        mouseController.mouseDown(
          parseInt(windowId),
          startCoords.x,
          startCoords.y,
        );
      }
      await wait(100);
      mouseController.mouseMove(
        parseInt(windowId),
        endCoords.x,
        endCoords.y,
        getDisplay(),
      );
      await wait(100);
      if (button === 'right') {
        mouseController.rightMouseUp(
          parseInt(windowId),
          endCoords.x,
          endCoords.y,
        );
      } else {
        mouseController.mouseUp(
          parseInt(windowId),
          endCoords.x,
          endCoords.y,
          getDisplay(),
        );
      }
      await wait(100);
      return true;
    },
    dragAbsolute: async (startX, startY, endX, endY, button = 'left') => {
      const windowId = String(getWindowId());
      mouseController.mouseMove(
        parseInt(windowId),
        startX,
        startY,
        getDisplay(),
      );
      await wait(50);
      if (button === 'right') {
        mouseController.rightMouseDown(
          parseInt(windowId),
          startX,
          startY,
          getDisplay(),
        );
      } else {
        mouseController.mouseDown(
          parseInt(windowId),
          startX,
          startY,
          getDisplay(),
        );
      }
      await wait(100);
      mouseController.mouseMove(parseInt(windowId), endX, endY, getDisplay());
      await wait(100);
      if (button === 'right') {
        mouseController.rightMouseUp(
          parseInt(windowId),
          endX,
          endY,
          getDisplay(),
        );
      } else {
        mouseController.mouseUp(parseInt(windowId), endX, endY, getDisplay());
      }
      await wait(100);
      return true;
    },
    tileToCoordinate: (tileX, tileY, position = 'bottomRight') => {
      const state = getState();
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;
      if (!gameWorld || !tileSize || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot convert tile to coordinate: missing region data`,
        );
        return null;
      }
      const coords = getAbsoluteGameWorldClickCoordinates(
        tileX,
        tileY,
        playerPos,
        gameWorld,
        tileSize,
        position,
      );
      return coords ? { x: coords.x, y: coords.y } : null;
    },
    coordinateToTile: (screenX, screenY) => {
      const state = getState();
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;
      if (!gameWorld || !tileSize || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot convert coordinate to tile: missing region data`,
        );
        return null;
      }
      const relX = screenX - gameWorld.x;
      const relY = screenY - gameWorld.y;
      const tileX =
        Math.floor(relX / tileSize.width) +
        playerPos.x -
        Math.floor(gameWorld.width / tileSize.width / 2);
      const tileY =
        Math.floor(relY / tileSize.height) +
        playerPos.y -
        Math.floor(gameWorld.height / tileSize.height / 2);
      return { x: tileX, y: tileY };
    },
    focusTab: async (tabName) => {
      const state = getState();
      const tabs = state.uiValues?.chatboxTabs?.tabs;
      if (!tabs || !tabName) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot focus tab: missing tab data or tab name`,
        );
        return false;
      }
      const tab = tabs[tabName];
      if (!tab || !tab.tabPosition) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot focus tab: tab "${tabName}" not found or missing position`,
        );
        return false;
      }
      const windowId = String(getWindowId());
      const { x, y } = tab.tabPosition;
      mouseController.leftClick(parseInt(windowId), x, y, getDisplay());
      await wait(100);
      return true;
    },
    setTargeting: (enabled) => {
      context.postStoreUpdate('targeting/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Targeting ${enabled ? 'enabled' : 'disabled'}`,
      );
    },
    setHealing: (enabled) => {
      context.postStoreUpdate('rules/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Healing (rules) ${
          enabled ? 'enabled' : 'disabled'
        }`,
      );
    },
    setCavebot: (enabled) => {
      context.postStoreUpdate('cavebot/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Cavebot ${enabled ? 'enabled' : 'disabled'}`,
      );
    },
    isCreatureOnTile: (x, y, z) => {
      const creatures = getCreatures(getState);
      return creatures.some(
        (creature) =>
          creature.x === x && creature.y === y && creature.z === z,
      );
    },
    setScripts: (enabled) => {
      context.postStoreUpdate('lua/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Scripts ${enabled ? 'enabled' : 'disabled'}`,
      );
    },
    pauseWalking: (ms) => {
      const duration = parseInt(ms, 10);
      if (!isNaN(duration)) {
        postSystemMessage({ type: 'lua-pause-walking', payload: duration });
        logger('info', `[Lua/${scriptName}] Pausing walking for ${duration}ms`);
      }
    },
    pauseTargeting: (ms) => {
      const duration = parseInt(ms, 10);
      if (!isNaN(duration)) {
        postSystemMessage({ type: 'lua-pause-targeting', payload: duration });
        logger('info', `[Lua/${scriptName}] Pausing targeting for ${duration}ms`);
      }
    },
    waitFor,
    login: async (email, password, character) => {
      const windowId = String(getWindowId());
      const display = getDisplay();

      if (await waitFor('regionCoordinates.regions.onlineMarker', 'exists', null, 100)) {
        logger(
          'info',
          `[Lua/${scriptName}] Player is already online, skipping login.`,
        );
        return false;
      }

      await closeAllModals(15000);

      const isAtCharSelect = await waitFor(
        'regionCoordinates.regions.selectCharacterModal',
        'exists',
        null,
        100,
      );

      if (isAtCharSelect) {
        logger(
          'info',
          `[Lua/${scriptName}] Already at character selection, skipping login form.`,
        );
      } else {
        logger(
          'info',
          `[Lua/${scriptName}] Starting login process for character: ${character}`,
        );

        const loginModalExists = await waitFor(
          'regionCoordinates.regions.loginModal',
          'exists',
          null,
          1000,
        );
        if (!loginModalExists) {
          logger('warn', `[Lua/${scriptName}] loginModal not found`);
          return false;
        }

        const state = getState(); // We know it exists now.
        const loginModal = state.regionCoordinates.regions.loginModal;

        await keyPress(display, 'Escape');
        await wait(100);
        await keyPress(display, 'Escape');
        await wait(100);

        const emailInput = loginModal.children?.emailInput;
        if (!emailInput) {
          logger('warn', `[Lua/${scriptName}] emailInput not found`);
          return false;
        }
        mouseController.leftClick(
          parseInt(windowId),
          emailInput.x,
          emailInput.y,
          display,
        );
        await wait(50);
        await typeArray(display, [email], false);
        await wait(100);

        const passwordInput = loginModal.children?.passwordInput;
        if (!passwordInput) {
          logger('warn', `[Lua/${scriptName}] passwordInput not found`);
          return false;
        }
        mouseController.leftClick(
          parseInt(windowId),
          passwordInput.x,
          passwordInput.y,
          display,
        );
        await wait(50);
        await typeArray(display, [password], false);
        await wait(100);
        await keyPress(display, 'Enter');
      }

      const charSelectAppeared = await waitFor(
        'regionCoordinates.regions.selectCharacterModal',
        'exists',
        null,
        10000,
      );

      if (!charSelectAppeared) {
        logger(
          'warn',
          `[Lua/${scriptName}] selectCharacterModal not found after login attempt.`,
        );
        // Try to recover by closing any new modals
        await closeAllModals(5000);
        return false;
      }

      // Wait for character data to be parsed by OCR
      const charDataExists = await waitFor(
        'uiValues.selectCharacterModal.characters',
        'exists',
        null,
        5000,
      );
      if (!charDataExists) {
        logger(
          'warn',
          `[Lua/${scriptName}] No character data available for selection after 5s.`,
        );
        return false;
      }

      const characters = getState().uiValues.selectCharacterModal.characters;
      const characterNames = Object.keys(characters);
      const targetCharacterLower = character.toLowerCase();
      const targetCharacterFound = characterNames.find((name) =>
        name.toLowerCase().includes(targetCharacterLower),
      );

      if (!targetCharacterFound) {
        logger(
          'warn',
          `[Lua/${scriptName}] Target character '${character}' not found in list: [${characterNames.join(
            ', ',
          )}]`,
        );
        return false;
      }

      const characterItem = characters[targetCharacterFound];
      if (!characterItem || !characterItem.position) {
        logger(
          'warn',
          `[Lua/${scriptName}] Could not find coordinates for character '${targetCharacterFound}'`,
        );
        return false;
      }

      mouseController.leftClick(
        parseInt(windowId),
        characterItem.position.x,
        characterItem.position.y,
        display,
      );
      await wait(100);
      await keyPress(display, 'Enter');

      const isOnline = await waitFor(
        'regionCoordinates.regions.onlineMarker',
        'exists',
        null,
        10000,
      );

      if (isOnline) {
        logger(
          'info',
          `[Lua/${scriptName}] Login successful, player is online.`,
        );
        return true;
      } else {
        logger(
          'warn',
          `[Lua/${scriptName}] Login timeout, player did not come online.`,
        );
        return false;
      }
    },
  };
  let navigationApi = {};
  if (type === 'cavebot') {
    navigationApi = {
      skipWaypoint: context.advanceToNextWaypoint,
      goToLabel: context.goToLabel,
      goToSection: context.goToSection,
      goToWpt: context.goToWpt,
      pauseActions: (paused) =>
        context.postStoreUpdate('cavebot/setActionPaused', !!paused),
      setCavebotEnabled: (enabled) =>
        context.postStoreUpdate('cavebot/setenabled', !!enabled),
    };
  } else {
    navigationApi = {
      skipWaypoint: () => {
        const state = getState();
        const { waypointSections, currentSection, wptId } = state.cavebot;
        const waypoints = waypointSections[currentSection]?.waypoints || [];
        const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + 1) % waypoints.length;
        if (waypoints[nextIndex])
          context.postStoreUpdate('cavebot/setwptId', waypoints[nextIndex].id);
      },
      goToLabel: (label) => {
        const state = getState();
        const { waypointSections, currentSection } = state.cavebot;
        const targetWpt = waypointSections[currentSection]?.waypoints.find(
          (wp) => wp.label === label,
        );
        if (targetWpt)
          context.postStoreUpdate('cavebot/setwptId', targetWpt.id);
      },
      goToSection: (sectionName) => {
        const state = getState();
        const { waypointSections } = state.cavebot;
        const foundEntry = Object.entries(waypointSections).find(
          ([, s]) => s.name === sectionName,
        );
        if (foundEntry) {
          const [targetSectionId, targetSection] = foundEntry;
          if (targetSection.waypoints?.length > 0) {
            context.postStoreUpdate(
              'cavebot/setCurrentWaypointSection',
              targetSectionId,
            );
            context.postStoreUpdate(
              'cavebot/setwptId',
              targetSection.waypoints[0].id,
            );
          }
        }
      },
      goToWpt: (index) => {
        const arrayIndex = parseInt(index, 10) - 1;
        if (isNaN(arrayIndex) || arrayIndex < 0) return;
        const state = getState();
        const { waypointSections, currentSection } = state.cavebot;
        const waypoints = waypointSections[currentSection]?.waypoints || [];
        if (arrayIndex < waypoints.length)
          context.postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
      },
      pauseActions: (paused) =>
        context.postStoreUpdate('cavebot/setActionPaused', !!paused),
    };
  }
  const api = { ...baseApi, ...navigationApi };
  const stateObject = createStateShortcutObject(getState, type);
  const asyncApiFunctionSet = new Set(asyncFunctionNames);
  const apiProxy = new Proxy(api, {
    get(target, prop, receiver) {
      const originalMember = target[prop];
      if (
        typeof originalMember === 'function' &&
        asyncApiFunctionSet.has(prop)
      ) {
        return async (...args) => {
          if (onAsyncStart) {
            onAsyncStart();
          }
          try {
            // NEW: Auto-refresh state before executing async function
            if (typeof context.refreshLuaGlobalState === 'function') {
              await context.refreshLuaGlobalState(true);
            }
            return await originalMember.apply(target, args);
          } finally {
            if (onAsyncEnd) {
              onAsyncEnd();
            }
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  // NEW: Create a Lua table that proxies access to the sharedLuaGlobals JS object
  lua.global.set('__automaton_index_handler', (table, key) => {
    return sharedLuaGlobals[key];
  });
  lua.global.set('__automaton_newindex_handler', (table, key, value) => {
    sharedLuaGlobals[key] = value;
    if (context.postGlobalVarUpdate) {
      context.postGlobalVarUpdate(key, value);
    }
  });
  await lua.doString(`
    local metatable = {
      __index = __automaton_index_handler,
      __newindex = __automaton_newindex_handler
    }
    SharedGlobals = {}
    setmetatable(SharedGlobals, metatable)
  `);
  const sharedGlobalsProxy = lua.global.get('SharedGlobals');
  lua.global.set('__automaton_index_handler', undefined);
  lua.global.set('__automaton_newindex_handler', undefined);

  return { api: apiProxy, asyncFunctionNames, stateObject, sharedGlobalsProxy }; // NEW: Return sharedGlobalsProxy
};