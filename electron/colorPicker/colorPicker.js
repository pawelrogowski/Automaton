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
        webPreferences: {
          sandbox: false,
        },
      });
    });

    const colorPickerWindow = new BrowserWindow({
      sandbox: false,
      width: 150,
      height: 150,
      alwaysOnTop: true,
      frame: false,
      resizable: false,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        sandbox: false,
        nodeIntegration: false,
        enableRemoteModule: false,
        contextIsolation: true,
      },
    });

    const currentURL = new URL(import.meta.url);
    const currentDirname = path.dirname(url.fileURLToPath(currentURL));
    const colorPickerHTMLPath = path.join(currentDirname, 'colorPicker.html');
    colorPickerWindow.loadFile(colorPickerHTMLPath);

    let intervalId;

    mainWindow.hide();

    const mouseMoveListener = (mouseEvent) => {
      const updateColors = () => {
        console.time('colorPicker');
        // Define the offsets for the  3x3 grid
        const offsets = [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [0, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ];
        // Get the colors of the surrounding pixels
        const colors = offsets.map(([dx, dy]) => {
          return `#${robotjs.getPixelColor(mouseEvent.x + dx, mouseEvent.y + dy)}`;
        });
        console.timeEnd('colorPicker');
        // Apply the colors to the cells
        colors.forEach((color, index) => {
          const code = `
            document.querySelectorAll('.colorCell')[${index}].style.backgroundColor = '${color}';
          `;
          colorPickerWindow.webContents.executeJavaScript(code);
        });
      };
      updateColors();

      if (intervalId) {
        clearInterval(intervalId);
      }

      intervalId = setInterval(updateColors, 25);

      // Find the display that contains the cursor
      const cursorPoint = { x: mouseEvent.x, y: mouseEvent.y };
      const display = screen.getAllDisplays().find((d) => {
        const { x, y, width, height } = d.bounds;
        return (
          cursorPoint.x >= x &&
          cursorPoint.x <= x + width &&
          cursorPoint.y >= y &&
          cursorPoint.y <= y + height
        );
      });

      // Calculate the safe boundaries for the color picker window
      const windowWidth = 150;
      const windowHeight = 150;
      const bufferZone = 180; // Buffer zone in pixels
      const safeLeftBoundary = Math.max(display.bounds.x, display.bounds.x + bufferZone);
      const safeRightBoundary = Math.min(
        display.bounds.x + display.bounds.width - windowWidth - bufferZone,
        display.bounds.x + display.bounds.width - bufferZone,
      );
      const safeTopBoundary = Math.max(display.bounds.y, display.bounds.y + bufferZone);
      const safeBottomBoundary = Math.min(
        display.bounds.y + display.bounds.height - windowHeight - bufferZone,
        display.bounds.y + display.bounds.height - bufferZone,
      );

      // Calculate the proposed position of the color picker window
      let windowX = mouseEvent.x + 20;
      let windowY = mouseEvent.y - 20;

      // Adjust the position if it goes beyond the safe boundaries
      if (windowX > safeRightBoundary) {
        windowX = safeRightBoundary;
      } else if (windowX < safeLeftBoundary) {
        windowX = safeLeftBoundary;
      }

      if (windowY > safeBottomBoundary) {
        windowY = safeBottomBoundary;
      } else if (windowY < safeTopBoundary) {
        windowY = safeTopBoundary;
      }

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
