const { app, BrowserWindow, ipcMain } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');
const path = require('path');
const url = require('url');

let mainWindow;
let isHookRunning = false;

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

ipcMain.on('pick-pixel', (event) => {
  const mouseDownListener = (mouseEvent) => {
    console.log(mouseEvent);
    const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
    console.log(color);
    event.sender.send('pixel-picked', color);
    iohook.removeListener('mousedown', mouseDownListener); // remove the listener
    iohook.stop();
  };

  iohook.on('mousedown', mouseDownListener);
  iohook.start();
});

ipcMain.on('pick-pixel-stop', () => {
  iohook.stop();
});
