// Automaton/electron/widget/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose controlled functions to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Send messages to the main process
  send: (channel, ...args) => {
    ipcRenderer.send(channel, ...args);
  },
  // Receive messages from the main process
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener);
  },
  // Invoke functions in the main process and wait for a response
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  },
  // Remove a listener
  removeListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },
});
