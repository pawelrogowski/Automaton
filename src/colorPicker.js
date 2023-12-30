const { BrowserWindow, ipcMain } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');
const path = require('path');

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
