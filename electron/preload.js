const { contextBridge, ipcRenderer } = require('electron');

console.log('preload script loaded');

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, func) => ipcRenderer.on(channel, func),
    removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
  },
});

contextBridge.exposeInMainWorld('api', {
  registerListener: (eventName, id) => ipcRenderer.invoke('registerListener', eventName, id),
  unregisterListener: (eventName, id) => ipcRenderer.invoke('unregisterListener', eventName, id),
  pickColor: () => ipcRenderer.invoke('pick-color'),
  startMonitoring: (rule) => ipcRenderer.invoke('startMonitoring', rule),
  stopMonitoring: (ruleId) => ipcRenderer.invoke('stopMonitoring', ruleId),
});
