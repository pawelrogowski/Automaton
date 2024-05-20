const { contextBridge, ipcRenderer } = require('electron');

console.log('preload script loaded');

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, func) => ipcRenderer.on(channel, func),
  },
  saveRules: () => ipcRenderer.send('save-rules'),
  loadRules: () => ipcRenderer.invoke('load-rules'),
});
