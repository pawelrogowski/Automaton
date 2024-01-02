import { app } from 'electron';
import { createWindow } from './createWindow.js';
import './colorPicker.js';
import './monitoring.js';

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
