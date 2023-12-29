const { app, BrowserWindow, ipcMain } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');
const path = require('path');
const url = require('url');
const { fork, exec } = require('child_process');
const { rgbaToHex } = require('./utils/rgbaToHex.js');

let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
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

ipcMain.handle('pick-color', () => {
  return new Promise((resolve) => {
    const colorPickerWindow = new BrowserWindow({
      width: 50,
      height: 50,
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

    let intervalId;

    const mouseMoveListener = (mouseEvent) => {
      const updateColor = () => {
        const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
        const code = `
            document.getElementById('color').style.backgroundColor = '${color}';
          `;
        colorPickerWindow.webContents.executeJavaScript(code);
      };
      updateColor();

      if (intervalId) {
        clearInterval(intervalId);
      }

      intervalId = setInterval(updateColor, 50);

      const windowX = mouseEvent.x + 20;
      const windowY = mouseEvent.y - 20;
      colorPickerWindow.setPosition(windowX, windowY);
    };

    const mouseDownListener = (mouseEvent) => {
      const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
      iohook.stop();
      clearInterval(intervalId);
      colorPickerWindow.webContents.removeAllListeners();
      colorPickerWindow.close();
      resolve({ color, x: mouseEvent.x, y: mouseEvent.y });
    };

    iohook.on('mousemove', mouseMoveListener);
    iohook.on('mousedown', mouseDownListener);
    iohook.start();
  });
});

const monitoringIntervals = {};

ipcMain.handle('startMonitoring', (event, rule) => {
  const monitorProcess = fork(path.join(__dirname, 'monitor.js'));

  monitorProcess.send(rule);

  monitorProcess.on('message', (message) => {
    if (message.error) {
      console.log(message.error);
    }
  });

  monitoringIntervals[rule.id] = monitorProcess;
});

ipcMain.handle('stopMonitoring', (event, ruleId) => {
  clearInterval(monitoringIntervals[ruleId]);
  delete monitoringIntervals[ruleId];
});
