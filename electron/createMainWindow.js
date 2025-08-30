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
import {
  toggleNotifications,
  setGlobalShortcutsEnabled,
} from '../frontend/redux/slices/globalSlice.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} from './globalShortcuts.js';

const HTML_PATH = '../dist/index.html';

let mainWindow;
let tray;
let isNotificationEnabled = false;
let isTrayVisible = true;
let widgetWindow = null;
let isMainWindowVisible = false;
let isWidgetWindowVisible = false;
let isGlobalShortcutsEnabled = true;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

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
      type: 'checkbox',
      checked: isMainWindowVisible,
      click: toggleMainWindowVisibility,
    },
    {
      label: 'Show/Hide Controls Widget',
      type: 'checkbox',
      checked: isWidgetWindowVisible,
      click: toggleWidgetWindowVisibility,
    },
    {
      label: 'Notifications',
      type: 'checkbox',
      checked: isNotificationEnabled,
      click: () => store.dispatch(toggleNotifications()),
    },
    {
      label: 'Global Shortcuts',
      type: 'checkbox',
      checked: isGlobalShortcutsEnabled,
      click: () =>
        store.dispatch(setGlobalShortcutsEnabled(!isGlobalShortcutsEnabled)),
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
        {
          label: 'Show/Hide Main Window',
          type: 'checkbox',
          checked: isMainWindowVisible,
          click: toggleMainWindowVisibility,
        },
        {
          label: 'Show/Hide Controls Widget',
          type: 'checkbox',
          checked: isWidgetWindowVisible,
          click: toggleWidgetWindowVisibility,
        },
        { type: 'separator' },
        {
          label: 'Load Settings...',
          click: () => loadRulesFromFile(() => {}),
          accelerator: 'CmdOrCtrl+O',
        },
        {
          label: 'Save Settings As...',
          click: () => saveRulesToFile(() => {}),
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
          label: 'Global Shortcuts',
          type: 'checkbox',
          checked: isGlobalShortcutsEnabled,
          click: () =>
            store.dispatch(
              setGlobalShortcutsEnabled(!isGlobalShortcutsEnabled),
            ),
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
    isMainWindowVisible = true;
    createTray();
    Menu.setApplicationMenu(buildAppMenu());
    setGlobalState('global/setWindowId', selectedWindowId);
    setGlobalState('global/setDisplay', display);
    setGlobalState('global/setWindowName', windowName);
    createWidgetWindow();
    toggleWidgetWindowVisibility();
    // Register global shortcuts on app start
    const { isGlobalShortcutsEnabled: globalShortcutsState } =
      store.getState().global;
    if (globalShortcutsState) {
      registerGlobalShortcuts();
    }
  });

  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
    isMainWindowVisible = true;
    Menu.setApplicationMenu(buildAppMenu());
    if (tray) tray.setContextMenu(buildTrayContextMenu());
  });

  mainWindow.on('hide', () => {
    isMainWindowVisible = false;
    Menu.setApplicationMenu(buildAppMenu());
    if (tray) tray.setContextMenu(buildTrayContextMenu());
  });

  mainWindow.on('close', handleMainWindowClose);
  return mainWindow;
};

export const toggleMainWindowVisibility = () => {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  isMainWindowVisible = mainWindow.isVisible();
  Menu.setApplicationMenu(buildAppMenu());
  if (tray) tray.setContextMenu(buildTrayContextMenu());
};

export const createWidgetWindow = () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (widgetWindow.isMinimized()) widgetWindow.restore();
    widgetWindow.focus();
    return;
  }

  widgetWindow = new BrowserWindow({
    width: 210,
    height: 250,
    x: 100,
    y: 100,
    frame: false,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    icon: ICON_PATHS.app,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: WIDGET_PRELOAD_PATH,
      devTools: false,
    },
  });

  widgetWindow.loadURL(`file://${WIDGET_HTML_PATH}`).catch((err) => {
    console.error('Failed to load widget URL:', err);
    widgetWindow = null;
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
    isWidgetWindowVisible = false;
    Menu.setApplicationMenu(buildAppMenu());
    if (tray) tray.setContextMenu(buildTrayContextMenu());
  });

  widgetWindow.on('show', () => {
    isWidgetWindowVisible = true;
    Menu.setApplicationMenu(buildAppMenu());
    if (tray) tray.setContextMenu(buildTrayContextMenu());
  });

  widgetWindow.on('hide', () => {
    isWidgetWindowVisible = false;
    Menu.setApplicationMenu(buildAppMenu());
    if (tray) tray.setContextMenu(buildTrayContextMenu());
  });
};

export const toggleWidgetWindowVisibility = () => {
  if (!widgetWindow) {
    createWidgetWindow();
    widgetWindow.on('ready-to-show', () => {
      widgetWindow.show();
      widgetWindow.focus();
      isWidgetWindowVisible = true;
      Menu.setApplicationMenu(buildAppMenu());
      if (tray) tray.setContextMenu(buildTrayContextMenu());
    });
  } else {
    if (widgetWindow.isVisible()) {
      widgetWindow.hide();
    } else {
      widgetWindow.show();
      widgetWindow.focus();
    }
    isWidgetWindowVisible = widgetWindow.isVisible();
    Menu.setApplicationMenu(buildAppMenu());
    if (tray) tray.setContextMenu(buildTrayContextMenu());
  }
};

let lastState = {};
store.subscribe(() => {
  const state = store.getState().global;

  const newState = {
    windowName: state.windowName,
    isBotEnabled: state.isBotEnabled,
    windowId: state.windowId,
    notificationsEnabled: state.notificationsEnabled,
    isGlobalShortcutsEnabled: state.isGlobalShortcutsEnabled,
    isMainWindowVisible: mainWindow ? mainWindow.isVisible() : false,
    isWidgetWindowVisible: widgetWindow ? widgetWindow.isVisible() : false,
  };

  // Only update if the relevant state has changed
  const iconChanged =
    lastState.isBotEnabled !== newState.isBotEnabled ||
    lastState.windowId !== newState.windowId;

  const menuChanged =
    lastState.windowName !== newState.windowName ||
    lastState.isMainWindowVisible !== newState.isMainWindowVisible ||
    lastState.isWidgetWindowVisible !== newState.isWidgetWindowVisible ||
    lastState.notificationsEnabled !== newState.notificationsEnabled ||
    lastState.isGlobalShortcutsEnabled !== newState.isGlobalShortcutsEnabled;

  if (tray) {
    if (iconChanged) {
      updateTrayIcon();
    }
    if (menuChanged) {
      tray.setContextMenu(buildTrayContextMenu());
    }
  }

  if (menuChanged) {
    Menu.setApplicationMenu(buildAppMenu());
  }

  // Handle global shortcuts enable/disable
  if (
    lastState.isGlobalShortcutsEnabled !== newState.isGlobalShortcutsEnabled
  ) {
    if (newState.isGlobalShortcutsEnabled) {
      registerGlobalShortcuts();
    } else {
      unregisterGlobalShortcuts();
    }
  }

  // Update local module state
  isNotificationEnabled = newState.notificationsEnabled;
  isGlobalShortcutsEnabled = newState.isGlobalShortcutsEnabled;
  isMainWindowVisible = newState.isMainWindowVisible;
  isWidgetWindowVisible = newState.isWidgetWindowVisible;

  lastState = newState;
});

export const getMainWindow = () => mainWindow;
export const getWidgetWindow = () => widgetWindow;
