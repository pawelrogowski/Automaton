const { app, BrowserWindow, ipcMain } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');
const path = require('path');
const url = require('url');

let mainWindow;

app.allowRendererProcessReuse = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.openDevTools();

  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, '/../dist/index.html'),
      protocol: 'file:',
      slashes: true,
    });

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
robotjs.setMouseDelay(1);

ipcMain.handle('moveMouse', (event, x, y) => {
  robotjs.moveMouse(x, y);
});

ipcMain.handle('moveMouseSmooth', (event, x, y) => {
  robotjs.moveMouseSmooth(x, y);
});
ipcMain.handle('getMousePos', () => {
  return robotjs.getMousePos();
});

ipcMain.handle('mouseClick', (_, button, double) => {
  robotjs.mouseClick(button, double);
});

ipcMain.handle('mouseToggle', (_, down, button) => {
  robotjs.mouseToggle(down, button);
});

ipcMain.handle('dragMouse', (_, x, y) => {
  robotjs.dragMouse(x, y);
});

ipcMain.handle('scrollMouse', (_, x, y) => {
  robotjs.scrollMouse(x, y);
});

ipcMain.handle('getScreenSize', () => {
  return robotjs.getScreenSize();
});

ipcMain.handle('screenCapture', (_, x, y, width, height) => {
  return robotjs.screen.capture(x, y, width, height);
});

ipcMain.handle('start-iohook', () => {
  iohook.start();
});

ipcMain.handle('stop-iohook', () => {
  iohook.stop();
});

ipcMain.handle('pick-color', () => {
  return new Promise((resolve) => {
    const colorPickerWindow = new BrowserWindow({
      width: 24,
      height: 24,
      alwaysOnTop: true,
      frame: false,
      resizable: false,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        enableRemoteModule: false,
        contextIsolation: true,
      },
    });

    colorPickerWindow.loadFile(path.join(__dirname, 'windows', 'colorPicker', 'colorPicker.html'));

    const mouseMoveListener = (mouseEvent) => {
      const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
      colorPickerWindow.setPosition(mouseEvent.x + 20, mouseEvent.y - 20);
      colorPickerWindow.webContents.executeJavaScript(
        `document.getElementById('color-bg').style.backgroundColor = "${color}";`,
      );
      colorPickerWindow.setTitle(color);
    };

    const mouseDownListener = (mouseEvent) => {
      const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
      iohook.stop();
      colorPickerWindow.webContents.removeAllListeners();
      colorPickerWindow.close();
      resolve(color);
    };

    iohook.on('mousemove', mouseMoveListener);
    iohook.on('mousedown', mouseDownListener);
    iohook.start();
  });
});
