const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
	on: (channel, func) =>
		ipcRenderer.on(channel, (event, ...args) => func(...args)),
});
