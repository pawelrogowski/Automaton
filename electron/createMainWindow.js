import { BrowserWindow, app, Tray, Menu, dialog } from 'electron';
import path from 'path';
import url, { fileURLToPath } from 'url';

// Reference to the main window and tray icon
let mainWindow;
let tray;

// Determine the directory of the current file
const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

/**
 * Creates the main application window.
 */
export const createMainWindow = () => {
  // Create the main window with specified dimensions and settings
  mainWindow = new BrowserWindow({
    width: 911,
    height: 728,
    minWidth: 911,
    minHeight: 728,
    icon: path.join(dirname, './skull.png'),
    webPreferences: {
      nodeIntegration: false, // Disable Node.js integration for security
      contextIsolation: true, // Isolate the context to prevent potential security issues
      preload: path.join(dirname, '/preload.js'), // Specify the preload script
    },
    autoHideMenuBar: true, // Hide the menu bar by default
  });

  // Open the developer tools for debugging
  mainWindow.webContents.openDevTools();

  // Determine the URL to load in the main window
  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(dirname, '../dist/index.html'),
      protocol: 'file:',
      slashes: true,
    });

  // Load the URL in the main window
  mainWindow.loadURL(startUrl);

  // Create a tray icon for the application
  tray = new Tray(path.join(dirname, './icons/skull.png'));

  // Set up the context menu for the tray icon
  const trayContextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Hide', click: () => mainWindow.hide() },
    { type: 'separator' },
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
};

/**
 * Retrieves the main application window.
 * @returns {BrowserWindow} The main application window.
 */
export const getMainWindow = () => mainWindow;
