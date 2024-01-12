import { BrowserWindow, app } from 'electron';
import path from 'path';
import url, { fileURLToPath } from 'url';

let mainWindow;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
  });

  mainWindow.webContents.openDevTools();

  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(dirname, '../dist/index.html'),
      protocol: 'file:',
      slashes: true,
    });

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (process.platform !== 'darwin') {
      process.kill(0);
      app.quit();
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });
};

export const getMainWindow = () => mainWindow;
