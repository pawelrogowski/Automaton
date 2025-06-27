import store from './store.js';
import { getMainWindow } from './createMainWindow.js';

/**
 * A centralized function to update the main process Redux store
 * and broadcast the change to the renderer process.
 * @param {string} type - The action type (e.g., 'cavebot/setEnabled').
 * @param {*} payload - The action payload.
 */
function setGlobalState(type, payload) {
  const mainWindow = getMainWindow();

  const action = {
    type,
    payload,
    origin: 'backend', // Mark this action as originating from the main process
  };

  // 1. Dispatch the action to the main process store.
  store.dispatch(action);

  // 2. Broadcast the action to the renderer window so its store can sync.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update', action);
  }
}

export default setGlobalState;
