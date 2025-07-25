// Automaton/electron/createMainWindow.js
import {
  app,
  ipcMain,
  BrowserWindow,
  Tray,
  Menu,
  dialog,
  nativeImage,
} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadRulesFromFile, saveRulesToFile } from './saveManager.js';
import { toggleNotifications } from '../frontend/redux/slices/globalSlice.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';

const HTML_PATH = '../dist/index.html';

let mainWindow;
let tray;
let isNotificationEnabled = false;
let isTrayVisible = true;
let widgetWindow = null; // Variable to hold the widget window instance

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

// Define paths relative to the script's directory
const WIDGET_HTML_PATH = path.join(dirname, 'widget', 'widget.html');
const WIDGET_PRELOAD_PATH = path.join(dirname, 'widget', 'preload.js');

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

const buildTrayContextMenu = () => {
  const state = store.getState().global;
  return Menu.buildFromTemplate([
    {
      label: state.windowName || 'Bot',
    },
    { type: 'separator' },
    {
      label: 'Show/Hide Main Window',
      click: toggleMainWindowVisibility,
    },
    {
      label: 'Show/Hide Controls Widget',
      click: toggleWidgetWindowVisibility,
    },
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
};

const buildAppMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Show/Hide Main Window', click: toggleMainWindowVisibility },
        {
          label: 'Show/Hide Controls Widget',
          click: toggleWidgetWindowVisibility,
        },
        { type: 'separator' },
        {
          label: 'Load Settings...',
          click: () => loadRulesFromFile(() => {}), // Pass no-op callback
          accelerator: 'CmdOrCtrl+O',
        },
        {
          label: 'Save Settings As...',
          click: () => saveRulesToFile(() => {}), // Pass no-op callback
          accelerator: 'CmdOrCtrl+S',
        },
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

  template.push({
    label: 'Developer',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
    ],
  });

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

const handleMainWindowClose = (event) => {
  event.preventDefault();
  app.quit();
};

const closeAppFromTray = () => {
  app.quit();
};

export const createMainWindow = (selectedWindowId, display, windowName) => {
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
  });

  mainWindow
    .loadURL(`file://${path.join(dirname, HTML_PATH)}`)
    .catch((err) => console.error('Failed to load URL:', err));

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    createTray();
    Menu.setApplicationMenu(buildAppMenu());
    setGlobalState('global/setWindowId', selectedWindowId);
    setGlobalState('global/setDisplay', display);
    setGlobalState('global/setWindowName', windowName);
    console.log(selectedWindowId, display, windowName, typeof windowName);
  });

  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
  });

  mainWindow.on('close', handleMainWindowClose);
  return mainWindow;
};

export const toggleMainWindowVisibility = () => {
  if (!mainWindow) return; // Ensure mainWindow exists

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    // Removed: no longer auto-hiding widget window
  }
};

// Function to create and show the widget window
export const createWidgetWindow = () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    // If window already exists, just focus it
    if (widgetWindow.isMinimized()) widgetWindow.restore();
    widgetWindow.focus();
    return;
  }

  widgetWindow = new BrowserWindow({
    width: 210, // Adjust width as needed
    height: 250, // Further reduced height for cleaner look
    // Set window as frameless and always on top
    frame: false,
    show: false, // Initially hidden, will be shown by tray click
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true, // Make window fully transparent
    icon: ICON_PATHS.app, // Use the app icon
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: WIDGET_PRELOAD_PATH, // Path to widget preload script
      devTools: false, // Disable dev tools
    },
  });

  // Dev tools disabled

  widgetWindow.loadURL(`file://${WIDGET_HTML_PATH}`).catch((err) => {
    console.error('Failed to load widget URL:', err);
    widgetWindow = null; // Clear if loading fails
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null; // Clean up the reference
  });

  // Remove auto-hide behavior - window will stay visible until explicitly closed
  // widgetWindow.on('blur', () => {
  //   widgetWindow.hide();
  // });
};

// Function to toggle the visibility of the widget window
export const toggleWidgetWindowVisibility = () => {
  if (!widgetWindow) {
    createWidgetWindow();
    // Wait for the window to be ready before showing
    widgetWindow.on('ready-to-show', () => {
      widgetWindow.show();
      widgetWindow.focus();
    });
  } else {
    if (widgetWindow.isVisible()) {
      widgetWindow.hide();
    } else {
      widgetWindow.show();
      widgetWindow.focus();
    }
  }
};

store.subscribe(() => {
  const { notificationsEnabled } = store.getState().global;
  isNotificationEnabled = notificationsEnabled;

  if (tray) {
    tray.setContextMenu(buildTrayContextMenu());
    updateTrayIcon();
  }

  Menu.setApplicationMenu(buildAppMenu());
});

export const getMainWindow = () => mainWindow;
