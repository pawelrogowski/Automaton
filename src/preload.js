const { contextBridge } = require('electron');
const robotjs = require('robotjs');
const iohook = require('iohook2');

contextBridge.exposeInMainWorld('colorPicker', {
  start: (onColorPick) => {
    iohook.on('mousedown', (event) => {
      const color = robotjs.getPixelColor(event.x, event.y);
      onColorPick(color);
    });
    iohook.start();
  },
  stop: () => {
    iohook.stop();
  },
});
