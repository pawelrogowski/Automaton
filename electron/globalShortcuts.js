import { globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';
import setGlobalState from './setGlobalState.js';
import { getMainWindow, toggleTrayVisibility } from './createMainWindow.js';
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
const debounceTime = 25;

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

const debouncedToggleTrayVisibility = debounce(() => {
  toggleTrayVisibility();
  const isTrayVisible = store.getState().global.isTrayVisible; // Assuming you store this in your global state
  if (isTrayVisible) {
    showNotification('👁️ Tray Icon Visible');
    playSound('trayShow.wav'); // You'll need to add this sound file
  } else {
    showNotification('🙈 Tray Icon Hidden');
    playSound('trayHide.wav'); // You'll need to add this sound file
  }
}, debounceTime);

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

const debouncedCyclePresetsNext = debounce(() => {
  setGlobalState('healing/cyclePresets', 'next');
}, debounceTime);

const debouncedCyclePresetsPrevious = debounce(() => {
  setGlobalState('healing/cyclePresets', 'previous');
}, debounceTime);

const switchToPreset = debounce((presetIndex) => {
  setGlobalState('healing/setActivePresetIndex', presetIndex);
}, debounceTime);

const debouncedSwitchToPreset1 = debounce(() => switchToPreset(0), debounceTime);
const debouncedSwitchToPreset2 = debounce(() => switchToPreset(1), debounceTime);
const debouncedSwitchToPreset3 = debounce(() => switchToPreset(2), debounceTime);
const debouncedSwitchToPreset4 = debounce(() => switchToPreset(3), debounceTime);
const debouncedSwitchToPreset5 = debounce(() => switchToPreset(4), debounceTime);

export const registerGlobalShortcuts = () => {
  try {
    globalShortcut.register('Alt+W', debouncedSelectActiveWindow);
    globalShortcut.register('Alt+Shift+W', debouncedSelectWindow);
    globalShortcut.register('Alt+E', debouncedToggleBotEnabled);
    globalShortcut.register('Alt+V', debouncedToggleMainWindowVisibility);
    globalShortcut.register('Alt+M', debouncedToggleManaSync);
    globalShortcut.register('Alt+T', debouncedToggleTrayVisibility);
    globalShortcut.register('Alt+,', debouncedCyclePresetsPrevious);
    globalShortcut.register('Alt+.', debouncedCyclePresetsNext);
    globalShortcut.register('Alt+F1', debouncedSwitchToPreset1);
    globalShortcut.register('Alt+F2', debouncedSwitchToPreset2);
    globalShortcut.register('Alt+F3', debouncedSwitchToPreset3);
    globalShortcut.register('Alt+F4', debouncedSwitchToPreset4);
    globalShortcut.register('Alt+F5', debouncedSwitchToPreset5);
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
