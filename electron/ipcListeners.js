import { ipcMain } from 'electron';
import store from './store.js';

ipcMain.on('state-change', (_, serializedAction) => {
  try {
    const action = JSON.parse(serializedAction);
    if (action.origin === 'renderer') {
      store.dispatch(action);
    }
  } catch (error) {
    console.error('Error dispatching action in main process:', error);
  }
});
