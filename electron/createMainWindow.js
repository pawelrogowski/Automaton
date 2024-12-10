import { BrowserWindow, app, Tray, Menu, dialog, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetWorkers } from './main.js';
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
  white: path.join(dirname, './icons/whiteSkull.png'),
  green: path.join(dirname, './icons/greenSkull.png'),
  red: path.join(dirname, './icons/redSkull.png'),
  app: path.join(dirname, './icons/automaton.png'),
};

/**
 * Updates the tray icon based on the current state
 */
const updateTrayIcon = () => {
  if (!tray) return;

  const state = store.getState().global;
  let iconPath;

  if (!state.windowId) {
    iconPath = ICON_PATHS.white;
  } else {
    iconPath = state.botEnabled ? ICON_PATHS.green : ICON_PATHS.red;
  }

  const icon = nativeImage.createFromPath(iconPath);
  tray.setImage(icon);
};

/**
 * Toggles the visibility of the tray icon.
 */
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
        { label: 'Select Window', click: selectWindow },
        { label: 'Reset Engine', click: resetWorkers },
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

/**
 * Creates and sets up the system tray.
 */
const createTray = () => {
  const state = store.getState().global;
  let initialIconPath = ICON_PATHS.white;
  if (state.windowId) {
    initialIconPath = state.botEnabled ? ICON_PATHS.green : ICON_PATHS.red;
  }

  tray = new Tray(initialIconPath);
  tray.setToolTip('Click to show/hide the bot');
  tray.setContextMenu(buildTrayContextMenu());

  // Add left-click event handler
  tray.on('click', toggleMainWindowVisibility);
};

/**
 * Handles the window close event.
 * @param {Electron.Event} event - The close event
 */
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

/**
 * Creates the main application window.
 */
export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    // height: 641,
    // width: 780,
    // maxWidth: 780,
    // minWidth: 780,
    // minHeight: 641,
    icon: ICON_PATHS.app,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',

    devTools: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
    alwaysOnTop: true,
    transparent: false,
  });

  // if (process.env.NODE_ENV !== 'production') {
  //   mainWindow.webContents.openDevTools();
  // }

  mainWindow
    .loadURL(`file://${path.join(dirname, HTML_PATH)}`)
    .catch((err) => console.error('Failed to load URL:', err));

  createTray();
  Menu.setApplicationMenu(buildAppMenu());

  mainWindow.on('closed', async () => {
    mainWindow = null;
    app.exit();
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
  });

  mainWindow.on('close', handleWindowClose);

  app.on('window-all-closed', async () => {
    app.exit();
  });
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
  const { notificationsEnabled, windowId, botEnabled } = store.getState().global;
  isNotificationEnabled = notificationsEnabled;

  if (tray) {
    tray.setContextMenu(buildTrayContextMenu());
    updateTrayIcon();
  }

  // Update the application menu
  Menu.setApplicationMenu(buildAppMenu());
});
