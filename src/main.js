import { app, BrowserWindow } from 'electron';
import { createWindow } from './createWindow.js';
import './colorPicker.js';
import './monitoring.js';
import setupAppMenu from './menu/appMenu.js';

app.whenReady().then(() => {
  createWindow();
  setupAppMenu();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
