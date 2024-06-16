import { BrowserWindow, app, Tray, Menu, dialog } from 'electron';
import path from 'path';
import url, { fileURLToPath } from 'url';
import { resetWorkers } from './main.js';
import { selectWindow } from './menus/windowSelection.js';
import { loadRulesFromFile, saveRulesToFile } from './rulesManager.js';
import { toggleNotifications } from '../src/redux/slices/globalSlice.js';
import store from './store.js';

let mainWindow;
let tray;
let notiEnabled = false;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { notificationsEnabled } = global;
  notiEnabled = notificationsEnabled;
});

export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    minWidth: 700,
    minHeight: 42,
    x: 0,
    y: 0,
    icon: path.join(dirname, './skull.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
    autoHideMenuBar: true,
    alwaysOnTop: true,
    transparent: false,
    // frame: false,
  });

  // Open the developer tools for debugging
  mainWindow.webContents.openDevTools();

  mainWindow.loadURL(
    url.format({
      pathname: path.join(dirname, '../dist/index.html'),
      protocol: 'file:',
      slashes: true,
    }),
  );

  tray = new Tray(path.join(dirname, './icons/skull.png'));

  const trayContextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      },
    },

    { type: 'separator' },
    { label: 'Select Window', click: () => selectWindow() },
    { label: 'Reset Engine', click: () => resetWorkers() },
    { type: 'separator' },
    { label: 'Load Settings', click: () => loadRulesFromFile() },
    { label: 'Save Settings', click: () => saveRulesToFile() },
    { type: 'separator', label: 'save/load' },
    {
      label: 'Notifications',
      type: 'checkbox',
      checked: notiEnabled,
      click: () => store.dispatch(toggleNotifications()),
    },
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

  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
  });

  let shouldClose = false;
  mainWindow.on('close', (event) => {
    if (!shouldClose) {
      event.preventDefault();
      const options = {
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 1,
        title: 'Confirm',
        message: 'Are you sure you want to quit the application?',
        cancelId: 1,
      };

      dialog.showMessageBox(mainWindow, options).then((response) => {
        if (response.response === 0) {
          shouldClose = true;
          app.quit();
        }
      });
    }
  });
};

export const toggleMainWindowVisibility = () => {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
};

export const getMainWindow = () => mainWindow;
