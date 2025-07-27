// luaApi.js  (COMPLETE drop-in replacement, nothing removed, nothing added)

import {
  keyPress,
  keyPressMultiple,
  type as typeText,
  rotate,
  getIsTyping,
} from '../keyboardControll/keyPress.js';
import mouseController from 'mouse-controller';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import { wait } from './exposedLuaFunctions.js';
import {
  setActionPaused,
  setenabled as setCavebotEnabled,
} from '../../frontend/redux/slices/cavebotSlice.js';
import { setenabled as setRulesEnabled } from '../../frontend/redux/slices/ruleSlice.js';
import { setenabled as setTargetingEnabled } from '../../frontend/redux/slices/targetingSlice.js';
import { setenabled as setLuaEnabled } from '../../frontend/redux/slices/luaSlice.js';

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
  Object.defineProperty(shortcuts, 'hppc', {
    get: () => getState().gameState?.hppc,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, 'mppc', {
    get: () => getState().gameState?.mppc,
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
  Object.defineProperty(shortcuts, 'activeTab', {
    get: () => getState().uiValues?.chatboxTabs?.activeTab || 'unknown',
    enumerable: true,
  });

  // --- Action Items Getters ---
  Object.defineProperty(shortcuts, 'actionItems', {
    get: () => {
      const hotkeyBarChildren =
        getState().regionCoordinates?.regions?.hotkeyBar?.children || {};
      // Return a proxy that always returns boolean for any property access
      return new Proxy(
        {},
        {
          get(target, prop) {
            const child = hotkeyBarChildren[prop];
            return !!(child && child.x !== undefined && child.y !== undefined);
          },
          has(target, prop) {
            return true; // Allow checking for any property
          },
          ownKeys() {
            return Object.keys(hotkeyBarChildren);
          },
        },
      );
    },
    enumerable: true,
  });

  const gameState = getState().gameState;
  if (gameState && gameState.characterStatus) {
    for (const status in gameState.characterStatus) {
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

  // --- Cavebot-Specific Getters ---
  const cavebotState = getState().cavebot;
  if (type === 'cavebot' && cavebotState) {
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
    Object.defineProperty(shortcuts, 'wpt', {
      get: () => {
        const currentCavebotState = getState().cavebot;
        const currentWaypoints =
          currentCavebotState?.waypointSections[
            currentCavebotState?.currentSection
          ]?.waypoints || [];
        const currentWptIndex = currentWaypoints.findIndex(
          (wp) => wp.id === currentCavebotState?.wptId,
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
            distance: currentCavebotState.wptDistance,
          };
        }
        return null;
      },
      enumerable: true,
    });
  }

  // --- Bot Control State Variables ---
  Object.defineProperty(shortcuts, '$healing', {
    get: () => getState().rules?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, '$targeting', {
    get: () => getState().targeting?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, '$cavebot', {
    get: () => getState().cavebot?.enabled,
    enumerable: true,
  });
  Object.defineProperty(shortcuts, '$scripts', {
    get: () => getState().lua?.enabled,
    enumerable: true,
  });

  return shortcuts;
};

/**
 * Creates a consolidated API (functions and state object) to be exposed to a Lua environment.
 * @param {object} context - The context object from the calling worker.
 * @returns {{api: object, asyncFunctionNames: string[], stateObject: object}}
 */
export const createLuaApi = (context) => {
  const { onAsyncStart, onAsyncEnd } = context;
  const {
    type,
    getState,
    postSystemMessage,
    logger,
    id,
    refreshLuaGlobalState,
  } = context; // Add refreshLuaGlobalState to context
  const scriptName = type === 'script' ? `Script ${id}` : 'Cavebot';
  const asyncFunctionNames = [
    'wait', // This will now trigger a state refresh
    'keyPress',
    'keyPressMultiple',
    'type',
    'rotate',
    'leftClick',
    'rightClick',
    'leftClickAbsolute', // New async function
    'rightClickAbsolute', // New async function
    'mapClick',
    'drag',
    'dragAbsolute',
    'focusTab',
    'login',
  ];
  const getWindowId = () => getState()?.global?.windowId;
  const getDisplay = () => getState()?.global?.display || ':0';

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
      if (
        !playerPos ||
        !wptId ||
        !waypointSections ||
        !waypointSections[currentSection]
      )
        return false;
      const targetWpt = waypointSections[currentSection].waypoints.find(
        (wp) => wp.id === wptId,
      );
      if (!targetWpt || playerPos.z !== targetWpt.z) return false;
      return (
        Math.max(
          Math.abs(playerPos.x - targetWpt.x),
          Math.abs(playerPos.y - targetWpt.y),
        ) <= range
      );
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
        const scriptId = getState().cavebot.wptId;
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
    wait: (min_ms, max_ms) => wait(min_ms, max_ms, refreshLuaGlobalState), // Pass the refresh callback
    keyPress: (key, modifier = null) =>
      keyPress(String(getWindowId()), getDisplay(), key, { modifier }),
    keyPressMultiple: (key, count = 1, modifier = null, delayMs = 50) =>
      keyPressMultiple(String(getWindowId()), getDisplay(), key, {
        count,
        modifier,
        delayMs,
      }),
    type: (...args) => {
      let [startAndEndWithEnter, ...texts] =
        typeof args[0] === 'boolean' ? args : [true, ...args];
      return typeText(
        String(getWindowId()),
        getDisplay(),
        texts.map(String),
        startAndEndWithEnter,
      );
    },
    rotate: (direction) =>
      rotate(String(getWindowId()), getDisplay(), direction),
    isTyping: () => getIsTyping(),

    // --- Mouse Click Functions (Async with 100ms delay) ---
    leftClick: async (x, y, position = 'bottomRight') => {
      const windowId = String(getWindowId());
      const state = getState();

      // Game world coordinates only
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!gameWorld || !tileSize || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform game left-click: missing region data or player position`,
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
          `[Lua/${scriptName}] Cannot perform game left-click: invalid coordinates`,
        );
        return false;
      }
      mouseController.leftClick(
        parseInt(windowId),
        clickCoords.x,
        clickCoords.y,
        getDisplay(),
      );
      await wait(100); // 100ms delay after click
      return true;
    },

    // --- New Absolute Click Functions (Async with 100ms delay) ---
    leftClickAbsolute: async (x, y) => {
      const windowId = String(getWindowId());
      mouseController.leftClick(parseInt(windowId), x, y, getDisplay());
      await wait(100); // 100ms delay after click
      return true;
    },

    rightClickAbsolute: async (x, y) => {
      const windowId = String(getWindowId());
      mouseController.rightClick(parseInt(windowId), x, y, getDisplay());
      await wait(100); // 100ms delay after click
      return true;
    },

    rightClick: async (x, y, position = 'bottomRight') => {
      const windowId = String(getWindowId());
      const state = getState();

      // Game world coordinates only
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!gameWorld || !tileSize || !playerPos) {
        logger(
          'warn',
          `[Lua/${scriptName}] Cannot perform game right-click: missing region data or player position`,
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
          `[Lua/${scriptName}] Cannot perform game right-click: invalid coordinates`,
        );
        return false;
      }
      mouseController.rightClick(
        parseInt(windowId),
        clickCoords.x,
        clickCoords.y,
        getDisplay(),
      );
      await wait(100); // 100ms delay after click
      return true;
    },

    // --- Minimap Click Function (Async with 100ms delay) ---
    mapClick: async (x, y, position = 'center') => {
      const windowId = String(getWindowId());
      const state = getState();

      // Minimap coordinates
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
      await wait(100); // 100ms delay after click
      return true;
    },

    // --- Drag Functions (Async with 100ms delay) ---
    drag: async (startX, startY, endX, endY, button = 'left') => {
      const windowId = String(getWindowId());
      const state = getState();

      // Game world tile coordinates
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

      // Use bottomRight as default position for both start and end
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

      // Move to start position
      mouseController.mouseMove(
        parseInt(windowId),
        startCoords.x,
        startCoords.y,
        getDisplay(),
      );
      await wait(50);

      // Press button down
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

      // Move to end position
      mouseController.mouseMove(
        parseInt(windowId),
        endCoords.x,
        endCoords.y,
        getDisplay(),
      );
      await wait(100);

      // Release button
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

      // Direct window coordinates without translation
      mouseController.mouseMove(
        parseInt(windowId),
        startX,
        startY,
        getDisplay(),
      );
      await wait(50);

      // Press button down
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

      // Move to end position
      mouseController.mouseMove(parseInt(windowId), endX, endY, getDisplay());
      await wait(100);

      // Release button
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

    // --- Helper Functions for Tile Movement ---
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

      // Calculate relative position from game world origin
      const relX = screenX - gameWorld.x;
      const relY = screenY - gameWorld.y;

      // Convert to tile coordinates
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

    // --- Chat Tab Functions ---
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
      await wait(100); // 100ms delay after click
      return true;
    },

    // --- Bot Control Functions ---
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
        `[Lua/${scriptName}] Healing (rules) ${enabled ? 'enabled' : 'disabled'}`,
      );
    },
    setCavebot: (enabled) => {
      context.postStoreUpdate('cavebot/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Cavebot ${enabled ? 'enabled' : 'disabled'}`,
      );
    },
    setScripts: (enabled) => {
      context.postStoreUpdate('lua/setenabled', !!enabled);
      logger(
        'info',
        `[Lua/${scriptName}] Scripts ${enabled ? 'enabled' : 'disabled'}`,
      );
    },

    // --- Login Function ---
    login: async (email, password, character) => {
      const windowId = String(getWindowId());
      const display = getDisplay();
      let state = getState();

      console.log('[LOGIN] === LOGIN FUNCTION STARTED ===');

      // 1. Check if we are already online
      if (state.regionCoordinates?.regions?.onlineMarker) {
        console.log('[LOGIN] Player already online - skipping login');
        logger(
          'info',
          `[Lua/${scriptName}] Player is already online, skipping login`,
        );
        return false;
      }

      // 2. Initial Modal Cleanup: Check for and close any pop-up modals
      console.log('[LOGIN] Starting initial modal cleanup...');
      const modalsToClose = [
        { name: 'pleaseWaitModal' },
        { name: 'ipChangedModal' },
        { name: 'wrongPasswordModal' },
        { name: 'connectionLostModal' },
        { name: 'connectionFailedModal' },
        { name: 'warningModal' },
      ];

      let closedAModal;
      do {
        closedAModal = false;
        state = getState(); // Refresh state before each check
        const regions = state.regionCoordinates?.regions;

        if (regions) {
          for (const modalInfo of modalsToClose) {
            const modal = regions[modalInfo.name];
            // Check for 'ok', 'close', or 'abort' buttons
            const button =
              modal?.children?.abort ||
              modal?.children?.close ||
              modal?.children?.ok;

            if (button?.x && button?.y) {
              console.log(`[LOGIN] Found and closing '${modalInfo.name}'`);
              logger('info', `[Lua/${scriptName}] Closing '${modalInfo.name}'`);
              if (modalInfo.name === 'ipChangedModal') {
                await keyPress(windowId, display, 'Escape');
                await wait(100);
                await keyPress(windowId, display, 'Escape');
                await wait(400);
              } else {
                mouseController.leftClick(
                  parseInt(windowId),
                  button.x,
                  button.y,
                  display,
                );
                await wait(500);
              } // Wait for the modal to disappear
              closedAModal = true;
              break; // Restart the loop to get fresh state
            }
          }
        }
      } while (closedAModal);
      console.log('[LOGIN] Modal cleanup finished.');

      // 3. Check if we are already at the character selection screen
      state = getState(); // Get the latest state after cleanup
      let selectCharacterModal =
        state.regionCoordinates?.regions?.selectCharacterModal;

      if (selectCharacterModal) {
        console.log(
          '[LOGIN] Already at character selection screen, skipping login form.',
        );
        logger(
          'info',
          `[Lua/${scriptName}] Already at character selection, skipping login form.`,
        );
      } else {
        // 4. If not, proceed with the standard login form
        console.log(
          '[LOGIN] Login form required. Proceeding with credentials.',
        );
        logger(
          'info',
          `[Lua/${scriptName}] Starting login process for character: ${character}`,
        );

        const loginModal = state.regionCoordinates?.regions?.loginModal;
        if (!loginModal) {
          console.log('[LOGIN] ERROR: loginModal not found in state');
          logger('warn', `[Lua/${scriptName}] loginModal not found`);
          return false;
        }

        // Press escape to ensure login modal is focused
        await keyPress(windowId, display, 'Escape');
        await wait(100);

        // Type email
        const emailInput = loginModal.children?.emailInput;
        if (!emailInput) {
          console.log('[LOGIN] ERROR: emailInput not found');
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
        await typeText(windowId, display, [email], false);
        await wait(100);

        // Type password
        const passwordInput = loginModal.children?.passwordInput;
        if (!passwordInput) {
          console.log('[LOGIN] ERROR: passwordInput not found');
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
        await typeText(windowId, display, [password], false);
        await wait(100);

        // Press enter to submit login
        console.log('[LOGIN] Pressing Enter to submit login form');
        await keyPress(windowId, display, 'Enter');
        await wait(200);
      }

      // 5. Wait for and handle Character Selection
      console.log('[LOGIN] Checking for character selection modal...');
      let currentState = getState();
      selectCharacterModal =
        currentState.regionCoordinates?.regions?.selectCharacterModal;

      const maxWaitForModal = 10000;
      const modalCheckInterval = 500;
      let modalWaitTime = 0;

      // --- NEW ROBUST LOGIC ---
      // This flag ensures we don't fail prematurely before the connectingModal has a chance to appear.
      let connectingModalWasSeen = false;

      while (!selectCharacterModal && modalWaitTime < maxWaitForModal) {
        console.log(
          `[LOGIN] Waiting for modal... (${modalWaitTime}ms elapsed)`,
        );
        await wait(modalCheckInterval);
        modalWaitTime += modalCheckInterval;
        currentState = getState();

        const regions = currentState.regionCoordinates?.regions;
        selectCharacterModal = regions?.selectCharacterModal;
        const connectingModal = regions?.connectingModal;

        // First, check if the connecting modal is visible. If so, we "arm" our failure check.
        if (connectingModal) {
          connectingModalWasSeen = true;
        }

        // Now, check for the failure condition:
        // We have seen the connecting modal before, but now it's gone, and we are NOT at the character select screen.
        if (
          connectingModalWasSeen &&
          !connectingModal &&
          !selectCharacterModal
        ) {
          console.log(
            '[LOGIN] ERROR: Connecting modal disappeared without character selection. Aborting.',
          );
          logger(
            'warn',
            `[Lua/${scriptName}] Connection stalled or failed. Aborting login.`,
          );

          // Press escape 3 times to back out of the failed state
          for (let i = 0; i < 3; i++) {
            await keyPress(windowId, display, 'Escape');
            await wait(100);
          }
          return false; // Exit the function
        }
        // --- END OF NEW ROBUST LOGIC ---
      }

      if (!selectCharacterModal) {
        console.log(
          `[LOGIN] ERROR: selectCharacterModal not found after ${modalWaitTime}ms wait`,
        );
        logger(
          'warn',
          `[Lua/${scriptName}] selectCharacterModal not found after login attempt (waited ${modalWaitTime}ms)`,
        );
        return false;
      }

      console.log('[LOGIN] SUCCESS: Character selection modal found!');

      // 6. Get character selection data and find the target character
      const characterData = currentState.uiValues?.selectCharacterModal;
      if (!characterData || !characterData.characters) {
        console.log('[LOGIN] ERROR: No valid character data for selection');
        logger('warn', `[Lua/${scriptName}] No character data for selection`);
        return false;
      }

      let characters = characterData.characters;
      let characterNames = Object.keys(characters);
      const targetCharacterLower = character.toLowerCase();
      let targetCharacterFound = characterNames.find((name) =>
        name.toLowerCase().includes(targetCharacterLower),
      );

      // If character not found, try pressing the first letter
      if (!targetCharacterFound) {
        console.log(
          '[LOGIN] Target character not visible, trying first letter approach',
        );
        await keyPress(windowId, display, character[0].toUpperCase());
        await wait(500); // Wait for list to update

        // Refresh state and re-check
        currentState = getState();
        const updatedCharacterData =
          currentState.uiValues?.selectCharacterModal;
        if (updatedCharacterData && updatedCharacterData.characters) {
          characters = updatedCharacterData.characters;
          characterNames = Object.keys(characters);
          targetCharacterFound = characterNames.find((name) =>
            name.toLowerCase().includes(targetCharacterLower),
          );
        }
      }

      if (!targetCharacterFound) {
        console.log('[LOGIN] ERROR: Target character not found');
        logger(
          'warn',
          `[Lua/${scriptName}] Target character '${character}' not found in list`,
        );
        return false;
      }

      // 7. Click on the target character and log in
      const characterItem = characters[targetCharacterFound];
      if (!characterItem || !characterItem.position) {
        console.log(
          '[LOGIN] ERROR: Could not find target character coordinates',
        );
        logger(
          'warn',
          `[Lua/${scriptName}] Could not find coordinates for character '${targetCharacterFound}'`,
        );
        return false;
      }

      // Click on the character
      console.log(
        '[LOGIN] Clicking on target character:',
        targetCharacterFound,
      );
      mouseController.leftClick(
        parseInt(windowId),
        characterItem.position.x,
        characterItem.position.y,
        display,
      );
      await wait(100);

      // Press enter to select character
      console.log('[LOGIN] Pressing Enter to select character');
      await keyPress(windowId, display, 'Enter');

      // 8. Wait for login to complete (check if online)
      console.log('[LOGIN] Waiting for login completion...');
      const maxWaitTime = 10000;
      const checkInterval = 200;
      let elapsedTime = 0;

      while (elapsedTime < maxWaitTime) {
        await wait(checkInterval);
        elapsedTime += checkInterval;
        const finalState = getState();
        if (!!finalState.regionCoordinates?.regions?.onlineMarker) {
          console.log('[LOGIN] SUCCESS: Login completed, player is online!');
          logger(
            'info',
            `[Lua/${scriptName}] Login successful, player is online`,
          );
          return true;
        }
      }

      console.log(
        `[LOGIN] ERROR: Login timeout, player did not come online within ${maxWaitTime / 1000} seconds`,
      );
      logger(
        'warn',
        `[Lua/${scriptName}] Login timeout, player did not come online`,
      );
      return false;
    },
  };

  let navigationApi = {};
  if (type === 'cavebot') {
    // For CAVEBOT, use the direct function references passed from the worker.
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
        if (waypoints[nextIndex])
          context.postStoreUpdate('cavebot/setwptId', waypoints[nextIndex].id);
      },
      goToLabel: (label) => {
        const state = getState();
        const targetWpt = state.cavebot.waypointSections[
          state.cavebot.currentSection
        ]?.waypoints.find((wp) => wp.label === label);
        if (targetWpt)
          context.postStoreUpdate('cavebot/setwptId', targetWpt.id);
      },
      goToSection: (sectionName) => {
        const state = getState();
        const foundEntry = Object.entries(state.cavebot.waypointSections).find(
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
        const waypoints =
          state.cavebot.waypointSections[state.cavebot.currentSection]
            ?.waypoints || [];
        if (arrayIndex < waypoints.length)
          context.postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
      },
      pauseActions: (paused) =>
        context.postStoreUpdate('cavebot/setActionPaused', !!paused),
    };
  }

  const api = { ...baseApi, ...navigationApi };
  const stateObject = createStateShortcutObject(getState, type);

  // --- [ROBUST FIX] ---
  // Wrap the API with a proxy to track active async calls for safe shutdown.
  const asyncApiFunctionSet = new Set(asyncFunctionNames);
  const apiProxy = new Proxy(api, {
    get(target, prop, receiver) {
      const originalMember = target[prop];

      // Intercept calls to functions that are registered as asynchronous.
      if (
        typeof originalMember === 'function' &&
        asyncApiFunctionSet.has(prop)
      ) {
        return async (...args) => {
          if (onAsyncStart) {
            onAsyncStart(); // Signal that an async operation has started.
          }
          try {
            return await originalMember.apply(target, args);
          } finally {
            if (onAsyncEnd) {
              onAsyncEnd(); // Signal that the async operation has finished.
            }
          }
        };
      }

      // For non-async functions or other properties, pass them through.
      return Reflect.get(target, prop, receiver);
    },
  });

  return { api: apiProxy, asyncFunctionNames, stateObject };
};
