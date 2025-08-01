import { globalShortcut } from 'electron';
import setGlobalState from './setGlobalState.js';
import { getMainWindow } from './createMainWindow.js';

import { showNotification } from './notificationHandler.js';
import debounce from 'lodash/debounce.js';
import store from './store.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { createLogger } from './utils/logger.js';

const log = createLogger();
const debounceTime = 25;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let windId = '';
let isBotEnabled = false;
let previousSectionStates = {};
let windowName = '';

store.subscribe(() => {
  const state = store.getState();
  const { global, rules, cavebot, lua, targeting } = state; // Destructure all relevant slices
  windId = global.windowId;
  isBotEnabled = global.isBotEnabled;
  previousSectionStates = global.previousSectionStates;
  windowName = global.windowName;

  // Log warnings if any slice is undefined, but don't prevent access
  if (!rules)
    log(
      'warn',
      '[Global Shortcuts] rules slice is undefined in store.getState()',
    );
  if (!cavebot)
    log(
      'warn',
      '[Global Shortcuts] cavebot slice is undefined in store.getState()',
    );
  if (!lua)
    log(
      'warn',
      '[Global Shortcuts] lua slice is undefined in store.getState()',
    );
  if (!targeting)
    log(
      'warn',
      '[Global Shortcuts] targeting slice is undefined in store.getState()',
    );
});

const soundCache = new Map();

export const playSound = (filePath) => {
  const asarPath = path.join(__dirname, 'sounds', filePath);
  if (soundCache.has(filePath)) {
    const cachedPath = soundCache.get(filePath);
    exec(`aplay '${cachedPath}'`);
  } else {
    const tempDir = path.join(os.tmpdir(), 'automaton-sounds');
    const tempFilePath = path.join(tempDir, filePath);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(asarPath, tempFilePath);
    soundCache.set(filePath, tempFilePath);
    exec(`aplay '${tempFilePath}'`);
  }
};

const getNotificationTitle = () => `Automaton - ${windowName}`;

const debouncedToggleisBotEnabled = debounce(() => {
  setGlobalState('global/toggleisBotEnabled');
  const status = isBotEnabled ? 'Disabled' : 'Enabled';
  showNotification(`Bot: ${status}`, getNotificationTitle());
  playSound(isBotEnabled ? 'disable.wav' : 'enable.wav');
}, debounceTime);

const debouncedToggleMainWindowVisibility = debounce(() => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  }
}, debounceTime);

const switchToPreset = debounce((presetIndex) => {
  setGlobalState('rules/setActivePresetIndex', presetIndex);
}, debounceTime);

const toggleSection = (sectionName, setEnabledAction) => {
  const state = store.getState();
  const currentEnabledState = state[sectionName]?.enabled ?? false;
  const newEnabledState = !currentEnabledState; // This is the state it will become

  console.log(
    `[DEBUG] Toggling ${sectionName}: current=${currentEnabledState}, new=${newEnabledState}, action=${setEnabledAction}`,
  );

  setGlobalState(setEnabledAction, newEnabledState); // Dispatch the action with the new state

  showNotification(
    `${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)}: ${newEnabledState ? 'Enabled' : 'Disabled'}`, // Use newEnabledState for notification
    getNotificationTitle(),
  );
};

const debouncedToggleCavebot = debounce(
  () => toggleSection('cavebot', 'cavebot/setenabled'),
  debounceTime,
);
const debouncedToggleHealing = debounce(
  () => toggleSection('rules', 'rules/setenabled'),
  debounceTime,
);
const debouncedToggleScripts = debounce(
  () => toggleSection('lua', 'lua/setenabled'),
  debounceTime,
);
const debouncedToggleTargeting = debounce(
  () => toggleSection('targeting', 'targeting/setenabled'),
  debounceTime,
);

const debouncedToggleAllSections = debounce(() => {
  const state = store.getState();
  const allSections = {
    rules: state.rules?.enabled ?? false,
    cavebot: state.cavebot?.enabled ?? false,
    lua: state.lua?.enabled ?? false,
    targeting: state.targeting?.enabled ?? false,
  };

  const allEnabled = Object.values(allSections).every(Boolean);
  const allDisabled = Object.values(allSections).every((val) => !val);

  if (allEnabled) {
    // If all are enabled, disable all and store current states
    setGlobalState('global/setPreviousSectionStates', allSections);
    setGlobalState('rules/setenabled', false);
    setGlobalState('cavebot/setenabled', false);
    setGlobalState('lua/setenabled', false);
    setGlobalState('targeting/setenabled', false);
    showNotification('All sections disabled', getNotificationTitle());
  } else if (allDisabled) {
    // If all are disabled, restore previous states
    const restoredStates = previousSectionStates;
    setGlobalState('rules/setenabled', restoredStates.rules);
    setGlobalState('cavebot/setenabled', restoredStates.cavebot);
    setGlobalState('lua/setenabled', restoredStates.lua);
    setGlobalState('targeting/setenabled', restoredStates.targeting);
    showNotification(
      'Restored previous section states',
      getNotificationTitle(),
    );
  } else {
    // If mixed, disable all and store current states
    setGlobalState('global/setPreviousSectionStates', allSections);
    setGlobalState('rules/setenabled', false);
    setGlobalState('cavebot/setenabled', false);
    setGlobalState('lua/setenabled', false);
    setGlobalState('targeting/setenabled', false);
    showNotification(
      'Mixed states detected, all sections disabled',
      getNotificationTitle(),
    );
  }
}, debounceTime);

const debouncedToggleEverything = debounce(() => {
  const state = store.getState();
  const allSections = {
    rules: state.rules?.enabled ?? false,
    cavebot: state.cavebot?.enabled ?? false,
    lua: state.lua?.enabled ?? false,
    targeting: state.targeting?.enabled ?? false,
  };

  const allEnabled = Object.values(allSections).every(Boolean);
  const allDisabled = Object.values(allSections).every((val) => !val);

  if (!allEnabled) {
    // If not all enabled (mixed or all disabled), enable all
    setGlobalState('rules/setenabled', true);
    setGlobalState('cavebot/setenabled', true);
    setGlobalState('lua/setenabled', true);
    setGlobalState('targeting/setenabled', true);
    showNotification('All sections enabled', getNotificationTitle());
  } else {
    // If all are enabled, disable all
    setGlobalState('rules/setenabled', false);
    setGlobalState('cavebot/setenabled', false);
    setGlobalState('lua/setenabled', false);
    setGlobalState('targeting/setenabled', false);
    showNotification('All sections disabled', getNotificationTitle());
  }
}, debounceTime);

export const registerGlobalShortcuts = () => {
  try {
    if (globalShortcut.isRegistered('Alt+E')) {
      log('info', '[Global Shortcuts] already registered, skipping.');
      return;
    }
    log('info', '[Global Shortcuts] registering');
    globalShortcut.register('Alt+E', debouncedToggleisBotEnabled);
    globalShortcut.register('Alt+V', debouncedToggleMainWindowVisibility);

    globalShortcut.register('Alt+Escape', debouncedToggleAllSections);
    globalShortcut.register('Alt+C', debouncedToggleCavebot);
    globalShortcut.register('Alt+H', debouncedToggleHealing);
    globalShortcut.register('Alt+S', debouncedToggleScripts);
    globalShortcut.register('Alt+T', debouncedToggleTargeting);
    globalShortcut.register('Alt+B', debouncedToggleEverything);

    for (let i = 0; i < 5; i++) {
      const presetKey = `Alt+${i + 1}`;
      const debouncedSwitchToPreset = debounce(
        () => switchToPreset(i),
        debounceTime,
      );
      globalShortcut.register(presetKey, debouncedSwitchToPreset);
    }
    log('info', '[Global Shortcuts] registered');
  } catch (error) {
    log('error', `[Global Shortcuts] registration error: ${error}`);
  }
};

export const unregisterGlobalShortcuts = () => {
  try {
    log('info', '[Global Shortcuts] unregistering all');
    globalShortcut.unregisterAll();
  } catch (error) {
    log('error', `[Global Shortcuts] unregistration error: ${error}`);
  }
};
