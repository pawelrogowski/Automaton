const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const robotjs = require('robotjs');
const iohook = require('iohook2');

let mainWindow;

app.allowRendererProcessReuse = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
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

ipcMain.on('start-color-picking', (event) => {
  iohook.on('mousedown', (mouseEvent) => {
    const color = robotjs.getPixelColor(mouseEvent.x, mouseEvent.y);
    event.sender.send('color-picked', color);
    iohook.stop();
  });
  iohook.start();
});

ipcMain.on('stop-color-picking', () => {
  iohook.stop();
});
