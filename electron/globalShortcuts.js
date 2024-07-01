import { globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';
import setGlobalState from './setGlobalState.js';
import { getMainWindow } from './createMainWindow.js';
import { resetWorkers } from './main.js';
import { showNotification } from './notificationHandler.js';
import pkg from 'lodash';
import store from './store.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';

const { debounce } = pkg;
const debounceTime = 75;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let windId = '';
let windTitle = '';
let isEnabled = false;

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId, botEnabled } = global;
  windId = windowId;
  isEnabled = botEnabled;
});

const soundCache = new Map();

const playSound = (filePath) => {
  const asarPath = path.join(__dirname, 'sounds', filePath);

  if (!fs.existsSync(asarPath)) {
    console.error(`Sound file not found in app.asar: ${asarPath}`);
    return;
  }

  if (soundCache.has(filePath)) {
    const cachedPath = soundCache.get(filePath);
    exec(`aplay '${cachedPath}'`, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return;
      }
      console.error(`stderr: ${stderr}`);
    });
  } else {
    const tempDir = path.join(os.tmpdir(), 'automaton-sounds');
    const tempFilePath = path.join(tempDir, filePath);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(asarPath, tempFilePath);

    soundCache.set(filePath, tempFilePath);

    exec(`aplay '${tempFilePath}'`, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return;
      }
      console.error(`stderr: ${stderr}`);
    });
  }
};

const debouncedSelectActiveWindow = debounce(() => {
  resetWorkers();
  selectActiveWindow();
  setTimeout(() => {
    showNotification(`🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedSelectWindow = debounce(() => {
  selectWindow();
  setTimeout(() => {
    showNotification(`🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedToggleBotEnabled = debounce(() => {
  setGlobalState('global/toggleBotEnabled');
  if (isEnabled) {
    showNotification('🟢 Bot Enabled');
    playSound('enable.wav');
  } else {
    showNotification('🔴 Bot Disabled');
    playSound('disable.wav');
  }
}, debounceTime);

const debouncedToggleManaSync = debounce(() => {
  setGlobalState('healing/toggleManaSyncEnabled');
  const currentState = store.getState();
  const manaSyncRule = currentState.healing.find((rule) => rule.id === 'manaSync');
  const isManaSyncEnabled = manaSyncRule ? manaSyncRule.enabled : false;
  if (isManaSyncEnabled) {
    showNotification('🟢 Attack Sync Enabled');
    playSound('manaSyncEnable.wav');
  } else {
    showNotification('🔴 Attack Sync Disabled');
    playSound('manaSyncDisable.wav');
  }
}, debounceTime);

const debouncedToggleMainWindowVisibility = debounce(() => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      showNotification('Automaton', '🙈 Hidden');
    } else {
      mainWindow.show();
    }
  }
}, debounceTime);

export const registerGlobalShortcuts = () => {
  try {
    globalShortcut.register('Alt+0', debouncedSelectActiveWindow);
    globalShortcut.register('Alt+Shift+0', debouncedSelectWindow);
    globalShortcut.register('Alt+1', debouncedToggleBotEnabled);
    globalShortcut.register('Alt+2', debouncedToggleMainWindowVisibility);
    globalShortcut.register('Alt+3', debouncedToggleManaSync);
  } catch (error) {
    console.error('Failed to register global shortcuts:', error);
  }
};

export const unregisterGlobalShortcuts = () => {
  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    console.error('Failed to unregister global shortcuts:', error);
  }
};
