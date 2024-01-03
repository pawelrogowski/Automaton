import { BrowserWindow, ipcMain, screen } from 'electron';
import robotjs from 'robotjs';
import iohook from 'iohook2';
import path from 'path';
import url from 'url';

ipcMain.handle('pick-color', (event) => {
  return new Promise((resolve, reject) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    const displays = screen.getAllDisplays();

    const transparentWindows = displays.map((display) => {
      return new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        focusable: true,
      });
    });

    // Create a transparent window for each display

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

    const currentURL = new URL(import.meta.url);
    const currentDirname = path.dirname(url.fileURLToPath(currentURL));
    const colorPickerHTMLPath = path.join(currentDirname, 'windows/colorPicker/colorPicker.html');
    colorPickerWindow.loadFile(colorPickerHTMLPath);

    let intervalId;

    mainWindow.hide();

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

      intervalId = setInterval(updateColor, 10);

      const windowX = mouseEvent.x + 20;
      const windowY = mouseEvent.y - 20;
      colorPickerWindow.setPosition(windowX, windowY);
    };

    const cleanup = () => {
      iohook.stop();
      clearInterval(intervalId);
      colorPickerWindow.close();
      transparentWindows.forEach((window) => window.close());
      mainWindow.show();
    };

    const keydownListener = (e) => {
      if (e.key === 'esc') {
        cleanup();
        reject(new Error('Color picking cancelled'));
      }
    };

    const mouseDownListener = (mouseEvent) => {
      const color = `#${robotjs.getPixelColor(mouseEvent.x, mouseEvent.y)}`;
      cleanup();
      resolve({ color, x: mouseEvent.x, y: mouseEvent.y });
    };

    iohook.on('keydown', keydownListener);
    iohook.on('mousemove', mouseMoveListener);
    iohook.on('mousedown', mouseDownListener);
    iohook.start();
  });
});
