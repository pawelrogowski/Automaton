import { ipcMain } from 'electron';
import store from './store.js';

// listen for state-change in renderer
ipcMain.on('state-change', (event, serializedAction) => {
  try {
    const action = JSON.parse(serializedAction);
    if (action.origin === 'renderer') {
      store.dispatch(action);
    }
  } catch (error) {
    console.error('Error dispatching action in main process:', error);
  }
});
