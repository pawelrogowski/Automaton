import { app, ipcMain, dialog } from 'electron';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import { createMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import './colorPicker/colorPicker.js';
import './screenMonitor/monitoring.js';
import setupAppMenu from './menus/setupAppMenu.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);

app.whenReady().then(() => {
  createMainWindow();
  setupAppMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    process.kill(-process.pid);
    app.quit();
  }
});

let StatCheckWorker = null;
let HealingWorker = null;
let prevWindowId = null;

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId } = global;

  // forward state to healing worker
  if (HealingWorker) {
    HealingWorker.postMessage(state);
  }

  // reset all workers on windowId change
  if (windowId !== prevWindowId) {
    if (StatCheckWorker) {
      StatCheckWorker.terminate();
      StatCheckWorker = null;
    }
    if (HealingWorker) {
      HealingWorker.terminate();
      HealingWorker = null;
    }
  }

  // Start a new worker with the updated state.
  if (!StatCheckWorker && windowId) {
    const statCheckPath = resolve(cwd, './workers', 'statsMonitor.js');
    StatCheckWorker = new Worker(statCheckPath, { name: 'StatCheckWorker' });
    console.log('HpMp monitor started from main.js');
    StatCheckWorker.on('message', (message) => {
      if (message.type === 'setHealthPercent') {
        setGlobalState('gameState/setHealthPercent', message.payload);
        store.dispatch({ type: 'gameState/setHealthPercent', payload: message.payload });
      } else if (message.type === 'setManaPercent') {
        setGlobalState('gameState/setManaPercent', message.payload);
      }
      if (message.type) {
        setGlobalState(`gameState/${message.type}`, message.payload);
        store.dispatch({ type: `gameState/${message.type}`, payload: message.payload });
      }
    });
    StatCheckWorker.on('error', (error) => {
      console.error('An error occurred in the worker:', error);
      console.log('Restarting the worker...');
      StatCheckWorker.terminate();
      StatCheckWorker = null;
      store.dispatch({ type: 'SET_WINDOW_ID', payload: windowId }); // Dispatch an action to trigger the worker restart
    });
    StatCheckWorker.postMessage(state);
  }

  if (!HealingWorker && state) {
    const healingPath = resolve(cwd, './workers', 'healing.js');
    HealingWorker = new Worker(healingPath, { name: 'HealingWorker' });
    console.log('Healing processor started from main.js');
    HealingWorker.on('error', (error) => {
      console.error('An error occurred in the worker:', error);
      console.log('Restarting the worker...');
      HealingWorker.terminate();
      HealingWorker = null;
      store.dispatch({ type: 'SET_STATE', payload: state }); // Dispatch an action to trigger the worker restart
    });
    HealingWorker.postMessage(state);
  }

  prevWindowId = windowId;
});

const saveRulesToFile = () => {
  const rules = store.getState().healing; // Assuming 'healing' is the slice of state where rules are stored
  dialog
    .showSaveDialog({
      title: 'Save Rules',
      filters: [{ extensions: ['json'] }],
    })
    .then((result) => {
      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, JSON.stringify(rules, null, 2));
      }
    })
    .catch((err) => {
      console.error('Failed to save rules:', err);
    });
};

// Function to load rules from a file
const loadRulesFromFile = () => {
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
      }
    })
    .catch((err) => {
      console.error('Failed to load rules:', err);
    });
};

ipcMain.on('save-rules', saveRulesToFile);
ipcMain.handle('load-rules', loadRulesFromFile);
