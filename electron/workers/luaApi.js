// /home/feiron/Dokumenty/Automaton/electron/workers/luaApi.js
//start file
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

  Object.defineProperty(shortcuts, 'lastSeenBattleListMs', {
    get: () => getState().battleList?.lastSeenMs ?? 0,
    enumerable: true,
  });

  Object.defineProperty(shortcuts, 'lastSeenPlayerMs', {
    get: () => getState().uiValues?.lastSeenPlayerMs ?? 0,
    enumerable: true,
  });

  Object.defineProperty(shortcuts, 'lastSeenNpcMs', {
    get: () => getState().uiValues?.lastSeenNpcMs ?? 0,
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
    get: () => getState().battleList?.entries?.length || 0,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'playerNum', {
    get: () => getState().uiValues?.players?.length || 0,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'npcNum', {
    get: () => getState().uiValues?.npcs?.length || 0,
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
  Object.defineProperty(shortcuts, 'marketIcon', {
    get: () => getState().regionCoordinates?.regions?.marketIcon,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'market', {
    get: () => {
      const marketModal = getState().regionCoordinates?.regions?.marketModal;
      // Return false if not detected to avoid Lua bridge errors
      return marketModal || false;
    },
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
      // Return a falsy value that is safe to print/use in Lua without causing bridge errors
      return false;
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
  Object.defineProperty(shortcuts, 'npcs', {
    get: () => getState().uiValues?.npcs || [],
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'balance', {
    get: () => getState().uiValues?.preyBalance || 0,
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
  Object.defineProperty(shortcuts, 'target', {
    get: () => {
      const state = getState();
      const target = state.targeting?.target;

      if (!target) {
        // Return a falsy value instead of null to avoid JS<->Lua bridge errors when printing
        return false;
      }

      // Get coordinates from gameCoordinates if available
      const targetX = target.gameCoordinates?.x || target.x || null;
      const targetY = target.gameCoordinates?.y || target.y || null;
      const targetZ = target.gameCoordinates?.z || target.z || null;

      // Use distanceFrom first (more accurate), fallback to distance, then to calculated distance from gameCoordinates
      const distance =
        target.distanceFrom ||
        target.distance ||
        target.gameCoordinates?.distance ||
        null;

      // Get all available properties
      const name = target.name || null;
      const hp = target.hp || null;
      const isReachable =
        target.isReachable !== undefined ? target.isReachable : null;
      const instanceId = target.instanceId || null;

      // Return the target object with all properties
      return {
        name: name,
        x: targetX,
        y: targetY,
        z: targetZ,
        distance: distance,
        hp: hp,
        isReachable: isReachable,
        instanceId: instanceId,
        // Include absolute coordinates if available
        abs: target.abs || null,
      };
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
  const { onAsyncStart, onAsyncEnd, sharedLuaGlobals, lua, postInputAction, sabInterface } =
    context; // Added postInputAction and sabInterface
  const { type, getState, postSystemMessage, logger, id } = context;
  const scriptName = type === 'script' ? `Script ${id}` : 'Cavebot';
  const asyncFunctionNames = [
    'wait',
    'keyPress',
    'keyPressMultiple',
    'typeText',
    'typeSequence',
    'npcTalk',
    'rotate',
    'clickTile',
    'clickAbsolute',
    'mapClick',
    'drag',
    'dragAbsolute',
    'focusTab',
    'login',
    'waitFor',
    'isTileReachable',
    'useItemOnSelf',
    'useItemOnTile',
    'waitForHealth',
    'waitForMana',
    'openMarket',
    'openStash',
    'selectSellToOffer',
    'clearMarketInput',
    'selectMaxAmountSellTo',
    'acceptSellToOffer',
    'typeMarketItem',
    'marketSellTo',
    'setSetting',
    'itemCount',
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
      { name: 'loginServicePhpErrorModal' },
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
          modal?.children?.abort ||
          modal?.children?.close ||
          modal?.children?.ok;

        if (button?.x && button?.y) {
          logger('info', `[Lua/${scriptName}] Closing '${modalInfo.name}'`);
          if (
            modalInfo.name === 'ipChangedModal' ||
            modalInfo.name === 'notLoggedInAnymoreModal'
          ) {
            postInputAction({
              type: 'script',
              action: {
                module: 'keypress',
                method: 'sendKey',
                args: ['Escape'],
              },
            });
            await wait(500);
            postInputAction({
              type: 'script',
              action: {
                module: 'keypress',
                method: 'sendKey',
                args: ['Escape'],
              },
            });
            await wait(500);
          } else {
            postInputAction({
              type: 'script',
              action: {
                module: 'mouseController',
                method: 'leftClick',
                args: [button.x, button.y],
              },
            });
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
    canUse: (itemName) => {
      const state = getState();
      const activeActionItems = state.gameState?.activeActionItems || {};
      return !!activeActionItems[itemName];
    },
    itemCount: (itemName) => {
      if (!itemName || typeof itemName !== 'string') return 0;

      const state = getState();
      const itemCache = state.gameState?.itemCache || {};

      const cached = itemCache[itemName];
      return cached !== undefined ? cached : 0;
    },
    isItemDetected: (itemName) => {
      if (!itemName || typeof itemName !== 'string') return false;

      const state = getState();
      const activeActionItems = state.gameState?.activeActionItems || {};
      const itemCache = state.gameState?.itemCache || {};

      if (activeActionItems[itemName]) return true;

      const cached = itemCache[itemName];
      return typeof cached === 'number' && cached > 0;
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
    // --- MODIFIED LOGIC START ---
    caround: (...args) => {
      const state = getState();
      const creatures = state.targeting?.creatures || [];
      const playerPos = state.gameState?.playerMinimapPosition;

      let distanceFilter = null;
      let nameFilters = [];

      // Parse arguments intelligently
      if (args.length > 0) {
        if (typeof args[0] === 'number') {
          distanceFilter = args[0];
          nameFilters = args.slice(1).filter((arg) => typeof arg === 'string');
        } else {
          nameFilters = args.filter((arg) => typeof arg === 'string');
        }
      }

      // If no arguments, return total count
      if (distanceFilter === null && nameFilters.length === 0) {
        return creatures.length;
      }

      if (!playerPos) {
        return 0;
      }

      const nameFilterSet =
        nameFilters.length > 0 ? new Set(nameFilters) : null;

      let count = 0;
      for (const creature of creatures) {
        // Always filter by floor first
        if (!creature.gameCoords || creature.gameCoords.z !== playerPos.z) {
          continue;
        }

        // Apply name filter if it exists
        if (nameFilterSet && !nameFilterSet.has(creature.name)) {
          continue;
        }

        // Apply distance filter if it exists
        if (distanceFilter !== null) {
          const dist = Math.max(
            Math.abs(playerPos.x - creature.gameCoords.x),
            Math.abs(playerPos.y - creature.gameCoords.y),
          );
          if (dist > distanceFilter) {
            continue;
          }
        }

        // If all filters pass, increment the count
        count++;
      }
      return count;
    },
    // --- MODIFIED LOGIC END ---
    paround: () => {
      const state = getState();
      const players = state.uiValues?.players || [];
      return players.length;
    },
    npcaround: () => {
      const state = getState();
      const npcs = state.uiValues?.npcs || [];
      return npcs.length;
    },
    maround: () => {
      const state = getState();
      const battleListEntries = state.battleList?.entries || [];
      return battleListEntries.length;
    },
    wptDistance: () => {
      const state = getState();
      // First try to get the distance from pathfinder state
      const pathfinderDistance = state.pathfinder?.wptDistance;
      if (typeof pathfinderDistance === 'number') {
        return pathfinderDistance;
      }

      // Fallback to manual calculation
      const playerPos = state.gameState?.playerMinimapPosition;
      const { waypointSections, currentSection, wptId } = state.cavebot || {};

      if (
        !playerPos ||
        wptId == null ||
        !waypointSections ||
        !waypointSections[currentSection]
      ) {
        return 0;
      }

      const targetWpt = waypointSections[currentSection].waypoints.find(
        (wp) => wp.id === wptId,
      );
      if (!targetWpt || playerPos.z !== targetWpt.z) {
        return 0;
      }

      return Math.max(
        Math.abs(playerPos.x - targetWpt.x),
        Math.abs(playerPos.y - targetWpt.y),
      );
    },
    isTileReachable: async (x, y, z) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;

      if (
        !playerPos ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !Number.isInteger(z)
      ) {
        return false;
      }

      // If the distance is greater than 50, always return false
      const distance = Math.max(
        Math.abs(playerPos.x - x),
        Math.abs(playerPos.y - y),
      );
      if (distance > 50) {
        return false;
      }

      // If on different floors, not reachable
      if (playerPos.z !== z) {
        return false;
      }

      // Try to use pathfinder instance if available (like creatureMonitor does)
      if (context && context.pathfinderInstance) {
        try {
          const targetNode = { x, y, z };
          const isReachable = context.pathfinderInstance.isReachable(
            playerPos,
            targetNode,
            [],
          );
          return isReachable;
        } catch (error) {
          logger(
            'warn',
            `[Lua/${scriptName}] pathfinder check failed: ${error.message}`,
          );
        }
      }

      // Fallback to distance-based reachability check
      // Adjacent tiles (distance 1) are always reachable
      if (distance <= 1) {
        return true;
      }

      // For farther distances, use a conservative estimate
      return distance <= 20;
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
    alert: (soundFile = 'alert.wav') =>
      postSystemMessage({ type: 'play_alert', payload: { soundFile } }),
    wait: (min_ms, max_ms) =>
      wait(min_ms, max_ms, context.refreshLuaGlobalState),
    keyPress: async (key, modifier = null) =>
      await postInputAction({
        type: 'script',
        action: {
          module: 'keypress',
          method: 'sendKey',
          args: [key, modifier],
        },
      }),
    openPreyDialog: async () =>
      await postInputAction({
        type: 'script',
        action: {
          module: 'keypress',
          method: 'sendKey',
          args: ['y', 'ctrl'],
        },
      }),
    keyPressMultiple: async (key, count = 1, modifier = null, delayMs = 50) => {
      for (let i = 0; i < count; i++) {
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: [key, modifier],
          },
        });
        if (i < count - 1) {
          await wait(delayMs);
        }
      }
    },
    typeText: async (...args) => {
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
        // typeArray is a native function, so we need to send it as a single action
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'typeArray',
            args: [stringArgs, startAndEndWithEnter],
          },
        });
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
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'typeArray',
            args: [[text], true], // typeArray expects an array of strings
          },
        });
        if (delayBetween > 0) {
          await wait(delayBetween);
        }
      }
    },
    npcTalk: async (...args) => {
      if (args.length === 0) {
        logger(
          'warn',
          `[Lua/${scriptName}] 'npcTalk' called with no arguments.`,
        );
        return false;
      }

      // Parse inputs: optional trailing boolean, rest are strings
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
          `[Lua/${scriptName}] 'npcTalk' called without any text to type.`,
        );
        return false;
      }

      const typeTextOnce = async (text) => {
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'typeArray',
            args: [[String(text)], startAndEndWithEnter],
          },
        });
      };

      const randInt = (min, max) =>
        Math.floor(Math.random() * (max - min + 1)) + min;

      const isNpcModalOpen = () => {
        const regions = getState().regionCoordinates?.regions;
        return !!(regions?.npcTalkModal);
      };

      const waitForNpcModal = async (greeting, maxAttempts = 3) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          // Say greeting to trigger NPC dialog
          await typeTextOnce(greeting);
          
          // Poll for 2 seconds (10 checks, 200ms apart)
          for (let i = 0; i < 10; i++) {
            await wait(200);
            
            // Refresh state to get latest region data
            if (typeof context.refreshLuaGlobalState === 'function') {
              await context.refreshLuaGlobalState(true);
            }
            
            if (isNpcModalOpen()) {
              logger(
                'info',
                `[Lua/${scriptName}] NPC modal detected on attempt ${attempt}`,
              );
              return true;
            }
          }
          
          logger(
            'warn',
            `[Lua/${scriptName}] NPC modal not detected after attempt ${attempt}/${maxAttempts}`,
          );
        }
        
        // After 3 failed attempts, proceed anyway
        logger(
          'warn',
          `[Lua/${scriptName}] Proceeding with npcTalk despite modal not opening`,
        );
        return false;
      };

      // Refresh state before we start
      if (typeof context.refreshLuaGlobalState === 'function') {
        await context.refreshLuaGlobalState(true);
      }

      // First message triggers the NPC modal
      const firstMsg = stringArgs[0];
      await waitForNpcModal(firstMsg);
      
      // Type remaining messages with delays
      for (let i = 1; i < stringArgs.length; i++) {
        await wait(randInt(100, 500));
        await typeTextOnce(stringArgs[i]);
      }

      return true;
    },
    rotate: async (direction) =>
      await postInputAction({
        type: 'script',
        action: {
          module: 'keypress',
          method: 'rotate',
          args: [direction],
        },
      }),
    isTyping: () => getState().gameState?.isTyping, // This state is read from Redux, not directly from input
    clickTile: async (button, x, y, position = 'center') => {
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
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'rightClick',
            args: [clickCoords.x, clickCoords.y],
          },
        });
      } else {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [clickCoords.x, clickCoords.y],
          },
        });
      }
      return true;
    },
    clickAbsolute: async (button, x, y) => {
      if (button === 'right') {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'rightClick',
            args: [x, y],
          },
        });
      } else {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [x, y],
          },
        });
      }
      return true;
    },
    mapClick: async (x, y, position = 'center') => {
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
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [clickCoords.x, clickCoords.y],
        },
      });
      return true;
    },
    drag: async (startX, startY, endX, endY, button = 'left') => {
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
      if (button === 'right') {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'rightMouseDown',
            args: [startCoords.x, startCoords.y],
          },
        });
      } else {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'mouseDown',
            args: [startCoords.x, startCoords.y],
          },
        });
      }
      await wait(100);
      if (button === 'right') {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'rightMouseUp',
            args: [endCoords.x, endCoords.y],
          },
        });
      } else {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'mouseUp',
            args: [endCoords.x, endCoords.y],
          },
        });
      }
      return true;
    },
    dragAbsolute: async (startX, startY, endX, endY, button = 'left') => {
      if (button === 'right') {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'rightMouseDown',
            args: [startX, startY],
          },
        });
      } else {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'mouseDown',
            args: [startX, startY],
          },
        });
      }
      await wait(100);
      if (button === 'right') {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'rightMouseUp',
            args: [endX, endY],
          },
        });
      } else {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'mouseUp',
            args: [endX, endY],
          },
        });
      }
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
      const { x, y } = tab.tabPosition;
      const randInt = (min, max) =>
        Math.floor(Math.random() * (max - min + 1)) + min;
      const clickX = x + randInt(-70, 70);
      const clickY = y + randInt(-7, 7);
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [clickX, clickY],
        },
      });
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
      const state = getState();
      const creatures = state.targeting?.creatures || [];
      return creatures.some(
        (creature) =>
          creature.gameCoords.x === x &&
          creature.gameCoords.y === y &&
          creature.gameCoords.z === z,
      );
    },
    isEntityOnTile: (x, y, z, range = 0) => {
      const state = getState();
      const healthBars = state.targeting?.healthBars || [];
      const targetX = x;
      const targetY = y;
      const targetZ = z;
    
      // Check if any health bar is within range
      for (const hb of healthBars) {
        if (!hb || hb.x === undefined) continue;
    
        // Calculate Chebyshev distance (max of absolute differences)
        const dx = Math.abs(hb.x - targetX);
        const dy = Math.abs(hb.y - targetY);
        const dz = Math.abs(hb.z - targetZ);
        const distance = Math.max(dx, dy, dz);
    
        if (distance <= range) {
          return true;
        }
      }
    
      return false;
    },
    setScripts: (enabled) => {
      context.postStoreUpdate('lua/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Scripts ${enabled ? 'enabled' : 'disabled'}`,
      );
    },
    setScript: (name, status) => {
      const enabled = status === 'enabled';
      postSystemMessage({
        type: 'lua_set_script_enabled',
        payload: { name, enabled },
      });
      logger(
        'info',
        `[Lua/${scriptName}] Setting script "${name}" to ${status}`,
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
        logger(
          'info',
          `[Lua/${scriptName}] Pausing targeting for ${duration}ms`,
        );
      }
    },
    // Helper functions to get elapsed time since last sighting
    timeSinceBattleList: () => {
      const state = getState();
      const lastSeenMs = state.battleList?.lastSeenMs ?? 0;
      return Date.now() - lastSeenMs;
    },
    timeSincePlayer: () => {
      const state = getState();
      const lastSeenMs = state.uiValues?.lastSeenPlayerMs ?? 0;
      return Date.now() - lastSeenMs;
    },
    timeSinceNpc: () => {
      const state = getState();
      const lastSeenMs = state.uiValues?.lastSeenNpcMs ?? 0;
      return Date.now() - lastSeenMs;
    },
    // Convenience functions with seconds instead of milliseconds
    secsSinceBattleList: () => {
      const state = getState();
      const lastSeenMs = state.battleList?.lastSeenMs ?? 0;
      return Math.floor((Date.now() - lastSeenMs) / 1000);
    },
    secsSincePlayer: () => {
      const state = getState();
      const lastSeenMs = state.uiValues?.lastSeenPlayerMs ?? 0;
      return Math.floor((Date.now() - lastSeenMs) / 1000);
    },
    secsSinceNpc: () => {
      const state = getState();
      const lastSeenMs = state.uiValues?.lastSeenNpcMs ?? 0;
      return Math.floor((Date.now() - lastSeenMs) / 1000);
    },
    // New helper functions for enhanced Lua scripting
    useItemOnSelf: async (itemName) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const hotkeyBarChildren =
        state.regionCoordinates?.regions?.hotkeyBar?.children || {};
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;

      if (!playerPos || !gameWorld || !tileSize) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnSelf: Missing player position or game world data`,
        );
        return false;
      }

      // Find the item in the hotkey bar
      const item = hotkeyBarChildren[itemName];
      if (!item || item.x === undefined || item.y === undefined) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnSelf: Item '${itemName}' not found in hotkey bar`,
        );
        return false;
      }

      // Click on the item
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [item.x, item.y],
        },
      });
      await wait(100);

      // Click on player position
      const playerCoords = getAbsoluteGameWorldClickCoordinates(
        playerPos.x,
        playerPos.y,
        playerPos,
        gameWorld,
        tileSize,
        'center',
      );

      if (!playerCoords) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnSelf: Could not calculate player screen coordinates`,
        );
        return false;
      }

      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [playerCoords.x, playerCoords.y],
        },
      });

      logger('info', `[Lua/${scriptName}] Used item '${itemName}' on self`);
      return true;
    },
    useItemOnTile: async (itemName, x, y, z) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const hotkeyBarChildren =
        state.regionCoordinates?.regions?.hotkeyBar?.children || {};
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;

      if (!playerPos || !gameWorld || !tileSize) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnTile: Missing player position or game world data`,
        );
        return false;
      }

      // Check if tile is on same floor
      if (playerPos.z !== z) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnTile: Target tile is on different floor`,
        );
        return false;
      }

      // Find the item in the hotkey bar
      const item = hotkeyBarChildren[itemName];
      if (!item || item.x === undefined || item.y === undefined) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnTile: Item '${itemName}' not found in hotkey bar`,
        );
        return false;
      }

      // Click on the item
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [item.x, item.y],
        },
      });
      await wait(100);

      // Click on target tile
      const tileCoords = getAbsoluteGameWorldClickCoordinates(
        x,
        y,
        playerPos,
        gameWorld,
        tileSize,
        'center',
      );

      if (!tileCoords) {
        logger(
          'warn',
          `[Lua/${scriptName}] useItemOnTile: Could not calculate tile screen coordinates`,
        );
        return false;
      }

      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [tileCoords.x, tileCoords.y],
        },
      });

      logger(
        'info',
        `[Lua/${scriptName}] Used item '${itemName}' on tile (${x}, ${y}, ${z})`,
      );
      return true;
    },

    useActionItem: async (itemName, hotkey = null) => {
      if (!itemName || typeof itemName !== 'string') {
        logger(
          'warn',
          `[Lua/${scriptName}] useActionItem: invalid item name`,
        );
        return false;
      }

      const state = getState();
      const activeActionItems = state.gameState?.activeActionItems || {};
      const item = activeActionItems[itemName];

      if (!item || item.x === undefined || item.y === undefined || item.width <= 0 || item.height <= 0) {
        logger(
          'warn',
          `[Lua/${scriptName}] useActionItem: Item '${itemName}' not found or invalid position`,
        );
        return false;
      }

      if (hotkey && typeof hotkey === 'string') {
        // Use hotkey press
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: [hotkey],
          },
        });
        logger(
          'info',
          `[Lua/${scriptName}] Used action item '${itemName}' via hotkey '${hotkey}'`,
        );
      } else {
        // Mouse click randomly in item area
        const randX = item.x + Math.floor(Math.random() * item.width);
        const randY = item.y + Math.floor(Math.random() * item.height);
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [randX, randY],
          },
        });
        logger(
          'info',
          `[Lua/${scriptName}] Used action item '${itemName}' via mouse click at (${randX}, ${randY})`,
        );
      }

      return true;
    },
    waitForHealth: async (percentage, timeout = 5000) => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        await context.refreshLuaGlobalState();
        const state = getState();
        const currentHp = state.gameState?.hppc;

        if (currentHp >= percentage) {
          logger('info', `[Lua/${scriptName}] Health reached ${percentage}%`);
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      logger(
        'info',
        `[Lua/${scriptName}] waitForHealth timed out waiting for ${percentage}% health`,
      );
      return false;
    },
    waitForMana: async (percentage, timeout = 5000) => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        await context.refreshLuaGlobalState();
        const state = getState();
        const currentMp = state.gameState?.mppc;

        if (currentMp >= percentage) {
          logger('info', `[Lua/${scriptName}] Mana reached ${percentage}%`);
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      logger(
        'info',
        `[Lua/${scriptName}] waitForMana timed out waiting for ${percentage}% mana`,
      );
      return false;
    },
    hasStatus: (statusName) => {
      const state = getState();
      const characterStatus = state.gameState?.characterStatus;

      if (!characterStatus) {
        return false;
      }

      // Convert status name to the format used in state (e.g., "hasted", "poisoned")
      const normalizedStatus = statusName.toLowerCase();

      // Check if the status exists and is true
      return characterStatus[normalizedStatus] === true;
    },
    isInSpecialArea: (specialAreaName) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const specialAreas = state.cavebot?.specialAreas || [];

      if (!playerPos) {
        return false;
      }

      // Find the special area by name
      const area = specialAreas.find(
        (area) => area.enabled && area.name === specialAreaName,
      );

      if (!area) {
        return false;
      }

      // Check if player is on the same floor
      if (playerPos.z !== area.z) {
        return false;
      }

      // Check if player is within the area bounds (rectangle)
      const inBoundsX =
        playerPos.x >= area.x && playerPos.x < area.x + area.sizeX;
      const inBoundsY =
        playerPos.y >= area.y && playerPos.y < area.y + area.sizeY;

      return inBoundsX && inBoundsY;
    },
    getCurrentSpecialArea: () => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;
      const specialAreas = state.cavebot?.specialAreas || [];

      if (!playerPos) {
        return 'none';
      }

      // Check all enabled special areas to find the first match
      for (const area of specialAreas) {
        if (!area.enabled) {
          continue;
        }

        // Check if player is on the same floor
        if (playerPos.z !== area.z) {
          continue;
        }

        // Check if player is within the area bounds (rectangle)
        const inBoundsX =
          playerPos.x >= area.x && playerPos.x < area.x + area.sizeX;
        const inBoundsY =
          playerPos.y >= area.y && playerPos.y < area.y + area.sizeY;

        if (inBoundsX && inBoundsY) {
          return area.name;
        }
      }

      return 'none';
    },
    isAtLocation: (x, y, z, range = 0) => {
      const state = getState();
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!playerPos) {
        return false;
      }

      // Check if on same floor
      if (playerPos.z !== z) {
        return false;
      }

      // Calculate Chebyshev distance (max of absolute differences)
      const distance = Math.max(
        Math.abs(playerPos.x - x),
        Math.abs(playerPos.y - y),
      );

      return distance <= range;
    },
    getWaypointByLabel: (label) => {
      const state = getState();
      const cavebotState = state.cavebot;

      if (!cavebotState || !cavebotState.waypointSections) {
        return null;
      }

      // Search through all sections for the waypoint with the given label
      for (const sectionId in cavebotState.waypointSections) {
        const section = cavebotState.waypointSections[sectionId];
        if (section.waypoints) {
          const waypoint = section.waypoints.find((wp) => wp.label === label);
          if (waypoint) {
            return {
              x: waypoint.x,
              y: waypoint.y,
              z: waypoint.z,
              type: waypoint.type,
              label: waypoint.label,
              section: section.name,
              id: waypoint.id,
            };
          }
        }
      }

      return null;
    },
    caroundByHealth: (distance, healthStatus) => {
      const state = getState();
      const creatures = state.targeting?.creatures || [];
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!playerPos) {
        return 0;
      }

      // Normalize health status for comparison
      const normalizedHealth = healthStatus ? healthStatus.toLowerCase() : null;

      let count = 0;
      for (const creature of creatures) {
        // Check distance if specified (null means all distances)
        if (distance !== null && distance !== undefined) {
          const creatureDistance = creature.distance || creature.rawDistance;
          if (creatureDistance > distance) {
            continue;
          }
        }

        // Check health status if specified (null means any health)
        if (normalizedHealth) {
          const creatureHealth = creature.hp ? creature.hp.toLowerCase() : '';
          if (creatureHealth !== normalizedHealth) {
            continue;
          }
        }

        count++;
      }

      return count;
    },
    waitFor,
    login: async (email, password, character) => {
      if (
        await waitFor(
          'regionCoordinates.regions.onlineMarker',
          'exists',
          null,
          100,
        )
      ) {
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

        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: ['Escape'],
          },
        });
        await wait(100);
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: ['Escape'],
          },
        });
        await wait(100);

        const emailInput = loginModal.children?.emailInput;
        if (!emailInput) {
          logger('warn', `[Lua/${scriptName}] emailInput not found`);
          return false;
        }
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [emailInput.x, emailInput.y],
          },
        });
        await wait(50);
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'typeArray',
            args: [[email], false],
          },
        });
        await wait(100);

        const passwordInput = loginModal.children?.passwordInput;
        if (!passwordInput) {
          logger('warn', `[Lua/${scriptName}] passwordInput not found`);
          return false;
        }
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [passwordInput.x, passwordInput.y],
          },
        });
        await wait(50);
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'typeArray',
            args: [[password], false],
          },
        });
        await wait(100);
        await postInputAction({
          type: 'script',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: ['Enter'],
          },
        });
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

      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [characterItem.position.x, characterItem.position.y],
        },
      });
      await wait(100);
      await postInputAction({
        type: 'script',
        action: {
          module: 'keypress',
          method: 'sendKey',
          args: ['Enter'],
        },
      });

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
    openMarket: async () => {
      const state = getState();
      const marketIcon = state.regionCoordinates?.regions?.marketIcon;
      
      if (!marketIcon?.x || !marketIcon?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot open market: market icon not found`,
        );
        return false;
      }
      
      // Try up to 3 times
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Click the market icon
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [marketIcon.x, marketIcon.y],
          },
        });
        
        // Poll for market modal (10 checks, 200ms apart = 2000ms total)
        for (let i = 0; i < 10; i++) {
          await wait(200);
          
          // Refresh state to get latest region data
          if (typeof context.refreshLuaGlobalState === 'function') {
            await context.refreshLuaGlobalState(true);
          }
          
          const updatedState = getState();
          const marketModal = updatedState.regionCoordinates?.regions?.marketModal;
          
          if (marketModal?.x !== undefined && marketModal?.y !== undefined) {
            logger(
              'info',
              `[Lua/${scriptName}] Market modal opened successfully on attempt ${attempt}`,
            );
            return true;
          }
        }
        
        logger(
          'warn',
          `[Lua/${scriptName}] Market modal not detected after attempt ${attempt}/3`,
        );
      }
      
      logger(
        'error',
        `[Lua/${scriptName}] Failed to open market modal after 3 attempts`,
      );
      return false;
    },
    openStash: async () => {
      const state = getState();
      const stashIcon = state.regionCoordinates?.regions?.stashIcon;
      
      if (!stashIcon?.x || !stashIcon?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot open stash: stash icon not found`,
        );
        return false;
      }
      
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [stashIcon.x, stashIcon.y],
        },
      });
      return true;
    },
    selectSellToOffer: async (characterName) => {
      if (!characterName || typeof characterName !== 'string') {
        logger(
          'warn',
          `[Lua/${scriptName}] selectSellToOffer: invalid character name`,
        );
        return false;
      }
      
      // Refresh state to get latest OCR data
      if (typeof context.refreshLuaGlobalState === 'function') {
        await context.refreshLuaGlobalState(true);
      }
      
      const state = getState();
      const marketSellToList = state.uiValues?.marketSellToList;
      
      if (!marketSellToList?.offers || marketSellToList.offers.length === 0) {
        logger(
          'warn',
          `[Lua/${scriptName}] selectSellToOffer: no offers found in sell-to list`,
        );
        return false;
      }
      
      const targetName = characterName.toLowerCase();
      const offer = marketSellToList.offers.find(
        (o) => o.characterName.toLowerCase().includes(targetName),
      );
      
      if (!offer) {
        logger(
          'warn',
          `[Lua/${scriptName}] selectSellToOffer: character '${characterName}' not found in offers`,
        );
        return false;
      }
      
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [offer.position.x, offer.position.y],
        },
      });
      
      logger(
        'info',
        `[Lua/${scriptName}] Clicked on offer from '${offer.characterName}'`,
      );
      return true;
    },
    clearMarketInput: async () => {
      const state = getState();
      const clearButton =
        state.regionCoordinates?.regions?.marketModal?.children?.clearInputButton;
      
      if (!clearButton?.x || !clearButton?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] clearMarketInput: clear button not found`,
        );
        return false;
      }
      
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [clearButton.x, clearButton.y],
        },
      });
      return true;
    },
    selectMaxAmountSellTo: async () => {
      const state = getState();
      const sliderMax =
        state.regionCoordinates?.regions?.marketModal?.children?.sellToSliderMax;
      
      if (!sliderMax?.x || !sliderMax?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] selectMaxAmountSellTo: slider max button not found`,
        );
        return false;
      }
      
      // Click 5 times with 100ms delay
      for (let i = 0; i < 5; i++) {
        await postInputAction({
          type: 'script',
          action: {
            module: 'mouseController',
            method: 'leftClick',
            args: [sliderMax.x, sliderMax.y],
          },
        });
        if (i < 4) {
          await wait(100);
        }
      }
      return true;
    },
    acceptSellToOffer: async () => {
      const state = getState();
      const acceptButton =
        state.regionCoordinates?.regions?.marketModal?.children?.sellToAcceptButton;
      
      if (!acceptButton?.x || !acceptButton?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] acceptSellToOffer: accept button not found`,
        );
        return false;
      }
      
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [acceptButton.x, acceptButton.y],
        },
      });
      return true;
    },
    typeMarketItem: async (itemName) => {
      if (!itemName || typeof itemName !== 'string') {
        logger(
          'warn',
          `[Lua/${scriptName}] typeMarketItem: invalid item name`,
        );
        return false;
      }
      
      const state = getState();
      const marketModal = state.regionCoordinates?.regions?.marketModal;
      const clearButton = marketModal?.children?.clearInputButton;
      const searchInput = marketModal?.children?.searchInput;
      
      if (!clearButton?.x || !clearButton?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] typeMarketItem: clear button not found`,
        );
        return false;
      }
      
      if (!searchInput?.x || !searchInput?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] typeMarketItem: search input not found`,
        );
        return false;
      }
      
      // Click clear button
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [clearButton.x, clearButton.y],
        },
      });
      
      // Wait 200-500ms
      await wait(Math.floor(Math.random() * 300) + 200);
      
      // Click on search input
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [searchInput.x, searchInput.y],
        },
      });
      
      // Wait 100ms
      await wait(100);
      
      // Type item name
      await postInputAction({
        type: 'script',
        action: {
          module: 'keypress',
          method: 'typeArray',
          args: [[itemName], false],
        },
      });
      
      logger(
        'info',
        `[Lua/${scriptName}] Typed item name: '${itemName}'`,
      );
      return true;
    },
    setSetting: (...args) => {
      if (args.length < 2) {
        logger(
          'warn',
          `[Lua/${scriptName}] setSetting: insufficient arguments`,
        );
        return false;
      }

      const [category, ...rest] = args;

      switch (category) {
        case 'targeting': {
          const [creatureName, property, value] = rest;
          if (!creatureName || typeof creatureName !== 'string') {
            logger(
              'warn',
              `[Lua/${scriptName}] setSetting targeting: invalid creature name`,
            );
            return false;
          }

          if (!property || typeof property !== 'string') {
            logger(
              'warn',
              `[Lua/${scriptName}] setSetting targeting: invalid property name`,
            );
            return false;
          }

          const state = getState();
          const targetingList = state.targeting?.targetingList || [];

          // Find the creature by name (case-insensitive)
          const creature = targetingList.find(
            (c) => c.name && c.name.toLowerCase() === creatureName.toLowerCase(),
          );

          if (!creature) {
            logger(
              'warn',
              `[Lua/${scriptName}] setSetting targeting: creature '${creatureName}' not found in targeting list`,
            );
            return false;
          }

          // Validate property and value based on expected types
          let processedValue = value;
          switch (property) {
            case 'priority':
            case 'distance':
            case 'stickiness':
              processedValue = parseInt(value, 10);
              if (isNaN(processedValue)) {
                logger(
                  'warn',
                  `[Lua/${scriptName}] setSetting targeting: invalid numeric value for '${property}'`,
                );
                return false;
              }
              break;
            case 'onlyIfTrapped':
              processedValue = Boolean(value);
              break;
            case 'healthRange':
              const validHealthRanges = ['Any', 'Full', 'High', 'Medium', 'Low', 'Critical'];
              if (!validHealthRanges.includes(value)) {
                logger(
                  'warn',
                  `[Lua/${scriptName}] setSetting targeting: invalid healthRange value '${value}'`,
                );
                return false;
              }
              break;
            case 'action':
              const validActions = ['Attack', 'None'];
              if (!validActions.includes(value)) {
                logger(
                  'warn',
                  `[Lua/${scriptName}] setSetting targeting: invalid action value '${value}'`,
                );
                return false;
              }
              break;
            case 'stance':
              const validStances = ['Reach', 'Stand', 'Keep Away', 'Ignore'];
              if (!validStances.includes(value)) {
                logger(
                  'warn',
                  `[Lua/${scriptName}] setSetting targeting: invalid stance value '${value}'`,
                );
                return false;
              }
              break;
            default:
              logger(
                'warn',
                `[Lua/${scriptName}] setSetting targeting: unknown property '${property}'`,
              );
              return false;
          }

          // Update the creature property
          context.postStoreUpdate('targeting/updateCreatureInTargetingList', {
            id: creature.id,
            updates: { [property]: processedValue },
          });

          logger(
            'info',
            `[Lua/${scriptName}] Updated targeting creature '${creatureName}' property '${property}' to '${processedValue}'`,
          );
          return true;
        }

        case 'rules': {
          const [property, value] = rest;
          if (!property || typeof property !== 'string') {
            logger(
              'warn',
              `[Lua/${scriptName}] setSetting rules: invalid property name`,
            );
            return false;
          }

          let processedValue = value;
          switch (property) {
            case 'enabled':
              processedValue = Boolean(value);
              break;
            default:
              logger(
                'warn',
                `[Lua/${scriptName}] setSetting rules: unknown property '${property}'`,
              );
              return false;
          }

          context.postStoreUpdate('rules/setenabled', processedValue);
          logger(
            'info',
            `[Lua/${scriptName}] Updated rules property '${property}' to '${processedValue}'`,
          );
          return true;
        }

        case 'cavebot': {
          const [property, value] = rest;
          if (!property || typeof property !== 'string') {
            logger(
              'warn',
              `[Lua/${scriptName}] setSetting cavebot: invalid property name`,
            );
            return false;
          }

          let processedValue = value;
          switch (property) {
            case 'enabled':
              processedValue = Boolean(value);
              break;
            default:
              logger(
                'warn',
                `[Lua/${scriptName}] setSetting cavebot: unknown property '${property}'`,
              );
              return false;
          }

          context.postStoreUpdate('cavebot/setenabled', processedValue);
          logger(
            'info',
            `[Lua/${scriptName}] Updated cavebot property '${property}' to '${processedValue}'`,
          );
          return true;
        }

        case 'lua': {
          const [property, value] = rest;
          if (!property || typeof property !== 'string') {
            logger(
              'warn',
              `[Lua/${scriptName}] setSetting lua: invalid property name`,
            );
            return false;
          }

          let processedValue = value;
          switch (property) {
            case 'enabled':
              processedValue = Boolean(value);
              break;
            default:
              logger(
                'warn',
                `[Lua/${scriptName}] setSetting lua: unknown property '${property}'`,
              );
              return false;
          }

          context.postStoreUpdate('lua/setenabled', processedValue);
          logger(
            'info',
            `[Lua/${scriptName}] Updated lua property '${property}' to '${processedValue}'`,
          );
          return true;
        }

        default:
          logger(
            'warn',
            `[Lua/${scriptName}] setSetting: unknown category '${category}'`,
          );
          return false;
      }
    },
    marketSellTo: async (characterName, itemName) => {
      if (!characterName || typeof characterName !== 'string') {
        logger(
          'warn',
          `[Lua/${scriptName}] marketSellTo: invalid character name`,
        );
        return false;
      }

      if (!itemName || typeof itemName !== 'string') {
        logger(
          'warn',
          `[Lua/${scriptName}] marketSellTo: invalid item name`,
        );
        return false;
      }

      logger(
        'info',
        `[Lua/${scriptName}] Starting marketSellTo: item='${itemName}', character='${characterName}'`,
      );

      // Check if market is already open
      let state = getState();
      let marketModal = state.regionCoordinates?.regions?.marketModal;

      if (!marketModal || !marketModal.x || !marketModal.y) {
        logger(
          'info',
          `[Lua/${scriptName}] Market not open, attempting to open...`,
        );

        const opened = await baseApi.openMarket();
        if (!opened) {
          logger(
            'error',
            `[Lua/${scriptName}] Failed to open market`,
          );
          return false;
        }

        // Refresh state after opening
        if (typeof context.refreshLuaGlobalState === 'function') {
          await context.refreshLuaGlobalState(true);
        }
        state = getState();
        marketModal = state.regionCoordinates?.regions?.marketModal;
      } else {
        logger(
          'info',
          `[Lua/${scriptName}] Market already open`,
        );
      }

      // Wait for market to be ready
      await wait(300);

      // Type item name in search
      logger(
        'info',
        `[Lua/${scriptName}] Typing item name: '${itemName}'`,
      );
      const typed = await baseApi.typeMarketItem(itemName);
      if (!typed) {
        logger(
          'error',
          `[Lua/${scriptName}] Failed to type item name`,
        );
        return false;
      }

      // Wait for search results to populate
      await wait(500);

      // Click on items list to load offers
      state = getState();
      marketModal = state.regionCoordinates?.regions?.marketModal;
      const itemsList = marketModal?.children?.itemsList;

      if (!itemsList?.x || !itemsList?.y) {
        logger(
          'warn',
          `[Lua/${scriptName}] Items list not found`,
        );
        return false;
      }

      logger(
        'info',
        `[Lua/${scriptName}] Clicking on items list`,
      );
      await postInputAction({
        type: 'script',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [itemsList.x, itemsList.y],
        },
      });

      // Wait for sell-to list to populate
      await wait(800);

      // Refresh state to get OCR data
      if (typeof context.refreshLuaGlobalState === 'function') {
        await context.refreshLuaGlobalState(true);
      }

      // Select the offer from the character
      logger(
        'info',
        `[Lua/${scriptName}] Selecting offer from '${characterName}'`,
      );
      const selected = await baseApi.selectSellToOffer(characterName);
      if (!selected) {
        logger(
          'error',
          `[Lua/${scriptName}] Failed to select offer from '${characterName}'`,
        );
        return false;
      }

      // Wait after selecting offer
      await wait(300);

      // Select max amount
      logger(
        'info',
        `[Lua/${scriptName}] Selecting max amount`,
      );
      const maxSelected = await baseApi.selectMaxAmountSellTo();
      if (!maxSelected) {
        logger(
          'error',
          `[Lua/${scriptName}] Failed to select max amount`,
        );
        return false;
      }

      // Wait before accepting
      await wait(300);

      // Accept the offer
      logger(
        'info',
        `[Lua/${scriptName}] Accepting offer`,
      );
      const accepted = await baseApi.acceptSellToOffer();
      if (!accepted) {
        logger(
          'error',
          `[Lua/${scriptName}] Failed to accept offer`,
        );
        return false;
      }

      logger(
        'info',
        `[Lua/${scriptName}] Successfully completed marketSellTo`,
      );
      return true;
    },
  };
  let navigationApi = {};

  const goBackWaypoints = (numBack) => {
    const state = getState();
    const { waypointSections, currentSection, wptId } = state.cavebot;
    const waypoints = waypointSections[currentSection]?.waypoints || [];
    if (waypoints.length === 0) {
      logger(
        'warn',
        `[Lua/${scriptName}] back function failed: no waypoints in current section.`,
      );
      return;
    }

    const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
    if (currentIndex === -1) {
      logger(
        'warn',
        `[Lua/${scriptName}] back function failed: current waypoint not found.`,
      );
      return;
    }

    const newIndex = Math.max(0, currentIndex - numBack);
    if (currentIndex === newIndex) {
      logger(
        'info',
        `[Lua/${scriptName}] back function: already at or before target waypoint index.`,
      );
      return;
    }

    if (waypoints[newIndex]) {
      context.postStoreUpdate('cavebot/setwptId', waypoints[newIndex].id);
    }
  };

  const goToSection = async (sectionName, label) => {
    const state = getState();
    const { waypointSections } = state.cavebot;
    const foundEntry = Object.entries(waypointSections).find(
      ([, s]) => s.name === sectionName,
    );

    if (foundEntry) {
      const [targetSectionId, targetSection] = foundEntry;
      if (targetSection.waypoints?.length > 0) {
        let targetWpt = targetSection.waypoints[0]; // Default to first
        if (label) {
          const foundWpt = targetSection.waypoints.find(
            (wp) => wp.label === label,
          );
          if (foundWpt) {
            targetWpt = foundWpt;
          } else {
            logger(
              'warn',
              `[Lua/${scriptName}] goToSection: Label '${label}' not found in section '${sectionName}'. Failing gracefully.`,
            );
            
            return;
          }
        }
        context.postStoreUpdate(
          'cavebot/setCurrentWaypointSection',
          targetSectionId,
        );
        context.postStoreUpdate('cavebot/setwptId', targetWpt.id);
      } else {
        logger(
          'warn',
          `[Lua/${scriptName}] goToSection: Section '${sectionName}' has no waypoints.`,
        );
        
      }
    } else {
      logger(
        'warn',
        `[Lua/${scriptName}] goToSection: Section '${sectionName}' not found.`,
      );
      
    }
    
  };

  if (type === 'cavebot') {
    navigationApi = {
      skipWaypoint: context.advanceToNextWaypoint,
      goToLabel: async (label) => {
        await context.goToLabel(label);
        
      },
      goToSection,
      goToWpt: async (id) => {
        await context.goToWpt(id);
        
      },
      back: (x) => goBackWaypoints(x),
      backLoc: (x, y) => {
        if (!baseApi.isLocation(x)) {
          goBackWaypoints(y);
        }
      },
      backz: (y) => {
        const state = getState();
        const playerPos = state.gameState?.playerMinimapPosition;
        const { waypointSections, currentSection, wptId } = state.cavebot;
        const waypoints = waypointSections[currentSection]?.waypoints || [];
        const currentWpt = waypoints.find((wp) => wp.id === wptId);
        if (playerPos && currentWpt && playerPos.z !== currentWpt.z) {
          goBackWaypoints(y);
        }
      },
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
      goToLabel: async (label) => {
        const state = getState();
        const { waypointSections, currentSection } = state.cavebot;
        const targetWpt = waypointSections[currentSection]?.waypoints.find(
          (wp) => wp.label === label,
        );
        if (targetWpt)
          context.postStoreUpdate('cavebot/setwptId', targetWpt.id);
        
      },
      goToSection,
      goToWpt: async (index) => {
        const arrayIndex = parseInt(index, 10) - 1;
        if (isNaN(arrayIndex) || arrayIndex < 0) {
          
          return;
        }
        const state = getState();
        const { waypointSections, currentSection } = state.cavebot;
        const waypoints = waypointSections[currentSection]?.waypoints || [];
        if (arrayIndex < waypoints.length)
          context.postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
        
      },
      back: (x) => goBackWaypoints(x),
      backLoc: (x, y) => {
        if (!baseApi.isLocation(x)) {
          goBackWaypoints(y);
        }
      },
      backz: (y) => {
        const state = getState();
        const playerPos = state.gameState?.playerMinimapPosition;
        const { waypointSections, currentSection, wptId } = state.cavebot;
        const waypoints = waypointSections[currentSection]?.waypoints || [];
        const currentWpt = waypoints.find((wp) => wp.id === wptId);
        if (playerPos && currentWpt && playerPos.z !== currentWpt.z) {
          goBackWaypoints(y);
        }
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

//endFile
