const { app, BrowserWindow, ipcMain } = require("electron");
const createPixelPicker = require("./pixelPicker");

let mainWindow = null;
let pixelPicker = null;
let pixelPickerVisible = false;

app.whenReady().then(() => {
	mainWindow = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	pixelPicker = createPixelPicker();

	mainWindow.loadURL(`file://${__dirname}/assets/html/index.html`);
});

ipcMain.on("toggle-overlay", () => {
	pixelPickerVisible = !pixelPickerVisible;
	pixelPicker.setVisibleOnAllWorkspaces(pixelPickerVisible, {
		visibleOnFullScreen: true,
	});
	if (pixelPickerVisible) {
		pixelPicker.show();
	} else {
		pixelPicker.hide();
	}
});

app.on("window-all-closed", function () {
	if (process.platform !== "darwin") app.quit();
});

app.on("activate", function () {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
