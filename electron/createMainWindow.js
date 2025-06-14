import { BrowserWindow, app, Tray, Menu, dialog, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

import { selectWindow } from './menus/windowSelection.js';
import { loadRulesFromFile, saveRulesToFile } from './rulesManager.js';
import { toggleNotifications } from '../frontend/redux/slices/globalSlice.js';
import store from './store.js';

const HTML_PATH = '../dist/index.html';

let mainWindow;
let tray;
let isNotificationEnabled = false;
let shouldClose = false;
let isTrayVisible = true;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const ICON_PATHS = {
  white: path.join(dirname, './icons/white_dot.png'),
  green: path.join(dirname, './icons/green_dot.png'),
  red: path.join(dirname, './icons/red_dot.png'),
  app: path.join(dirname, './icons/automaton.png'),
};

const updateTrayIcon = () => {
  if (!tray) return;

  const state = store.getState().global;
  let iconPath;

  if (!state.windowId) {
    iconPath = ICON_PATHS.white;
  } else {
    iconPath = state.isBotEnabled ? ICON_PATHS.green : ICON_PATHS.red;
  }

  const icon = nativeImage.createFromPath(iconPath);
  tray.setImage(icon);
};


export const toggleTrayVisibility = () => {
  isTrayVisible = !isTrayVisible;
  if (isTrayVisible) {
    createTray();
  } else {
    tray.destroy();
    tray = null;
  }
  Menu.setApplicationMenu(buildAppMenu());
};

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
    {
      label: isTrayVisible ? 'Hide Tray' : 'Show Tray',
      click: toggleTrayVisibility,
    },
    { type: 'separator' },
    { label: 'Close', click: closeAppFromTray },
  ]);

/**
 * Builds the application menu.
 * @returns {Electron.Menu} The built menu
 */
const buildAppMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Show/Hide', click: toggleMainWindowVisibility },
        { type: 'separator' },
        { label: 'Select Window', click: async () => await selectWindow() },

        { type: 'separator' },
        { label: 'Load Settings', click: loadRulesFromFile },
        { label: 'Save Settings', click: saveRulesToFile },
        { type: 'separator' },
        { label: 'Close', click: closeAppFromTray },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Notifications',
          type: 'checkbox',
          checked: isNotificationEnabled,
          click: () => store.dispatch(toggleNotifications()),
        },
        {
          label: isTrayVisible ? 'Hide Tray' : 'Show Tray',
          click: toggleTrayVisibility,
        },
      ],
    },
  ];

  if (process.env.NODE_ENV !== 'production') {
    template.push({
      label: 'Developer',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
    });
  }

  return Menu.buildFromTemplate(template);
};

const createTray = () => {
  const state = store.getState().global;
  let initialIconPath = ICON_PATHS.white;
  if (state.windowId) {
    initialIconPath = state.isBotEnabled ? ICON_PATHS.green : ICON_PATHS.red;
  }

  tray = new Tray(initialIconPath);
  tray.setToolTip('Click to show/hide the bot');
  tray.setContextMenu(buildTrayContextMenu());

  tray.on('click', toggleMainWindowVisibility);
};


const handleWindowClose = async (event) => {
  if (event) event.preventDefault();
  if (!shouldClose) {
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
      app.exit(0);
    }
  }
};

const closeAppFromTray = async () => {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    title: 'Confirm',
    message: 'Are you sure you want to quit the application?',
    cancelId: 1,
  });
  if (response === 0) {
    app.exit(0);
  }
};

export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    minWidth: 1200,
    minHeight: 640,
    height: 640,
    width: 1200,
    resizable: false,
    icon: ICON_PATHS.app,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(dirname, '/preload.js') },
  });

  mainWindow.webContents.openDevTools();

  mainWindow.loadURL(`file://${path.join(dirname, HTML_PATH)}`).catch((err) => console.error('Failed to load URL:', err));

  mainWindow.on('closed', async () => {
    mainWindow = null;
    app.exit();
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    createTray();
    Menu.setApplicationMenu(buildAppMenu());
  });

  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
  });

  mainWindow.on('close', handleWindowClose);

  app.on('window-all-closed', async () => {
    app.exit();
  });
};


export const toggleMainWindowVisibility = () => {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
};

store.subscribe(() => {
  const { notificationsEnabled, windowId, isBotEnabled } = store.getState().global;
  isNotificationEnabled = notificationsEnabled;

  if (tray) {
    tray.setContextMenu(buildTrayContextMenu());
    updateTrayIcon();
  }

  // Update the application menu
  Menu.setApplicationMenu(buildAppMenu());
});

export const getMainWindow = () => mainWindow;