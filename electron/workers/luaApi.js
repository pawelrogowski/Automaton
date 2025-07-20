import { keyPress, keyPressMultiple, type as typeText, rotate, getIsTyping } from '../keyboardControll/keyPress.js';
import mouseController from 'mouse-controller';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import { wait } from './exposedLuaFunctions.js';
import { setActionPaused, setenabled as setCavebotEnabled } from '../../frontend/redux/slices/cavebotSlice.js';
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
  Object.defineProperty(shortcuts, 'hppc', { get: () => getState().gameState?.hppc, enumerable: true });
  Object.defineProperty(shortcuts, 'mppc', { get: () => getState().gameState?.mppc, enumerable: true });
  Object.defineProperty(shortcuts, 'isChatOff', { get: () => getState().gameState?.isChatOff, enumerable: true });
  Object.defineProperty(shortcuts, 'monsterNum', { get: () => getState().gameState?.monsterNum, enumerable: true });
  Object.defineProperty(shortcuts, 'partyNum', { get: () => getState().gameState?.partyNum, enumerable: true });
  Object.defineProperty(shortcuts, 'isTyping', { get: () => getState().gameState?.isTyping, enumerable: true });
  Object.defineProperty(shortcuts, 'isOnline', { get: () => !!getState().regionCoordinates?.regions?.onlineMarker, enumerable: true });
  Object.defineProperty(shortcuts, 'activeTab', {
    get: () => getState().uiValues?.chatboxTabs?.activeTab || 'unknown',
    enumerable: true,
  });

  // --- Action Items Getters ---
  Object.defineProperty(shortcuts, 'actionItems', {
    get: () => {
      const hotkeyBarChildren = getState().regionCoordinates?.regions?.hotkeyBar?.children || {};
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

  // --- Bot Control State Variables ---
  Object.defineProperty(shortcuts, '$healing', { get: () => getState().rules?.enabled, enumerable: true });
  Object.defineProperty(shortcuts, '$targeting', { get: () => getState().targeting?.enabled, enumerable: true });
  Object.defineProperty(shortcuts, '$cavebot', { get: () => getState().cavebot?.enabled, enumerable: true });
  Object.defineProperty(shortcuts, '$scripts', { get: () => getState().lua?.enabled, enumerable: true });

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
  const asyncFunctionNames = [
    'wait',
    'keyPress',
    'keyPressMultiple',
    'type',
    'rotate',
    'leftClick',
    'rightClick',
    'mapClick',
    'drag',
    'dragAbsolute',
    'focusTab',
    'login',
  ];
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

    // --- Mouse Click Functions (Async with 100ms delay) ---
    leftClick: async (x, y, position = 'bottomRight') => {
      const windowId = String(getWindowId());
      const state = getState();

      // Game world coordinates only
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!gameWorld || !tileSize || !playerPos) {
        logger('warn', `[Lua/${scriptName}] Cannot perform game left-click: missing region data or player position`);
        return false;
      }
      const clickCoords = getAbsoluteGameWorldClickCoordinates(x, y, playerPos, gameWorld, tileSize, position);
      if (!clickCoords) {
        logger('warn', `[Lua/${scriptName}] Cannot perform game left-click: invalid coordinates`);
        return false;
      }
      mouseController.leftClick(parseInt(windowId), clickCoords.x, clickCoords.y);
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
        logger('warn', `[Lua/${scriptName}] Cannot perform game right-click: missing region data or player position`);
        return false;
      }
      const clickCoords = getAbsoluteGameWorldClickCoordinates(x, y, playerPos, gameWorld, tileSize, position);
      if (!clickCoords) {
        logger('warn', `[Lua/${scriptName}] Cannot perform game right-click: invalid coordinates`);
        return false;
      }
      mouseController.rightClick(parseInt(windowId), clickCoords.x, clickCoords.y);
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
        logger('warn', `[Lua/${scriptName}] Cannot perform minimap click: missing region data or player position`);
        return false;
      }
      const clickCoords = getAbsoluteClickCoordinates(x, y, playerPos, minimapRegionDef);
      if (!clickCoords) {
        logger('warn', `[Lua/${scriptName}] Cannot perform minimap click: invalid coordinates`);
        return false;
      }
      mouseController.leftClick(parseInt(windowId), clickCoords.x, clickCoords.y);
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
        logger('warn', `[Lua/${scriptName}] Cannot perform drag: missing region data or player position`);
        return false;
      }

      // Use bottomRight as default position for both start and end
      const startCoords = getAbsoluteGameWorldClickCoordinates(startX, startY, playerPos, gameWorld, tileSize, 'bottomRight');
      const endCoords = getAbsoluteGameWorldClickCoordinates(endX, endY, playerPos, gameWorld, tileSize, 'bottomRight');

      if (!startCoords || !endCoords) {
        logger('warn', `[Lua/${scriptName}] Cannot perform drag: invalid coordinates`);
        return false;
      }

      // Move to start position
      mouseController.mouseMove(parseInt(windowId), startCoords.x, startCoords.y);
      await wait(50);

      // Press button down
      if (button === 'right') {
        mouseController.rightMouseDown(parseInt(windowId), startCoords.x, startCoords.y);
      } else {
        mouseController.mouseDown(parseInt(windowId), startCoords.x, startCoords.y);
      }
      await wait(100);

      // Move to end position
      mouseController.mouseMove(parseInt(windowId), endCoords.x, endCoords.y);
      await wait(100);

      // Release button
      if (button === 'right') {
        mouseController.rightMouseUp(parseInt(windowId), endCoords.x, endCoords.y);
      } else {
        mouseController.mouseUp(parseInt(windowId), endCoords.x, endCoords.y);
      }
      await wait(100);

      return true;
    },

    dragAbsolute: async (startX, startY, endX, endY, button = 'left') => {
      const windowId = String(getWindowId());

      // Direct window coordinates without translation
      mouseController.mouseMove(parseInt(windowId), startX, startY);
      await wait(50);

      // Press button down
      if (button === 'right') {
        mouseController.rightMouseDown(parseInt(windowId), startX, startY);
      } else {
        mouseController.mouseDown(parseInt(windowId), startX, startY);
      }
      await wait(100);

      // Move to end position
      mouseController.mouseMove(parseInt(windowId), endX, endY);
      await wait(100);

      // Release button
      if (button === 'right') {
        mouseController.rightMouseUp(parseInt(windowId), endX, endY);
      } else {
        mouseController.mouseUp(parseInt(windowId), endX, endY);
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
        logger('warn', `[Lua/${scriptName}] Cannot convert tile to coordinate: missing region data`);
        return null;
      }

      const coords = getAbsoluteGameWorldClickCoordinates(tileX, tileY, playerPos, gameWorld, tileSize, position);
      return coords ? { x: coords.x, y: coords.y } : null;
    },

    coordinateToTile: (screenX, screenY) => {
      const state = getState();
      const gameWorld = state.regionCoordinates?.regions?.gameWorld;
      const tileSize = state.regionCoordinates?.regions?.tileSize;
      const playerPos = state.gameState?.playerMinimapPosition;

      if (!gameWorld || !tileSize || !playerPos) {
        logger('warn', `[Lua/${scriptName}] Cannot convert coordinate to tile: missing region data`);
        return null;
      }

      // Calculate relative position from game world origin
      const relX = screenX - gameWorld.x;
      const relY = screenY - gameWorld.y;

      // Convert to tile coordinates
      const tileX = Math.floor(relX / tileSize.width) + playerPos.x - Math.floor(gameWorld.width / tileSize.width / 2);
      const tileY = Math.floor(relY / tileSize.height) + playerPos.y - Math.floor(gameWorld.height / tileSize.height / 2);

      return { x: tileX, y: tileY };
    },

    // --- Chat Tab Functions ---
    focusTab: async (tabName) => {
      const state = getState();
      const tabs = state.uiValues?.chatboxTabs?.tabs;

      if (!tabs || !tabName) {
        logger('warn', `[Lua/${scriptName}] Cannot focus tab: missing tab data or tab name`);
        return false;
      }

      const tab = tabs[tabName];
      if (!tab || !tab.tabPosition) {
        logger('warn', `[Lua/${scriptName}] Cannot focus tab: tab "${tabName}" not found or missing position`);
        return false;
      }

      const windowId = String(getWindowId());
      const { x, y } = tab.tabPosition;

      mouseController.leftClick(parseInt(windowId), x, y);
      await wait(100); // 100ms delay after click
      return true;
    },

    // --- Bot Control Functions ---
    setTargeting: (enabled) => {
      context.postStoreUpdate('targeting/setenabled', !!enabled);
      logger('info', `[Lua/${scriptName}] Targeting ${enabled ? 'enabled' : 'disabled'}`);
    },
    setHealing: (enabled) => {
      context.postStoreUpdate('rules/setenabled', !!enabled);
      logger('info', `[Lua/${scriptName}] Healing (rules) ${enabled ? 'enabled' : 'disabled'}`);
    },
    setCavebot: (enabled) => {
      context.postStoreUpdate('cavebot/setenabled', !!enabled);
      logger('info', `[Lua/${scriptName}] Cavebot ${enabled ? 'enabled' : 'disabled'}`);
    },
    setScripts: (enabled) => {
      context.postStoreUpdate('lua/setenabled', !!enabled);
      logger('info', `[Lua/${scriptName}] Scripts ${enabled ? 'enabled' : 'disabled'}`);
    },

    // --- Login Function ---
    login: async (email, password, character) => {
      const windowId = String(getWindowId());
      const state = getState();

      console.log('[LOGIN] === LOGIN FUNCTION STARTED ===');
      console.log('[LOGIN] Window ID:', windowId);
      console.log('[LOGIN] Target character:', character);
      console.log('[LOGIN] Email provided:', email ? 'Yes' : 'No');
      console.log('[LOGIN] Initial state keys:', Object.keys(state || {}));
      console.log('[LOGIN] Region coordinates available:', !!state.regionCoordinates);
      console.log('[LOGIN] Online marker status:', !!state.regionCoordinates?.regions?.onlineMarker);

      // 1. Check if we are online
      if (state.regionCoordinates?.regions?.onlineMarker) {
        console.log('[LOGIN] Player already online - skipping login');
        logger('info', `[Lua/${scriptName}] Player is already online, skipping login`);
        return false;
      }

      console.log('[LOGIN] Player not online - proceeding with login');
      logger('info', `[Lua/${scriptName}] Starting login process for character: ${character}`);

      // 2. Check if loginModal is visible
      const loginModal = state.regionCoordinates?.regions?.loginModal;
      console.log('[LOGIN] Login modal found:', !!loginModal);
      if (loginModal) {
        console.log('[LOGIN] Login modal position:', {
          x: loginModal.x,
          y: loginModal.y,
          width: loginModal.width,
          height: loginModal.height,
        });
        console.log('[LOGIN] Login modal children:', Object.keys(loginModal.children || {}));
      }

      if (!loginModal) {
        console.log('[LOGIN] ERROR: loginModal not found in state');
        logger('warn', `[Lua/${scriptName}] loginModal not found`);
        return false;
      }

      // 3. Press escape to ensure login modal is focused
      console.log('[LOGIN] Pressing Escape to focus login modal');
      await keyPress(windowId, 'Escape');
      await wait(100);

      // 4. Click on email input and type email
      const emailInput = loginModal.children?.emailInput;
      console.log('[LOGIN] Email input found:', !!emailInput);
      if (emailInput) {
        console.log('[LOGIN] Email input position:', { x: emailInput.x, y: emailInput.y });
      }

      if (!emailInput) {
        console.log('[LOGIN] ERROR: emailInput not found');
        logger('warn', `[Lua/${scriptName}] emailInput not found`);
        return false;
      }

      console.log('[LOGIN] Clicking email input field');
      mouseController.leftClick(parseInt(windowId), emailInput.x, emailInput.y);
      await wait(50);
      console.log('[LOGIN] Typing email:', email);
      await typeText(windowId, [email], false);
      await wait(100);

      // 5. Click on password input and type password
      const passwordInput = loginModal.children?.passwordInput;
      console.log('[LOGIN] Password input found:', !!passwordInput);
      if (passwordInput) {
        console.log('[LOGIN] Password input position:', { x: passwordInput.x, y: passwordInput.y });
      }

      if (!passwordInput) {
        console.log('[LOGIN] ERROR: passwordInput not found');
        logger('warn', `[Lua/${scriptName}] passwordInput not found`);
        return false;
      }

      console.log('[LOGIN] Clicking password input field');
      mouseController.leftClick(parseInt(windowId), passwordInput.x, passwordInput.y);
      await wait(50);
      console.log('[LOGIN] Typing password (hidden)');
      await typeText(windowId, [password], false);
      await wait(100);

      // 6. Press enter to submit login
      console.log('[LOGIN] Pressing Enter to submit login form');
      await keyPress(windowId, 'Enter');
      console.log('[LOGIN] Waiting 2 seconds for login processing...');
      await wait(200);

      // 7. Wait for and check if selectCharacterModal is visible
      // Refresh state after login submission
      console.log('[LOGIN] Checking for character selection modal...');
      let currentState = getState();
      let selectCharacterModal = currentState.regionCoordinates?.regions?.selectCharacterModal;
      console.log('[LOGIN] Initial character modal check:', !!selectCharacterModal);

      // Wait up to 10 seconds for the character selection modal to appear
      const maxWaitForModal = 10000;
      const modalCheckInterval = 500;
      let modalWaitTime = 0;

      console.log('[LOGIN] Starting wait loop for character modal...');
      while (!selectCharacterModal && modalWaitTime < maxWaitForModal) {
        console.log(`[LOGIN] Waiting for modal... (${modalWaitTime}ms elapsed)`);
        await wait(modalCheckInterval);
        modalWaitTime += modalCheckInterval;
        currentState = getState();
        selectCharacterModal = currentState.regionCoordinates?.regions?.selectCharacterModal;
        console.log(`[LOGIN] Modal check after ${modalWaitTime}ms:`, !!selectCharacterModal);
      }

      if (!selectCharacterModal) {
        console.log(`[LOGIN] ERROR: selectCharacterModal not found after ${modalWaitTime}ms wait`);
        logger('warn', `[Lua/${scriptName}] selectCharacterModal not found after login attempt (waited ${modalWaitTime}ms)`);
        // Press escape 3 times and stop
        for (let i = 0; i < 3; i++) {
          await keyPress(windowId, 'Escape');
          await wait(100);
        }
        return false;
      }

      console.log('[LOGIN] SUCCESS: Character selection modal found!');
      console.log('[LOGIN] Modal details:', {
        x: selectCharacterModal.x,
        y: selectCharacterModal.y,
        width: selectCharacterModal.width,
        height: selectCharacterModal.height,
      });

      // 8. Get character selection data
      console.log('[LOGIN] Retrieving character selection data...');
      const characterData = currentState.uiValues?.selectCharacterModal;
      console.log('[LOGIN] Character data found:', !!characterData);
      console.log('[LOGIN] Character data structure:', characterData);

      if (!characterData || !characterData.characters) {
        console.log('[LOGIN] ERROR: No valid character data for selection');
        logger('warn', `[Lua/${scriptName}] No character data for selection`);
        // Press escape 3 times and stop
        for (let i = 0; i < 3; i++) {
          await keyPress(windowId, 'Escape');
          await wait(100);
        }
        return false;
      }

      // 9. Check if target character is available
      let characters = characterData.characters;
      let characterNames = Object.keys(characters);
      const targetCharacterLower = character.toLowerCase();
      console.log('[LOGIN] Available characters:', characterNames);
      console.log('[LOGIN] Target character (lowercase):', targetCharacterLower);

      let targetCharacterFound = characterNames.find((name) => name.toLowerCase().includes(targetCharacterLower));
      console.log('[LOGIN] Target character found initially:', !!targetCharacterFound);

      if (!targetCharacterFound) {
        console.log('[LOGIN] Target character not visible, trying first letter approach');
        logger('info', `[Lua/${scriptName}] Target character not visible, trying first letter: ${character[0]}`);

        // Press first letter of character name
        console.log('[LOGIN] Pressing first letter:', character[0].toUpperCase());
        await keyPress(windowId, character[0].toUpperCase());
        await wait(500);

        // Refresh state after pressing first letter
        let updatedState = getState();
        let updatedCharacterData = updatedState.uiValues?.selectCharacterModal;

        // Wait for state to update after pressing first letter
        const maxWaitForUpdate = 3000;
        const updateCheckInterval = 200;
        let updateWaitTime = 0;

        console.log('[LOGIN] Starting wait loop for character data update...');
        while ((!updatedCharacterData || !updatedCharacterData.characters) && updateWaitTime < maxWaitForUpdate) {
          console.log(`[LOGIN] Waiting for character data update... (${updateWaitTime}ms elapsed)`);
          await wait(updateCheckInterval);
          updateWaitTime += updateCheckInterval;
          updatedState = getState();
          updatedCharacterData = updatedState.uiValues?.selectCharacterModal;
          console.log(`[LOGIN] Character data check after ${updateWaitTime}ms:`, !!updatedCharacterData?.characters);
        }

        if (updatedCharacterData && updatedCharacterData.characters) {
          characters = updatedCharacterData.characters;
          characterNames = Object.keys(characters);
          console.log('[LOGIN] Updated available characters:', characterNames);

          targetCharacterFound = characterNames.find((name) => name.toLowerCase().includes(targetCharacterLower));
          console.log('[LOGIN] Target character found after first letter:', !!targetCharacterFound);

          if (!targetCharacterFound) {
            console.log('[LOGIN] ERROR: Target character still not visible after first letter');
            logger('warn', `[Lua/${scriptName}] Target character still not visible after first letter`);
            // Press escape 3 times and stop
            for (let i = 0; i < 3; i++) {
              await keyPress(windowId, 'Escape');
              await wait(100);
            }
            return false;
          }

          console.log('[LOGIN] SUCCESS: Target character found after first letter press');
        } else {
          console.log(`[LOGIN] ERROR: No character data available after first letter (waited ${updateWaitTime}ms)`);
          logger('warn', `[Lua/${scriptName}] No character data after first letter (waited ${updateWaitTime}ms)`);
          // Press escape 3 times and stop
          for (let i = 0; i < 3; i++) {
            await keyPress(windowId, 'Escape');
            await wait(100);
          }
          return false;
        }
      } else {
        console.log('[LOGIN] SUCCESS: Target character found in initial character data');
      }

      // 10. Click on the target character
      const characterItem = characters[targetCharacterFound];
      console.log('[LOGIN] Target character details:', characterItem);

      if (!characterItem || !characterItem.position) {
        console.log('[LOGIN] ERROR: Could not find target character coordinates');
        logger('warn', `[Lua/${scriptName}] Could not find target character coordinates`);
        // Press escape 3 times and stop
        for (let i = 0; i < 3; i++) {
          await keyPress(windowId, 'Escape');
          await wait(100);
        }
        return false;
      }

      // Click on the character
      console.log('[LOGIN] Clicking on target character at coordinates:', {
        x: characterItem.position.x,
        y: characterItem.position.y,
      });
      mouseController.leftClick(parseInt(windowId), characterItem.position.x, characterItem.position.y);
      await wait(100);

      // Press enter to select character
      console.log('[LOGIN] Pressing Enter to select character');
      await keyPress(windowId, 'Enter');

      // 11. Wait for login to complete (check if online)
      console.log('[LOGIN] Waiting for login completion...');
      const maxWaitTime = 5000;
      const checkInterval = 100;
      let elapsedTime = 0;

      console.log('[LOGIN] Starting wait loop for online status...');
      while (elapsedTime < maxWaitTime) {
        await wait(checkInterval);
        elapsedTime += checkInterval;

        const currentState = getState();
        const isOnline = !!currentState.regionCoordinates?.regions?.onlineMarker;
        console.log(`[LOGIN] Online check after ${elapsedTime}ms:`, isOnline);

        if (isOnline) {
          console.log('[LOGIN] SUCCESS: Login completed, player is online!');
          logger('info', `[Lua/${scriptName}] Login successful, player is online`);
          return true;
        }
      }

      console.log('[LOGIN] ERROR: Login timeout, player did not come online within 5 seconds');
      logger('warn', `[Lua/${scriptName}] Login timeout, player did not come online`);
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
    };
  }

  const finalApi = { ...baseApi, ...navigationApi };
  const stateObject = createStateShortcutObject(getState, type);

  return { api: finalApi, asyncFunctionNames, stateObject };
};
