# X11 Region Capture Module

This document provides an overview and usage instructions for the `x11RegionCapture` Node.js native addon. This module allows for efficient capture of full window images or specific regions within an X11 window, leveraging shared memory (SHM) for high-performance pixel data transfer.

## Features

- **Full Window Capture**: Capture the entire content of a specified X11 window.
- **Region-based Capture**: Define and monitor multiple arbitrary rectangular regions within a window.
- **High Performance**: Utilizes XCB SHM extension for direct memory access to pixel data, minimizing data copying.
- **Configurable FPS**: Control the capture rate for monitoring instances.
- **AVX2 Optimization**: Supports AVX2 intrinsics for faster BGRA to RGB pixel conversion if the CPU and build environment support it.

## Building the Module

This module is a Node.js native addon, which requires compilation. It uses `node-gyp` for the build process.

1.  **Prerequisites**:

    - Node.js and npm (or yarn)
    - Build tools (e.g., `build-essential` on Debian/Ubuntu, `Xcode Command Line Tools` on macOS, Visual Studio on Windows - though this module is Linux-specific due to X11).
    - XCB development libraries (e.g., `libxcb-dev`, `libxcb-shm-dev`, `libxcb-composite-dev` on Debian/Ubuntu).
    - `node-addon-api` (installed via npm).

2.  **Install Dependencies**:

    ```bash
    npm install
    ```

    This will install `node-addon-api` and other Node.js dependencies.

3.  **Rebuild the Addon**:
    Navigate to the project root directory and run:

    ```bash
    node-gyp rebuild
    ```

    This command compiles the C++ source code into a `.node` file (e.g., `build/Release/x11RegionCapture.node`) that Node.js can load.

    **Note on AVX2**: The `binding.gyp` file includes flags (`-mavx2`, `-mfma`, `-DAVX2`) to enable AVX2 optimizations during compilation. If your CPU supports AVX2, the module will be built with these optimizations for pixel conversion.

## `X11RegionCapture` Class

The primary interface to the module is the `X11RegionCapture` class.

### Constructor

`new X11RegionCapture()`

Initializes a new instance of the capture module. Attempts to connect to the X server upon instantiation.

### Methods

#### `isConnected()`

- **Returns**: `boolean` - `true` if successfully connected to the X server, `false` otherwise.

Checks the current connection status to the X server.

#### `addRegionToMonitor(config)`

- `config`: `Object` - An object defining the region to monitor.
  - `regionName`: `string` - A unique name for this region.
  - `winX`: `number` - X-coordinate of the region's top-left corner, relative to the target window.
  - `winY`: `number` - Y-coordinate of the region's top-left corner, relative to the target window.
  - `regionWidth`: `number` - Width of the region.
  - `regionHeight`: `number` - Height of the region.

Adds or updates a rectangular region to be monitored. Each region will have its own dedicated shared memory segment for efficient capture.

#### `removeRegionToMonitor(regionName)`

- `regionName`: `string` - The name of the region to remove.

Removes a previously added region from monitoring. Its associated resources (like shared memory) will be cleaned up.

#### `startMonitorInstance(windowId, [fps])`

- `windowId`: `number` - The XID (Window ID) of the target window to capture from.
- `fps`: `number` (optional) - The target frames per second for the capture loop. Defaults to 60 FPS. Valid range: 1 to 1000.

Starts the background capture thread for the specified window. Once started, the module will continuously capture the window and update the internal buffers for full window and monitored regions.

#### `stopMonitorInstance()`

Stops the background capture thread. All monitoring activities will cease, and associated resources will be cleaned up.

#### `getRegionRgbData(regionName, targetBuffer)`

- `regionName`: `string` - The name of the region to retrieve data for.
- `targetBuffer`: `Buffer` - A pre-allocated Node.js `Buffer` where the RGB pixel data (including a 8-byte header) will be copied. The buffer must be large enough to hold `(width * height * 3) + 8` bytes.

- **Returns**: `Object`
  - `success`: `boolean` - `true` if new data was successfully copied, `false` otherwise (e.g., no new data, buffer too small, region not found).
  - `width`: `number` - The width of the captured region.
  - `height`: `number` - The height of the captured region.
  - `bytesCopied`: `number` - The number of bytes copied into `targetBuffer`.
  - `captureTimestampUs`: `number` - The timestamp (microseconds since epoch) when the data was captured.

Retrieves the latest RGB pixel data for a specific monitored region. The data includes an 8-byte header: first 4 bytes for width (little-endian), next 4 bytes for height (little-endian). The pixel data follows in RGB format (3 bytes per pixel).

#### `getFullWindowImageData(targetBuffer)`

- `targetBuffer`: `Buffer` - A pre-allocated Node.js `Buffer` where the full window's RGB pixel data (including a 8-byte header) will be copied. The buffer must be large enough to hold `(width * height * 3) + 8` bytes for the expected window size.

- **Returns**: `Object`
  - `success`: `boolean` - `true` if new data was successfully copied, `false` otherwise (e.g., no new data, buffer too small).
  - `width`: `number` - The width of the captured window.
  - `height`: `number` - The height of the captured window.
  - `bytesCopied`: `number` - The number of bytes copied into `targetBuffer`.
  - `captureTimestampUs`: `number` - The timestamp (microseconds since epoch) when the data was captured.

Triggers a one-off capture of the entire target window and copies its RGB pixel data into the provided `targetBuffer`. The data format is the same as `getRegionRgbData`. This method will wait for a new frame to be captured by the background thread, with a timeout.

## Usage Example (JavaScript)

```javascript
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const addonPath = path.join(
	__dirname,
	"build",
	"Release",
	"x11RegionCapture.node"
);
const { X11RegionCapture } = require(addonPath);

// IMPORTANT: Replace with your actual X11 Window ID
const TARGET_WINDOW_ID = 0x1234567; // Example ID

function calculateRgbBufferSize(width, height) {
	return width * height * 3 + 8; // 3 bytes per pixel (RGB) + 8 bytes for header
}

async function main() {
	const capture = new X11RegionCapture();

	if (!capture.isConnected()) {
		console.error("Failed to connect to X server.");
		return;
	}

	console.log("Connected to X server. Starting capture...");

	// --- Full Window Capture Example ---
	console.log("\n--- Testing Full Window Capture ---");
	const estimatedWidth = 1920;
	const estimatedHeight = 1080;
	const fullWindowBuffer = Buffer.alloc(
		calculateRgbBufferSize(estimatedWidth, estimatedHeight)
	);

	capture.startMonitorInstance(TARGET_WINDOW_ID, 60); // Start monitoring at 60 FPS

	// Wait a moment for the capture thread to start and get a frame
	await new Promise((resolve) => setTimeout(resolve, 100));

	const fullFrameResult = capture.getFullWindowImageData(fullWindowBuffer);

	if (fullFrameResult.success) {
		console.log(
			`Full window captured: ${fullFrameResult.width}x${fullFrameResult.height} pixels.`
		);
		console.log(`Bytes copied: ${fullFrameResult.bytesCopied}`);
		// You can now process fullWindowBuffer.slice(8) for RGB data
	} else {
		console.log("Failed to capture full window data.");
	}

	// --- Region Capture Example ---
	console.log("\n--- Testing Region Capture ---");
	const regionName = "my_test_region";
	const regionConfig = {
		regionName: regionName,
		winX: 100,
		winY: 100,
		regionWidth: 200,
		regionHeight: 150,
	};
	const regionBuffer = Buffer.alloc(
		calculateRgbBufferSize(regionConfig.regionWidth, regionConfig.regionHeight)
	);

	capture.addRegionToMonitor(regionConfig);

	// Wait a moment for the capture thread to update the region
	await new Promise((resolve) => setTimeout(resolve, 100));

	const regionResult = capture.getRegionRgbData(regionName, regionBuffer);

	if (regionResult.success) {
		console.log(
			`Region '${regionName}' captured: ${regionResult.width}x${regionResult.height} pixels.`
		);
		console.log(`Bytes copied: ${regionResult.bytesCopied}`);
		// You can now process regionBuffer.slice(8) for RGB data
	} else {
		console.log(`Failed to capture data for region '${regionName}'.`);
	}

	// Clean up
	capture.removeRegionToMonitor(regionName);
	capture.stopMonitorInstance();
	console.log("\nCapture stopped and resources cleaned up.");
}

main().catch(console.error);
```
