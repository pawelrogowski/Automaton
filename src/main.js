const { app, BrowserWindow, ipcMain } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');
const path = require('path');
const url = require('url');
const { keyboard, Key, Point, mouse, screen, left, right, up, down } = require('@nut-tree/nut-js');
const { rgbaToHex } = require('./utils/rgbaToHex');
const { fork } = require('child_process');

let mainWindow;
app.allowRendererProcessReuse = false;

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
    const screenSize = robotjs.getScreenSize();

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

      // Update the color immediately when the mouse moves
      updateColor();

      // Clear any existing timer
      if (intervalId) {
        clearInterval(intervalId);
      }

      // Then update the color every 100 ms
      intervalId = setInterval(updateColor, 16.67);

      // Adjust the position of the color picker window based on the mouse position
      let windowX = mouseEvent.x + 20;
      let windowY = mouseEvent.y - 20;
      if (windowX + 120 > screenSize.width) {
        windowX = mouseEvent.x - 140;
      }
      if (windowY < 0) {
        windowY = mouseEvent.y + 20;
      }
      if (windowY + 120 > screenSize.height) {
        windowY = mouseEvent.y - 140;
      }
      colorPickerWindow.setPosition(windowX, windowY);
    };

    const mouseDownListener = (mouseEvent) => {
      const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
      // const screenshot = robotjs.screen.capture(0, 0, screenSize.width, screenSize.height);
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

ipcMain.handle('startMonitoring', async (event, rule) => {
  const points = rule.colors.map((color) => new Point(color.x, color.y));

  monitoringIntervals[rule.id] = setInterval(async () => {
    await Promise.all(
      rule.colors.map(async (color, index) => {
        try {
          if (color.enabled) {
            const pixelColor = await screen.colorAt(points[index]);

            console.log(pixelColor);
            const screenColor = rgbaToHex(pixelColor);
            if (screenColor === color.color) {
              keyboard.type(Key[rule.key.toUpperCase()]);
            }
          }
        } catch (error) {
          console.log(error);
        }
      }),
    );
  }, rule.interval);
});

ipcMain.handle('stopMonitoring', (event, ruleId) => {
  clearInterval(monitoringIntervals[ruleId]);
  delete monitoringIntervals[ruleId];
});
