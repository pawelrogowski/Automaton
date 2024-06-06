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
import autoLoot from './autoLoot/autoLoot.js';
import { getMouseLocation } from './screenMonitor/utils/getMouseLocation.js';
import { setSquareBottomRight, setSquareTopLeft } from '../src/redux/slices/globalSlice.js';

const { debounce } = pkg;
const debounceTime = 75;

let windId = '';
let windTitle = '';
let isEnabled = false;
let antiIdleOn = false;

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId, botEnabled, antiIdleEnabled } = global;
  windId = windowId;
  isEnabled = botEnabled;
  antiIdleOn = antiIdleEnabled;
});

const soundCache = new Map();

const playSound = (filePath) => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

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
      console.log(`stdout: ${stdout}`);
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
      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
    });
  }
};

const debouncedUpdateSquareTopLeft = debounce(async () => {
  try {
    const { x: mouseX, y: mouseY, windowId } = await getMouseLocation();
    if (windowId === store.getState().global.windowId) {
      store.dispatch(setSquareTopLeft({ x: mouseX, y: mouseY }));
    }
  } catch (error) {
    console.error('Failed to update top left square with mouse position:', error);
  }
}, debounceTime);

const debouncedUpdateSquareBottomRight = debounce(async () => {
  try {
    const { x: mouseX, y: mouseY, windowId } = await getMouseLocation();
    if (windowId === store.getState().global.windowId) {
      store.dispatch(setSquareBottomRight({ x: mouseX, y: mouseY }));
    }
  } catch (error) {
    console.error('Failed to update top right square with mouse position:', error);
  }
}, debounceTime);

const debouncedSelectActiveWindow = debounce(() => {
  console.log('Alt+0 shortcut clicked');
  resetWorkers();
  selectActiveWindow();
  setTimeout(() => {
    showNotification('Automaton', `🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedSelectWindow = debounce(() => {
  console.log('Alt+Shift+0 shortcut clicked');
  selectWindow();
  setTimeout(() => {
    showNotification('Automaton', `🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedToggleBotEnabled = debounce(() => {
  console.log('Alt+1 shortcut clicked');
  setGlobalState('global/toggleBotEnabled');
  console.log(isEnabled);
  if (isEnabled) {
    showNotification('Automaton', '🟢 Bot Enabled');

    playSound('enable.wav'); // Play the enable sound
  } else {
    showNotification('Automaton', '🔴 Bot Disabled');

    playSound('disable.wav'); // Play the disable sound
  }
}, debounceTime);

const debouncedToggleManaSync = debounce(() => {
  console.log('Alt+3 shortcut clicked');
  setGlobalState('healing/toggleManaSyncEnabled');
  // Access the current state to determine the manaSync rule's status
  const currentState = store.getState();
  const manaSyncRule = currentState.healing.find((rule) => rule.id === 'manaSync');
  const isManaSyncEnabled = manaSyncRule ? manaSyncRule.enabled : false;
  if (isManaSyncEnabled) {
    showNotification('Automaton', '🟢 Attack Sync Enabled');

    playSound('manaSyncEnable.wav'); // Play the enable sound
  } else {
    showNotification('Automaton', '🔴 Attack Sync Disabled');

    playSound('manaSyncDisable.wav'); // Play the disable sound
  }
}, debounceTime);

const debouncedToggleMainWindowVisibility = debounce(() => {
  console.log('Alt+2 shortcut clicked');
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

let currentSizeIndex = 0;
const sizes = [
  { width: 700, height: 333 },
  { width: 700, height: 72 },
  { width: 700, height: 41 },
  { width: 700, height: 72 },
];

const registerResizeShortcut = () => {
  try {
    globalShortcut.register('Alt+5', () => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        // Cycle through the sizes
        currentSizeIndex = (currentSizeIndex + 1) % sizes.length;
        const newSize = sizes[currentSizeIndex];
        mainWindow.setSize(newSize.width, newSize.height);
      }
    });
  } catch (error) {
    console.error('Failed to register resize shortcut:', error);
  }
};

export const registerGlobalShortcuts = () => {
  try {
    globalShortcut.register('Alt+0', debouncedSelectActiveWindow);
    globalShortcut.register('Alt+Shift+0', debouncedSelectWindow);
    globalShortcut.register('Alt+1', debouncedToggleBotEnabled);
    globalShortcut.register('Alt+2', debouncedToggleMainWindowVisibility);
    globalShortcut.register('Alt+3', debouncedToggleManaSync);
    globalShortcut.register('F8', () => autoLoot());
    globalShortcut.register('Alt+i', () => {
      store.dispatch(toggleAntiIdleEnabled());
    });
    globalShortcut.register('Alt+Q', debouncedUpdateSquareTopLeft);
    globalShortcut.register('Alt+C', debouncedUpdateSquareBottomRight);
    registerResizeShortcut();
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
