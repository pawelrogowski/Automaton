import { app, ipcMain, dialog } from 'electron';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import path from 'path';
import { createMainWindow, getMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import { showNotification } from './notificationHandler.js';
import setupAppMenu from './menus/setupAppMenu.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './globalShortcuts.js';

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);

let ScreenMonitor = null;
let HealingWorker = null;
let prevWindowId = null;
let mainWindow = getMainWindow;

const userDataPath = app.getPath('userData');
const autoLoadFilePath = path.join(userDataPath, 'autoLoadRules.json');

app.commandLine.appendSwitch('inspect', 'true');
app.commandLine.appendSwitch('inspect-brk', '9222');

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId } = global;

  // forward state to healing worker
  if (ScreenMonitor) {
    ScreenMonitor.postMessage(state);
  }

  // reset all workers on windowId change
  if (windowId !== prevWindowId) {
    if (ScreenMonitor) {
      ScreenMonitor.terminate();
      ScreenMonitor = null;
    }
    if (HealingWorker) {
      HealingWorker.terminate();
      HealingWorker = null;
    }
  }

  // Start a new worker with the updated state.
  if (!ScreenMonitor && windowId) {
    const statCheckPath = resolve(cwd, './workers', 'screenMonitor.js');
    ScreenMonitor = new Worker(statCheckPath, { name: 'screeenMonitor.js' });
    console.log('screen monitor started from main.js');
    ScreenMonitor.on('message', (message) => {
      if (message.type) {
        setGlobalState(`gameState/${message.type}`, message.payload);
      } else {
        setGlobalState('gameState/setCharacterStatus', message.payload);
      }
    });
    ScreenMonitor.on('error', (error) => {
      console.error('An error occurred in the worker:', error);
      console.log('Restarting the worker...');
      ScreenMonitor.terminate();
      ScreenMonitor = null;
      store.dispatch({ type: 'SET_WINDOW_ID', payload: windowId }); // Dispatch an action to trigger the worker restart
    });
    ScreenMonitor.postMessage(state);
  }

  // if (!HealingWorker && state) {
  //   const healingPath = resolve(cwd, './workers', 'healing.js');
  //   HealingWorker = new Worker(healingPath, { name: 'HealingWorker' });
  //   console.log('Healing processor started from main.js');
  //   HealingWorker.on('error', (error) => {
  //     console.error('An error occurred in the worker:', error);
  //     console.log('Restarting the worker...');
  //     HealingWorker.terminate();
  //     HealingWorker = null;
  //     store.dispatch({ type: 'SET_STATE', payload: state }); // Dispatch an action to trigger the worker restart
  //   });
  //   HealingWorker.postMessage(state);
  // }

  prevWindowId = windowId;
});

export const resetWorkers = () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  if (HealingWorker) {
    HealingWorker.terminate();
    HealingWorker = null;
  }
};

const saveRulesToFile = () => {
  const rules = store.getState().healing;
  // Minimize the main window
  if (mainWindow) mainWindow.minimize();

  dialog
    .showSaveDialog({
      title: 'Save Rules',
      filters: [{ extensions: ['json'] }],
    })
    .then((result) => {
      if (!result.canceled && result.filePath) {
        // Check if the file path ends with .json, if not, append it
        const filePath = result.filePath.endsWith('.json')
          ? result.filePath
          : `${result.filePath}.json`;
        fs.writeFileSync(filePath, JSON.stringify(rules, null, 2));
        // Show notification with the file name
        showNotification('Automaton', `📥 Saved | ${path.basename(filePath)}`);
      }
      // Restore the main window
      if (mainWindow) mainWindow.restore();
    })
    .catch((err) => {
      console.error('Failed to save rules:', err);
      // Show notification for error
      showNotification('Automaton', '❌ Failed to save rules');
      // Restore the main window in case of error
      if (mainWindow) mainWindow.restore();
    });
};

const loadRulesFromFile = () => {
  // Minimize the main window
  if (mainWindow) mainWindow.minimize();

  return dialog
    .showOpenDialog({
      title: 'Load Rules',
      filters: [{ extensions: ['json'] }],
      properties: ['openFile'],
    })
    .then((result) => {
      if (!result.canceled && result.filePaths.length > 0) {
        const content = fs.readFileSync(result.filePaths[0], 'utf8');
        const loadedRules = JSON.parse(content);
        store.dispatch({ type: 'healing/loadRules', payload: loadedRules }); // Dispatch action to update state with loaded rules
        setGlobalState('healing/loadRules', loadedRules); // Notify the renderer process
        // Show notification with the file name
        showNotification('Automaton', `📤 Loaded | ${path.basename(result.filePaths[0])}`);
      }
      // Restore the main window
      if (mainWindow) mainWindow.restore();
    })
    .catch((err) => {
      console.error('Failed to load rules:', err);
      // Show notification for error
      showNotification('Automaton', '❌ Failed to load rules');
      // Restore the main window in case of error
      if (mainWindow) mainWindow.restore();
    });
};
const autoSaveRules = () => {
  try {
    const rules = store.getState().healing;
    fs.writeFileSync(autoLoadFilePath, JSON.stringify(rules, null, 2));
    console.log('Rules saved successfully');
  } catch (error) {
    console.error('Failed to save rules:', error);
  }
};

const autoLoadRules = () => {
  if (fs.existsSync(autoLoadFilePath)) {
    const content = fs.readFileSync(autoLoadFilePath, 'utf8');
    const loadedRules = JSON.parse(content);
    store.dispatch({ type: 'healing/loadRules', payload: loadedRules });
    setGlobalState('healing/loadRules', loadedRules);
    console.log('Rules loaded successfully:', loadedRules);
  }
};

ipcMain.on('save-rules', saveRulesToFile);
ipcMain.handle('load-rules', loadRulesFromFile);
ipcMain.on('renderer-ready', (event) => {
  autoLoadRules();
});

app.whenReady().then(() => {
  mainWindow = createMainWindow();
  setupAppMenu(null);
  registerGlobalShortcuts();
});

app.on('before-quit', () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  if (HealingWorker) {
    HealingWorker.terminate();
    HealingWorker = null;
  }
  autoSaveRules();
});

app.on('will-quit', () => {
  unregisterGlobalShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
