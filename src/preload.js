const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    const validChannels = ['pick-pixel', 'pick-pixel-stop'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ['pixel-picked'];
    if (validChannels.includes(channel)) {
      const listener = (event, ...args) => func(...args);
      ipcRenderer.on(channel, listener);
    }
  },
  remove: (channel, func) => {
    const validChannels = ['pixel-picked'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, func);
    }
  },
});
