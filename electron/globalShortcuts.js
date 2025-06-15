import { globalShortcut } from 'electron';
import { selectActiveWindow } from './menus/windowSelection.js';
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
let isEnabled = false;

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId, isBotEnabled } = global;
  windId = windowId;
  isEnabled = isBotEnabled;
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

const debouncedSelectActiveWindow = debounce(() => {
  selectActiveWindow();
  setTimeout(() => {
    showNotification(`🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedToggleisBotEnabled = debounce(() => {
  setGlobalState('global/toggleisBotEnabled');
  if (isEnabled) {
    showNotification('🟢 Enabled');
    playSound('enable.wav');
  } else {
    showNotification('🔴 Disabled');
    playSound('disable.wav');
  }
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

export const registerGlobalShortcuts = () => {
  try {
    log('info', '[Global Shortcuts] registering');
    globalShortcut.register('Alt+W', debouncedSelectActiveWindow);
    globalShortcut.register('Alt+E', debouncedToggleisBotEnabled);
    globalShortcut.register('Alt+V', debouncedToggleMainWindowVisibility);

    for (let i = 0; i < 5; i++) {
      const presetKey = `Alt+${i + 1}`;
      const debouncedSwitchToPreset = debounce(() => switchToPreset(i), debounceTime);
      globalShortcut.register(presetKey, debouncedSwitchToPreset);
    }
    log('info', '[Global Shortcuts] registered');
  } catch (error) {
    log('error', `[Global Shortcuts] ${error}`);
  }
};

export const unregisterGlobalShortcuts = () => {
  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    log('error', `[Global Shortcuts] ${error}`);
  }
};
