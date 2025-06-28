const windowinfo = require("./build/Release/windowinfo");

try {
	const windowList = windowinfo.getWindowList();
	console.log(windowList);
} catch (error) {
	console.error("Error:", error.message);
}
