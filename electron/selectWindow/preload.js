const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTibiaWindowList: () => ipcRenderer.invoke('get-tibia-window-list'),
  selectTibiaWindow: (windowId, display, windowName) =>
    ipcRenderer.send('select-tibia-window', windowId, display, windowName),
  exitApp: () => ipcRenderer.send('exit-app'),
});
