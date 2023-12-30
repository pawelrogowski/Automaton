const { app } = require('electron');
const { createWindow } = require('./createWindow.js');
require('./colorPicker.js');
require('./monitoring.js');

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
