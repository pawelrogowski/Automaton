const { contextBridge, ipcRenderer } = require('electron');

console.log('preload script loaded');

contextBridge.exposeInMainWorld('api', {
  // robotjs
  // Moves the mouse to the specified coordinates.
  // Example usage: api.moveMouse(100, 100);
  moveMouse: (x, y) => ipcRenderer.invoke('moveMouse', x, y),

  // Smoothly moves the mouse to the specified coordinates.
  // Example usage: api.moveMouseSmooth(100, 100);
  moveMouseSmooth: (x, y) => ipcRenderer.invoke('moveMouseSmooth', x, y),

  // Returns the current mouse position.
  // Example usage: const position = await api.getMousePos();
  getMousePos: () => ipcRenderer.invoke('getMousePos'),

  // Performs a mouse click.
  // Example usage: api.mouseClick('left', false);
  mouseClick: (button, double) => ipcRenderer.invoke('mouseClick', button, double),

  // Presses or releases the mouse button.
  // Example usage: api.mouseToggle('down', 'left');
  mouseToggle: (down, button) => ipcRenderer.invoke('mouseToggle', down, button),

  // Drags the mouse to the specified coordinates.
  // Example usage: api.dragMouse(100, 100);
  dragMouse: (x, y) => ipcRenderer.invoke('dragMouse', x, y),

  // Scrolls the mouse wheel.
  // Example usage: api.scrollMouse(0, 1);
  scrollMouse: (x, y) => ipcRenderer.invoke('scrollMouse', x, y),

  // Returns the size of the screen.
  // Example usage: const size = await api.screenSize();
  screenSize: () => ipcRenderer.invoke('getScreenSize'),

  // Captures a screenshot and returns a bitmap.
  // Example usage: const bitmap = await api.screenCapture(0, 0, 100, 100);
  screenCapture: (x, y, width, height) => ipcRenderer.invoke('screenCapture', x, y, width, height),

  // iohook
  // Starts the iohook event loop.
  // Example usage: api.startIohook();
  startIohook: () => ipcRenderer.invoke('start-iohook'),

  // Stops the iohook event loop.
  // Example usage: api.stopIohook();
  stopIohook: () => ipcRenderer.invoke('stop-iohook'),

  registerListener: (eventName, id) => ipcRenderer.invoke('registerListener', eventName, id),
  unregisterListener: (eventName, id) => ipcRenderer.invoke('unregisterListener', eventName, id),
  pickColor: () => ipcRenderer.invoke('pick-color'),
});
