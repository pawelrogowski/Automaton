import { BrowserWindow, app, Tray, Menu, dialog } from 'electron';
import path from 'path';
import url, { fileURLToPath } from 'url';
import { resetWorkers } from './main.js';
import { selectWindow } from './menus/windowSelection.js';
import { loadRulesFromFile, saveRulesToFile } from './rulesManager.js';

let mainWindow;
let tray;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 346,
    minWidth: 700,
    minHeight: 42,
    maxHeight: 346,
    icon: path.join(dirname, './skull.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(dirname, '/preload.js'),
    },
    autoHideMenuBar: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
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
    { label: 'Close', click: () => app.quit() },
  ]);

  // Assign the context menu to the tray icon
  tray.setContextMenu(trayContextMenu);

  // Handle the window close event
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Show the window when it's ready
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // Prevent the window from being minimized
  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
  });

  // Handle the window close event to prompt the user for confirmation
  let shouldClose = false;
  mainWindow.on('close', (event) => {
    if (!shouldClose) {
      event.preventDefault(); // Prevent the window from closing immediately
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
          // If the user clicks 'Yes', allow the window to close
          shouldClose = true;
          app.quit();
        }
      });
    }
  });
  // win.webContents.on('zoom-changed', (event, zoomDirection) => {
  //   let currentZoomFactor = win.webContents.getZoomFactor();
  //   if (zoomDirection === 'in') {
  //     currentZoomFactor += 0.1;
  //   } else if (zoomDirection === 'out') {
  //     currentZoomFactor -= 0.1;
  //   }

  //   win.webContents.setZoomFactor(currentZoomFactor);
  // });
};

export const toggleMainWindowVisibility = () => {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
};

/**
 * Retrieves the main application window.
 * @returns {BrowserWindow} The main application window.
 */
export const getMainWindow = () => mainWindow;
