import { app, BrowserWindow } from 'electron';
import { createWindow } from './createWindow.js';
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
