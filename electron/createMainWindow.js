import { BrowserWindow, app, Tray, Menu, dialog } from 'electron';
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
  // tray.on('click', () => {
  //   setTimeout(() => {
  //     if (!mainWindow.isVisible()) {
  //       mainWindow.show();
  //     }
  //   }, 500); // Adjust the delay as needed
  // });

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

  mainWindow.on('show', () => {
    mainWindow.setMinimizable(false);
  });

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
          // If the user clicks 'Yes'
          shouldClose = true; // Set the flag to allow closing
          app.quit(); // Quit the application
        } else {
          // Do nothing if the user clicks 'No'
        }
      });
    }
  });
};

export const getMainWindow = () => mainWindow;
