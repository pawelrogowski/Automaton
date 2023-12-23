const { BrowserWindow, ipcMain } = require("electron");
const bot = require("robotjs");
const path = require("path");
const iohook = require("iohook2");
const activeWin = require("active-win");

let pixelPicker = null;

function createPixelPicker() {
	pixelPicker = new BrowserWindow({
		width: 26,
		height: 26,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		focusable: false,
		skipTaskbar: true,
		enableLargerThanScreen: true,
		resizable: false,
		movable: false,
		show: false,
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	pixelPicker.loadURL(`file://${__dirname}/assets/html/overlay.html`);

	setInterval(() => {
		let mousePos = bot.getMousePos();
		let color = bot.getPixelColor(mousePos.x, mousePos.y);
		pixelPicker.setPosition(mousePos.x + 20, mousePos.y - 40);
		pixelPicker.webContents.send("update-data", { color });
	}, 1);

	pixelPicker.on("show", () => {
		iohook.start();
	});

	pixelPicker.on("hide", () => {
		iohook.stop();
	});

	return pixelPicker;
}

iohook.on("mousedown", async (event) => {
	if (pixelPicker.isVisible()) {
		const window = await activeWin();
		let color = bot.getPixelColor(event.x, event.y);
		let relativeX = event.x - window.bounds.x;
		let relativeY = event.y - window.bounds.y;
		let data = {
			color: color,
			globalCords: { x: event.x, y: event.y },
			relCords: { x: relativeX, y: relativeY },
			Title: window.title,
			PID: window.owner.processId,
			Screen: window.screen,
		};
		console.log(JSON.stringify(data));
		pixelPicker.hide();
	}
});

iohook.on("keydown", (event) => {
	if (event.key === "esc" && pixelPicker.isVisible()) {
		pixelPicker.hide();
	}
});

module.exports = createPixelPicker;
