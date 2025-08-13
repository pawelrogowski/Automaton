import store from './store.js';
import {
  getMainWindow,
  getWidgetWindow,
} from '../windows/createMainWindow.js';

let actionQueue = [];
let isScheduled = false;

function sendBatch() {
  if (actionQueue.length === 0) {
    isScheduled = false;
    return;
  }

  const mainWindow = getMainWindow();
  const widgetWindow = getWidgetWindow();
  const batch = [...actionQueue];
  actionQueue = [];

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update-batch', batch);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('state-update-batch', batch);
  }

  isScheduled = false;
}

function scheduleBatch() {
  if (!isScheduled) {
    isScheduled = true;
    // Defer batch sending until the main thread is idle.
    // requestIdleCallback is ideal, but not always available in all Node.js/Electron versions.
    // setTimeout(0) is a reliable fallback.
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(sendBatch, { timeout: 100 }); // 100ms timeout to ensure it runs
    } else {
      setTimeout(sendBatch, 0);
    }
  }
}

/**
 * A centralized function to update the main process Redux store
 * and broadcast the change to the renderer process.
 * @param {string} type - The action type (e.g., 'cavebot/setEnabled').
 * @param {*} payload - The action payload.
 */
function setGlobalState(type, payload) {
  const action = {
    type,
    payload,
    origin: 'backend',
  };

  // 1. Dispatch the action to the main process store immediately.
  store.dispatch(action);

  // 2. Queue the action to be sent to the renderer in a batch.
  actionQueue.push(action);
  scheduleBatch();
}

export default setGlobalState;
