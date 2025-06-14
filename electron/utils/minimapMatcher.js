import fs from 'fs/promises';
import path from 'path';
import { PNG } from 'pngjs';

// Define the base path to the Tibia minimap data
const TIBIA_MINIMAP_BASE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.local',
  'share',
  'CipSoft GmbH',
  'Tibia',
  'packages',
  'Tibia',
  'minimap',
);
// Define the path to the combined maps directory
const COMBINED_MAPS_PATH = path.join(TIBIA_MINIMAP_BASE_PATH, 'combined_maps');
// Define the path to the original tiles directory (still needed to discover overall dimensions)
const ORIGINAL_TILES_PATH = TIBIA_MINIMAP_BASE_PATH;

const TILE_SIZE = 256; // Pixels per tile dimension (used for overall dimension calculation from tiles)
const CAPTURED_MINIMAP_WIDTH = 106; // Width of the captured minimap
const CAPTURED_MINIMAP_HEIGHT = 109; // Height of the captured minimap
const PLAYER_RELATIVE_X = 53; // Player's X coordinate relative to the top-left of the captured minimap
const PLAYER_RELATIVE_Y = 54; // Player's Y coordinate relative to the top-left of the captured minimap
const MASK_X_START = 51; // X coordinate of the top-left corner of the mask area in the captured minimap
const MASK_Y_START = 52; // Y coordinate of the top-left corner of the mask area in the captured minimap
const MASK_SIZE = 6; // Size of the square mask area
const MIN_MATCH_PERCENTAGE = 98; // Minimum similarity percentage required for a match (increased for a more confident match)
const PERFECT_MATCH_PERCENTAGE = 100; // Percentage for a perfect match to stop searching
const LOG_MATCH_THRESHOLD = 50; // Percentage threshold for logging intermediate matches

// Function to build the mask for the captured minimap
// Returns a 2D array where true indicates a masked pixel
function buildCapturedMinimapMask() {
  const mask = Array(CAPTURED_MINIMAP_HEIGHT)
    .fill(null)
    .map(() => Array(CAPTURED_MINIMAP_WIDTH).fill(false));
  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      if (MASK_Y_START + y < CAPTURED_MINIMAP_HEIGHT && MASK_X_START + x < CAPTURED_MINIMAP_WIDTH) {
        mask[MASK_Y_START + y][MASK_X_START + x] = true;
      }
    }
  }
  return mask;
}

const capturedMinimapMask = buildCapturedMinimapMask(); // Pre-calculate the mask

// Function to load a combined minimap image for a specific floor
// Returns an object with the RGB buffer, width, and height of the combined map
async function loadCombinedMinimap(z) {
  const filename = `floor_${z}.png`;
  const filepath = path.join(COMBINED_MAPS_PATH, filename);

  try {
    const data = await fs.readFile(filepath);
    return new Promise((resolve, reject) => {
      const png = new PNG({ filterType: 4 });
      png.parse(data, (err, data) => {
        if (err) {
          console.error(`[MinimapMatcher] Error parsing combined PNG map ${filepath}:`, err);
          return reject(err);
        }
        // PNGJS data is RGBA, convert to RGB buffer
        const rgbBuffer = Buffer.alloc(data.width * data.height * 3);
        for (let i = 0; i < data.data.length; i += 4) {
          const rgbIndex = (i / 4) * 3;
          rgbBuffer[rgbIndex] = data.data[i]; // R
          rgbBuffer[rgbIndex + 1] = data.data[i + 1]; // G
          rgbBuffer[rgbIndex + 2] = data.data[i + 2]; // B
        }
        resolve({ buffer: rgbBuffer, width: data.width, height: data.height });
      });
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[MinimapMatcher] Error loading combined PNG map ${filepath}:`, error);
    } else {
      console.warn(`[MinimapMatcher] Combined map file not found: ${filepath}`);
    }
    return null; // Return null if file does not exist or other error
  }
}

// Function to discover the overall minimap dimensions by scanning the original tiles directory
// Returns an object with min/max x, y (absolute coordinates) of the map extent, or null if no tiles are found.
// This is used to understand the scale and origin of the combined map.
async function discoverOverallMinimapDimensions() {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let foundTiles = false;

  try {
    // Check if the original tiles directory exists
    try {
      await fs.access(ORIGINAL_TILES_PATH);
    } catch (error) {
      console.warn(
        `[MinimapMatcher] Original minimap tiles directory not found at ${ORIGINAL_TILES_PATH}. Cannot determine overall map dimensions from tiles.`,
      );
      return null;
    }

    const files = await fs.readdir(ORIGINAL_TILES_PATH);

    const tilePattern = /^Minimap_Color_(\d+)_(\d+)_(\d+)\.png$/;

    for (const file of files) {
      const match = file.match(tilePattern);
      if (match) {
        foundTiles = true;
        const x = parseInt(match[1], 10);
        const y = parseInt(match[2], 10);
        // We don't need Z for overall X/Y dimensions from tiles

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    if (foundTiles) {
      // Calculate the overall dimensions in pixels based on the tile ranges
      // The max X and Y from file names are the top-left corners of the last tiles.
      // To get the full extent, we add TILE_SIZE.
      const overallWidth = maxX - minX + TILE_SIZE;
      const overallHeight = maxY - minY + TILE_SIZE;
      console.log(
        `[MinimapMatcher] Discovered overall map dimensions from tiles: Absolute X range ${minX}-${maxX + TILE_SIZE - 1}, Y range ${minY}-${maxY + TILE_SIZE - 1}. Overall pixel dimensions: ${overallWidth}x${overallHeight}`,
      );
      return { minX, maxX, minY, maxY, overallWidth, overallHeight };
    } else {
      console.warn(
        `[MinimapMatcher] No original minimap tile files found in ${ORIGINAL_TILES_PATH}. Cannot determine overall map dimensions.`,
      );
      return null;
    }
  } catch (error) {
    console.error(`[MinimapMatcher] Error scanning original minimap directory ${ORIGINAL_TILES_PATH}:`, error);
    return null;
  }
}

// Function to compare captured minimap buffer with a specific portion of a larger map buffer
// Applies the mask to the captured minimap pixels
// mapOffsetX, mapOffsetY are the coordinates in the LARGER MAP BUFFER
// that the top-left of the captured minimap (0,0) is being aligned to.
// Returns a similarity percentage (0-100)
function compareMinimapWithPortion(capturedMinimapBuffer, mapBufferInfo, mapOffsetX, mapOffsetY) {
  if (!capturedMinimapBuffer || !mapBufferInfo || !mapBufferInfo.buffer) {
    return 0;
  }

  const { buffer: mapBuffer, width: mapWidth, height: mapHeight } = mapBufferInfo;
  const bytesPerPixel = 3;
  let matchingPixels = 0;
  let comparedPixels = 0;

  // Add a flag to log pixel data only for high similarity matches
  const logPixelData = false; // Set to true to enable detailed pixel logging on high match
  let loggedPixels = 0;
  const MAX_LOG_PIXELS = 10; // Limit detailed pixel logging

  for (let y = 0; y < CAPTURED_MINIMAP_HEIGHT; y++) {
    for (let x = 0; x < CAPTURED_MINIMAP_WIDTH; x++) {
      // Check if the current pixel in the captured minimap is within the masked area
      if (capturedMinimapMask[y][x]) {
        continue; // Skip masked pixels
      }

      // Calculate corresponding coordinates in the larger map buffer
      // This is where the captured minimap pixel (x,y) aligns with in the map buffer.
      const mapCoordX = mapOffsetX + x;
      const mapCoordY = mapOffsetY + y;

      // Ensure map coordinates are within the valid bounds of the larger map
      if (mapCoordX < 0 || mapCoordX >= mapWidth || mapCoordY < 0 || mapCoordY >= mapHeight) {
        // This captured minimap pixel does not overlap with the current portion of the map being compared
        continue;
      }

      const capturedIndex = (y * CAPTURED_MINIMAP_WIDTH + x) * bytesPerPixel;
      const mapIndex = (mapCoordY * mapWidth + mapCoordX) * bytesPerPixel;

      // Ensure indices are within buffer bounds (should be covered by the coordinate checks, but double-checking)
      if (capturedIndex + 2 >= capturedMinimapBuffer.length || mapIndex + 2 >= mapBuffer.length) {
        // console.warn("[MinimapMatcher] Index out of bounds during comparison, skipping pixel.");
        continue;
      }

      comparedPixels++;

      const capturedR = capturedMinimapBuffer[capturedIndex];
      const capturedG = capturedMinimapBuffer[capturedIndex + 1];
      const capturedB = capturedMinimapBuffer[capturedIndex + 2];

      const mapR = mapBuffer[mapIndex];
      const mapG = mapBuffer[mapIndex + 1];
      const mapB = mapBuffer[mapIndex + 2];

      // Compare RGB values
      if (capturedR === mapR && capturedG === mapG && capturedB === mapB) {
        matchingPixels++;
      } else if (logPixelData && loggedPixels < MAX_LOG_PIXELS) {
        // Log differing pixels for debugging
        console.log(
          `[MinimapMatcher] Diff pixel at Captured(${x},${y}) Map(${mapCoordX},${mapCoordY}): Captured RGB(${capturedR},${capturedG},${capturedB}) Map RGB(${mapR},${mapG},${mapB})`,
        );
        loggedPixels++;
      }
    }
  }

  const matchPercentage = comparedPixels === 0 ? 0 : (matchingPixels / comparedPixels) * 100;

  // If a high percentage match is found, log some pixel data
  if (logPixelData && matchPercentage >= MIN_MATCH_PERCENTAGE) {
    console.log(`[MinimapMatcher] High match (${matchPercentage.toFixed(2)}%) found. Logging first ${MAX_LOG_PIXELS} differing pixels.`);
    // The differing pixels are logged within the loop above
  }

  return matchPercentage;
}

// This function is exported with the name expected by rawCapture.js for testing.
// It now implements matching against the combined map for floor 7.
// Returns an array containing the single 100% match object with estimated player coordinates if found, otherwise an empty array.
export async function findMatchingMinimapTilesBruteForce(capturedMinimapBuffer) {
  if (!capturedMinimapBuffer) {
    console.error('[MinimapMatcher] Invalid captured minimap buffer for matching.');
    return [];
  }

  const targetFloor = 7; // We are focusing on floor 7

  console.log(`[MinimapMatcher] Starting search for matching location on combined map for floor ${targetFloor}`);

  // Load the combined map for the target floor
  const combinedMapInfo = await loadCombinedMinimap(targetFloor);

  if (!combinedMapInfo) {
    console.error(`[MinimapMatcher] Could not load combined map for floor ${targetFloor}. Cannot perform matching.`);
    return [];
  }

  // Discover overall map dimensions from original tiles to relate combined map pixels to absolute coordinates
  // This is done only once to get the origin (minX, minY) of the combined map in absolute coordinates.
  const overallDimensions = await discoverOverallMinimapDimensions();

  if (!overallDimensions) {
    console.error('[MinimapMatcher] Could not discover overall minimap dimensions. Cannot calculate absolute coordinates.');
    return [];
  }

  // The top-left pixel (0,0) of the combined map image corresponds to the overall minX and minY discovered from tiles.
  const combinedMapAbsOriginX = overallDimensions.minX;
  const combinedMapAbsOriginY = overallDimensions.minY;

  // Log first 5 pixels of the captured minimap buffer for debugging
  const bytesPerPixel = 3;
  let logMsg = '[MinimapMatcher] Captured Minimap Buffer (first 5 pixels):';
  const pixelsToLog = Math.min(5, capturedMinimapBuffer.length / bytesPerPixel);
  for (let i = 0; i < pixelsToLog; i++) {
    const index = i * bytesPerPixel;
    logMsg += ` Pixel ${i}: RGB(${capturedMinimapBuffer[index]},${capturedMinimapBuffer[index + 1]},${capturedMinimapBuffer[index + 2]})`;
  }
  console.log(logMsg);

  // Log first 5 pixels of the loaded combined map buffer for debugging
  let combinedMapLogMsg = `[MinimapMatcher] Combined Map Buffer (floor ${targetFloor}, first 5 pixels):`;
  const combinedMapPixelsToLog = Math.min(5, combinedMapInfo.buffer.length / bytesPerPixel);
  for (let i = 0; i < combinedMapPixelsToLog; i++) {
    const index = i * bytesPerPixel;
    combinedMapLogMsg += ` Pixel ${i}: RGB(${combinedMapInfo.buffer[index]},${combinedMapInfo.buffer[index + 1]},${combinedMapInfo.buffer[index + 2]})`;
  }
  console.log(combinedMapLogMsg);

  // Iterate through all possible top-left offsets within the combined map
  // where the captured minimap's top-left could align.
  const maxCombinedMapOffsetX = combinedMapInfo.width - CAPTURED_MINIMAP_WIDTH;
  const maxCombinedMapOffsetY = combinedMapInfo.height - CAPTURED_MINIMAP_HEIGHT;

  if (maxCombinedMapOffsetX < 0 || maxCombinedMapOffsetY < 0) {
    console.error('[MinimapMatcher] Combined map is smaller than the captured minimap. Cannot perform matching.');
    return [];
  }

  console.log(`[MinimapMatcher] Searching within combined map offsets: X: 0-${maxCombinedMapOffsetX}, Y: 0-${maxCombinedMapOffsetY}`);

  for (let combinedMapOffsetY = 0; combinedMapOffsetY <= maxCombinedMapOffsetY; combinedMapOffsetY++) {
    for (let combinedMapOffsetX = 0; combinedMapOffsetX <= maxCombinedMapOffsetX; combinedMapOffsetX++) {
      const matchPercentage = compareMinimapWithPortion(
        // Use the generic compare function
        capturedMinimapBuffer,
        combinedMapInfo,
        combinedMapOffsetX,
        combinedMapOffsetY,
      );

      // Log matches above the threshold
      if (matchPercentage >= LOG_MATCH_THRESHOLD) {
        console.log(
          `[MinimapMatcher] Match found at combined map offset ${combinedMapOffsetX},${combinedMapOffsetY} with ${matchPercentage.toFixed(2)}% similarity.`,
        );
      }

      if (matchPercentage >= PERFECT_MATCH_PERCENTAGE) {
        console.log(
          `[MinimapMatcher] PERFECT match found at combined map offset ${combinedMapOffsetX},${combinedMapOffsetY} with ${matchPercentage.toFixed(2)}% similarity.`,
        );

        // Calculate player's absolute coordinates
        // Player's absolute X = Combined map absolute origin X + offset within combined map where minimap top-left aligns + player's relative X in captured minimap
        const playerAbsX = combinedMapAbsOriginX + combinedMapOffsetX + PLAYER_RELATIVE_X;
        const playerAbsY = combinedMapAbsOriginY + combinedMapOffsetY + PLAYER_RELATIVE_Y;
        const playerAbsZ = targetFloor; // Player is on the floor of the combined map

        console.log(`[MinimapMatcher] Estimated Player Absolute Coordinates: X=${playerAbsX}, Y=${playerAbsY}, Z=${playerAbsZ}`);

        // Return the first perfect match found immediately
        return [
          {
            combinedMapOffsetX: combinedMapOffsetX, // X offset within the combined map where minimap top-left aligns
            combinedMapOffsetY: combinedMapOffsetY, // Y offset within the combined map where minimap top-left aligns
            similarity: matchPercentage,
            playerAbsX: playerAbsX,
            playerAbsY: playerAbsY,
            playerAbsZ: playerAbsZ,
          },
        ];
      }
    }
  }

  console.log(
    `[MinimapMatcher] Search complete on combined map for floor ${targetFloor}. No perfect match (${PERFECT_MATCH_PERCENTAGE}%) found.`,
  );
  return []; // Return empty array if no perfect match is found
}

// Function to discover the available minimap tile ranges by scanning the original tiles directory
// Returns an object with min/max x, y (absolute coordinates) of the map extent, or null if no tiles are found.
// This is used to understand the scale and origin of the combined map.
async function discoverOverallMinimapDimensions() {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let foundTiles = false;

  try {
    // Check if the original tiles directory exists
    try {
      await fs.access(ORIGINAL_TILES_PATH);
    } catch (error) {
      console.warn(
        `[MinimapMatcher] Original minimap tiles directory not found at ${ORIGINAL_TILES_PATH}. Cannot determine overall map dimensions from tiles.`,
      );
      return null;
    }

    const files = await fs.readdir(ORIGINAL_TILES_PATH);

    const tilePattern = /^Minimap_Color_(\d+)_(\d+)_(\d+)\.png$/;

    for (const file of files) {
      const match = file.match(tilePattern);
      if (match) {
        foundTiles = true;
        const x = parseInt(match[1], 10);
        const y = parseInt(match[2], 10);
        // We don't need Z for overall X/Y dimensions from tiles

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    if (foundTiles) {
      // Calculate the overall dimensions in pixels based on the tile ranges
      // The max X and Y from file names are the top-left corners of the last tiles.
      // To get the full extent, we add TILE_SIZE.
      const overallWidth = maxX - minX + TILE_SIZE;
      const overallHeight = maxY - minY + TILE_SIZE;
      console.log(
        `[MinimapMatcher] Discovered overall map dimensions from tiles: Absolute X range ${minX}-${maxX + TILE_SIZE - 1}, Y range ${minY}-${maxY + TILE_SIZE - 1}. Overall pixel dimensions: ${overallWidth}x${overallHeight}`,
      );
      return { minX, maxX, minY, maxY, overallWidth, overallHeight };
    } else {
      console.warn(
        `[MinimapMatcher] No original minimap tile files found in ${ORIGINAL_TILES_PATH}. Cannot determine overall map dimensions.`,
      );
      return null;
    }
  } catch (error) {
    console.error(`[MinimapMatcher] Error scanning original minimap directory ${ORIGINAL_TILES_PATH}:`, error);
    return null;
  }
}
