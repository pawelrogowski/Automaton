import { app, BrowserWindow, ipcMain } from 'electron';
import { createWindow } from './createWindow.js';
import mainStore from './mainStore.js';
import './colorPicker/colorPicker.js';
import './screenMonitor/monitoring.js';
import setupAppMenu from './menus/appMenu.js';

app.whenReady().then(() => {
  createWindow();
  setupAppMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    process.kill(-process.pid);
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('state-change', (event, serializedAction) => {
  try {
    const action = JSON.parse(serializedAction);
    if (action.origin === 'renderer') {
      mainStore.dispatch(action);
    }
  } catch (error) {
    console.error('Error dispatching action in main process:', error);
  }
});

mainStore.subscribe(() => {
  const state = mainStore.getState();
  const { lastAction } = state;
  console.log('??????????????????????????????', state, lastAction);
  if (lastAction && lastAction.payload.origin === 'main') {
    console.log('sending dispatch from main');
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('state-update', JSON.stringify(lastAction));
    });
  }
});

// ipcMain.on('gameState/setManaPercent', (event, action) => {
//   mainStore.dispatch(action);
// });
