# Find Sequences Module

This document provides an overview and usage instructions for the `findSequences` module. This module is a Node.js native addon designed for efficiently locating predefined color sequences within image data buffers. It supports both horizontal and vertical sequence matching, optional search areas, and can return either the first occurrence or all occurrences of a sequence.

## Features

- **High Performance**: Utilizes multi-threading in C++ for fast scanning of large image buffers.
- **Flexible Sequence Definition**: Define sequences of RGB colors, including an "any" wildcard for flexible matching.
- **Directional Search**: Supports both horizontal and vertical sequence matching.
- **Offset Calculation**: Allows defining an offset from the found sequence's start point to report the desired coordinates.
- **Occurrence Modes**:
  - `"first"`: Returns the coordinates of the first found primary sequence, or the first backup sequence if no primary is found.
  - `"all"`: Returns an array of all found primary sequences, or all backup sequences if no primary sequences are found.
- **Search Area Restriction**: Limit the search to a specific rectangular region within the image buffer.
- **Primary/Backup Sequences**: Define a primary sequence and an optional backup sequence for each target, allowing for robust matching.
- **AVX2 Optimization**: Inherits AVX2 intrinsics support from the underlying build environment for potentially faster pixel processing.

## Building the Module

This module is a Node.js native addon, which requires compilation. It uses `node-gyp` for the build process, similar to `x11RegionCapture`.

1.  **Prerequisites**:

    - Node.js and npm (or yarn)
    - Build tools (e.g., `build-essential` on Debian/Ubuntu, `Xcode Command Line Tools` on macOS, Visual Studio on Windows - though this module is primarily designed for Linux environments where X11 capture is relevant).
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

    This command compiles the C++ source code into a `.node` file (e.g., `build/Release/findSequences.node`) that Node.js can load.

    **Note on AVX2**: The `binding.gyp` file includes flags (`-mavx2`, `-mfma`, `-DAVX2`) to enable AVX2 optimizations during compilation. If your CPU supports AVX2, the module will be built with these optimizations for pixel conversion.

## `findSequences` Function

The primary interface to the module is the `findSequences` function.

`findSequences(imageData, targetSequences, [searchArea], [occurrence], [ignoreHeaderWarnings])`

### Parameters

- `imageData`: `Buffer` (required)
  A Node.js `Buffer` containing the image pixel data. The buffer is expected to have an 8-byte header:

  - Bytes 0-3: Image Width (Little-endian `UInt32`)
  - Bytes 4-7: Image Height (Little-endian `UInt32`)
  - Bytes 8 onwards: Raw RGB pixel data (3 bytes per pixel, R, G, B).

- `targetSequences`: `Object` (required)
  An object where keys are unique names for the sequences you want to find, and values are configuration objects for each sequence.

  Each sequence configuration object can have the following properties:

  - `sequence`: `Array<Array<number> | string>` (required)
    An array defining the primary color sequence. Each element can be:
    - `[R, G, B]`: An array of three numbers (0-255) representing an RGB color.
    - `"any"`: A string literal `"any"` to match any color at that position.
  - `backupSequence`: `Array<Array<number> | string>` (optional)
    An array defining a backup color sequence. If a primary sequence is not found, the module will attempt to find this backup sequence. Format is the same as `sequence`.
  - `direction`: `string` (optional)
    The direction to search for the sequence. Can be `"horizontal"` (default) or `"vertical"`.
  - `offset`: `Object` (optional)
    An object `{ x: number, y: number }` specifying an offset from the first pixel of the found sequence. The reported coordinates will be `(foundX + offsetX, foundY + offsetY)`. Defaults to `{ x: 0, y: 0 }`.

- `searchArea`: `Object` (optional)
  An object defining a rectangular sub-area within the `imageData` to restrict the search. If not provided, the entire image buffer will be searched.

  - `x`: `number` - X-coordinate of the top-left corner of the search area.
  - `y`: `number` - Y-coordinate of the top-left corner of the search area.
  - `width`: `number` - Width of the search area.
  - `height`: `number` - Height of the search area.
    All coordinates and dimensions are relative to the `imageData` buffer.

- `occurrence`: `string` (optional)
  Specifies how many occurrences to return. Can be `"first"` (default) or `"all"`.

  - `"first"`: Returns the coordinates of the first match found for each target sequence. If a primary sequence is found, its coordinates are returned. Otherwise, if a backup sequence is found, its coordinates are returned.
  - `"all"`: Returns an array of all unique coordinates where primary sequences are found. If no primary sequences are found, it returns all unique coordinates where backup sequences are found.

- `ignoreHeaderWarnings`: `boolean` (optional)
  If `true`, suppresses warnings related to `imageData` buffer length not matching the expected length based on header dimensions. Defaults to `false`. This parameter is handled by the JavaScript wrapper and not directly by the native addon.

### Return Value

- `Object`
  An object where keys are the `targetSequences` names, and values depend on the `occurrence` mode:

  - **If `occurrence` is `"first"`**:

    - `{ x: number, y: number }`: An object containing the `x` and `y` coordinates of the first found sequence (after applying `offset`).
    - `null`: If no primary or backup sequence was found for that target.

  - **If `occurrence` is `"all"`**:
    - `Array<{ x: number, y: number }>`: An array of objects, each containing the `x` and `y` coordinates of all unique found sequences (after applying `offset`). The array will contain primary matches if any are found; otherwise, it will contain backup matches. An empty array `[]` is returned if no sequences are found.

## Usage Example (JavaScript)

```javascript
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Assuming findSequences.js is in the same directory as the native addon
// For this example, we'll load the native addon directly for simplicity.
// In a real application, you'd import `findSequences` from `findSequences.js`
// which then loads the native addon.
const addonPath = path.join(
	__dirname,
	"build",
	"Release",
	"findSequences.node"
);
const { findSequencesNative } = require(addonPath);

// Helper to create a dummy image buffer with header
function createDummyImageBuffer(
	width,
	height,
	fillR = 0,
	fillG = 0,
	fillB = 0
) {
	const buffer = Buffer.alloc(width * height * 3 + 8);
	buffer.writeUInt32LE(width, 0);
	buffer.writeUInt32LE(height, 4);
	for (let i = 0; i < width * height; i++) {
		const offset = 8 + i * 3;
		buffer[offset] = fillR;
		buffer[offset + 1] = fillG;
		buffer[offset + 2] = fillB;
	}
	return buffer;
}

// Helper to set a pixel color in the dummy buffer
function setPixel(buffer, x, y, width, r, g, b) {
	const offset = 8 + (y * width + x) * 3;
	buffer[offset] = r;
	buffer[offset + 1] = g;
	buffer[offset + 2] = b;
}

async function main() {
	const imageWidth = 100;
	const imageHeight = 50;
	const imageData = createDummyImageBuffer(imageWidth, imageHeight, 0, 0, 0); // Black image

	// Example 1: Find a simple horizontal sequence (first occurrence)
	console.log("--- Example 1: Horizontal Sequence (first occurrence) ---");
	setPixel(imageData, 10, 20, imageWidth, 255, 0, 0); // Red
	setPixel(imageData, 11, 20, imageWidth, 0, 255, 0); // Green
	setPixel(imageData, 12, 20, imageWidth, 0, 0, 255); // Blue

	const targetSequences1 = {
		redGreenBlue: {
			sequence: [
				[255, 0, 0],
				[0, 255, 0],
				[0, 0, 255],
			],
			direction: "horizontal",
			offset: { x: 0, y: 0 },
		},
	};

	const result1 = findSequencesNative(
		imageData,
		targetSequences1,
		null,
		"first"
	);
	console.log("Result for redGreenBlue (first):", result1); // Expected: { redGreenBlue: { x: 10, y: 20 } }

	// Example 2: Find a vertical sequence with "any" color and offset
	console.log("\n--- Example 2: Vertical Sequence with 'any' and Offset ---");
	setPixel(imageData, 50, 5, imageWidth, 100, 100, 100); // Grey
	setPixel(imageData, 50, 6, imageWidth, 0, 0, 0); // Black (will match "any")
	setPixel(imageData, 50, 7, imageWidth, 200, 200, 200); // Light Grey

	const targetSequences2 = {
		greyAnyLightGrey: {
			sequence: [[100, 100, 100], "any", [200, 200, 200]],
			direction: "vertical",
			offset: { x: 0, y: -1 }, // Report Y-1 from start of sequence
		},
	};

	const result2 = findSequencesNative(
		imageData,
		targetSequences2,
		null,
		"first"
	);
	console.log("Result for greyAnyLightGrey (first, offset):", result2); // Expected: { greyAnyLightGrey: { x: 50, y: 4 } }

	// Example 3: Find all occurrences of a sequence within a search area
	console.log("\n--- Example 3: All Occurrences within Search Area ---");
	// Place multiple instances of a simple sequence
	setPixel(imageData, 1, 1, imageWidth, 255, 255, 0); // Yellow
	setPixel(imageData, 2, 1, imageWidth, 0, 255, 255); // Cyan

	setPixel(imageData, 5, 1, imageWidth, 255, 255, 0); // Yellow
	setPixel(imageData, 6, 1, imageWidth, 0, 255, 255); // Cyan

	setPixel(imageData, 1, 3, imageWidth, 255, 255, 0); // Yellow
	setPixel(imageData, 2, 3, imageWidth, 0, 255, 255); // Cyan

	const targetSequences3 = {
		yellowCyan: {
			sequence: [
				[255, 255, 0],
				[0, 255, 255],
			],
			direction: "horizontal",
		},
	};
	const searchArea3 = { x: 0, y: 0, width: 10, height: 5 }; // Restrict search

	const result3 = findSequencesNative(
		imageData,
		targetSequences3,
		searchArea3,
		"all"
	);
	console.log("Result for yellowCyan (all, restricted to 0,0,10,5):", result3);
	// Expected: { yellowCyan: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 1, y: 3 }] }

	// Example 4: Primary and Backup sequences
	console.log("\n--- Example 4: Primary and Backup Sequences ---");
	// Primary sequence: [255,0,0], [0,255,0] (Red, Green)
	// Backup sequence: [0,0,255], [255,255,0] (Blue, Yellow)

	// Case A: Primary exists
	setPixel(imageData, 30, 30, imageWidth, 255, 0, 0); // Red
	setPixel(imageData, 31, 30, imageWidth, 0, 255, 0); // Green
	const targetSequences4A = {
		primaryBackupTest: {
			sequence: [
				[255, 0, 0],
				[0, 255, 0],
			],
			backupSequence: [
				[0, 0, 255],
				[255, 255, 0],
			],
			direction: "horizontal",
		},
	};
	const result4A = findSequencesNative(
		imageData,
		targetSequences4A,
		null,
		"first"
	);
	console.log("Result for primaryBackupTest (Primary exists):", result4A); // Expected: { primaryBackupTest: { x: 30, y: 30 } }

	// Case B: Only Backup exists (clear primary location first)
	setPixel(imageData, 30, 30, imageWidth, 0, 0, 0); // Clear Red
	setPixel(imageData, 31, 30, imageWidth, 0, 0, 0); // Clear Green
	setPixel(imageData, 30, 30, imageWidth, 0, 0, 255); // Blue
	setPixel(imageData, 31, 30, imageWidth, 255, 255, 0); // Yellow
	const result4B = findSequencesNative(
		imageData,
		targetSequences4A,
		null,
		"first"
	);
	console.log("Result for primaryBackupTest (Only Backup exists):", result4B); // Expected: { primaryBackupTest: { x: 30, y: 30 } }

	// Case C: Neither exists
	setPixel(imageData, 30, 30, imageWidth, 0, 0, 0); // Clear Blue
	setPixel(imageData, 31, 30, imageWidth, 0, 0, 0); // Clear Yellow
	const result4C = findSequencesNative(
		imageData,
		targetSequences4A,
		null,
		"first"
	);
	console.log("Result for primaryBackupTest (Neither exists):", result4C); // Expected: { primaryBackupTest: null }
}

main().catch(console.error);
```
