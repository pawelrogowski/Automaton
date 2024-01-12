import { app } from 'electron';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
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
let prevWindowId = null;

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const windowId = global; // Make sure to access the windowId property

  // If a worker exists and a new windowId is set, terminate the existing worker.
  if (StatCheckWorker && windowId !== prevWindowId) {
    StatCheckWorker.terminate();
    StatCheckWorker = null;
  }

  // Start a new worker with the updated state.
  if (!StatCheckWorker && windowId) {
    const statCheckPath = resolve(cwd, './workers', 'statCheck.js');
    StatCheckWorker = new Worker(statCheckPath, { name: 'StatCheckWorker' });
    StatCheckWorker.on('message', (message) => {
      if (message.type === 'setHealthPercent') {
        setGlobalState('gameState/setHealthPercent', message.payload);
      } else if (message.type === 'setManaPercent') {
        setGlobalState('gameState/setManaPercent', message.payload);
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

  prevWindowId = windowId;
});
