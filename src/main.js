const { app, BrowserWindow, ipcMain } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');
const path = require('path');
const url = require('url');

let mainWindow;

app.allowRendererProcessReuse = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.openDevTools();

  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, '/../dist/index.html'),
      protocol: 'file:',
      slashes: true,
    });

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

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
robotjs.setMouseDelay(1);

ipcMain.handle('moveMouse', (event, x, y) => {
  robotjs.moveMouse(x, y);
});

ipcMain.handle('moveMouseSmooth', (event, x, y) => {
  robotjs.moveMouseSmooth(x, y);
});
ipcMain.handle('getMousePos', () => {
  return robotjs.getMousePos();
});

ipcMain.handle('mouseClick', (_, button, double) => {
  robotjs.mouseClick(button, double);
});

ipcMain.handle('mouseToggle', (_, down, button) => {
  robotjs.mouseToggle(down, button);
});

ipcMain.handle('dragMouse', (_, x, y) => {
  robotjs.dragMouse(x, y);
});

ipcMain.handle('scrollMouse', (_, x, y) => {
  robotjs.scrollMouse(x, y);
});

ipcMain.handle('getScreenSize', () => {
  return robotjs.getScreenSize();
});

ipcMain.handle('screenCapture', (_, x, y, width, height) => {
  return robotjs.screen.capture(x, y, width, height);
});

ipcMain.handle('start-iohook', () => {
  iohook.start();
});

ipcMain.handle('stop-iohook', () => {
  iohook.stop();
});

const listeners = {};

ipcMain.handle('registerListener', (event, eventName, id) => {
  listeners[id] = (e) => {
    event.sender.send(`${eventName}-${id}`, e);
  };
  iohook.on(eventName, listeners[id]);
});

ipcMain.handle('unregisterListener', (event, eventName, id) => {
  iohook.off(eventName, listeners[id]);
  delete listeners[id];
});
