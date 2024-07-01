import { BrowserWindow, app, Tray, Menu, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetWorkers } from './main.js';
import { selectWindow } from './menus/windowSelection.js';
import { loadRulesFromFile, saveRulesToFile } from './rulesManager.js';
import { toggleNotifications } from '../src/redux/slices/globalSlice.js';
import store from './store.js';

const MIN_WIDTH = 700;
const MIN_HEIGHT = 42;
const ICON_PATH = './icons/skull.png';
const HTML_PATH = '../dist/index.html';

let mainWindow;
let tray;
let isNotificationEnabled = false;
let shouldClose = false;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

/**
 * Builds the tray context menu dynamically.
 * @returns {Electron.Menu} The built menu
 */
const buildTrayContextMenu = () =>
  Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: toggleMainWindowVisibility,
    },
    { type: 'separator' },
    { label: 'Select Window', click: selectWindow },
    { label: 'Reset Engine', click: resetWorkers },
    { type: 'separator' },
    { label: 'Load Settings', click: loadRulesFromFile },
    { label: 'Save Settings', click: saveRulesToFile },
    { type: 'separator' },
    {
      label: 'Notifications',
      type: 'checkbox',
      checked: isNotificationEnabled,
      click: () => store.dispatch(toggleNotifications()),
    },
    { label: 'Close', click: () => app.quit() },
  ]);

/**
 * Creates and sets up the system tray.
 */
const createTray = () => {
  tray = new Tray(path.join(dirname, ICON_PATH));
  tray.setContextMenu(buildTrayContextMenu());
};

/**
 * Handles the window close event.
 * @param {Electron.Event} event - The close event
 */
const handleWindowClose = async (event) => {
  if (!shouldClose) {
    event.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Yes', 'No'],
      defaultId: 1,
      title: 'Confirm',
      message: 'Are you sure you want to quit the application?',
      cancelId: 1,
    });
    if (response === 0) {
      shouldClose = true;
      app.quit();
    }
  }
};

/**
 * Creates the main application window.
 */
export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    icon: path.join(dirname, ICON_PATH),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
    autoHideMenuBar: true,
    alwaysOnTop: true,
    transparent: false,
  });

  mainWindow.webContents.openDevTools();

  mainWindow
    .loadURL(`file://${path.join(dirname, HTML_PATH)}`)
    .catch((err) => console.error('Failed to load URL:', err));

  createTray();

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

  mainWindow.on('close', handleWindowClose);
};

/**
 * Toggles the visibility of the main window.
 */
export const toggleMainWindowVisibility = () => {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
};

/**
 * Returns the main window instance.
 * @returns {Electron.BrowserWindow|null} The main window instance
 */
export const getMainWindow = () => mainWindow;

// Subscribe to store changes
store.subscribe(() => {
  const { notificationsEnabled } = store.getState().global;
  isNotificationEnabled = notificationsEnabled;

  tray.setContextMenu(buildTrayContextMenu());
});
