import { BrowserWindow, app, Tray, Menu } from 'electron';
import path from 'path';
import url, { fileURLToPath } from 'url';

let mainWindow;
let tray;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    icon: path.join(dirname, './skull.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
    autoHideMenuBar: true,
    // frame: false,
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

  // Create a tray icon
  tray = new Tray(path.join(dirname, './icons/skull.png'));
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });

  const trayContextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Hide', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: 'Close', click: () => app.quit() },
  ]);

  tray.setContextMenu(trayContextMenu);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });
};

export const getMainWindow = () => mainWindow;
