import { BrowserWindow } from 'electron';
import path from 'path';
import url, { fileURLToPath } from 'url';

let mainWindow;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
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
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });
};

export const getMainWindow = () => mainWindow;

process.on('message', (message) => {
  console.log('Received message:', message);
});
