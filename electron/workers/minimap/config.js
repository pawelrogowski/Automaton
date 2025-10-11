import { PALETTE_DATA } from '../../constants/palette.js';

// --- Worker Timing ---

export const MINIMAP_FALLBACK_INTERVAL_MS = 5000;

// --- Performance Logging ---
export const PERFORMANCE_LOGGING_ENABLED = false; // Set to false to disable logging
export const PERFORMANCE_LOG_INTERVAL_MS = 10000; // Log stats every 10 seconds

// --- SharedArrayBuffer (SAB) Indices ---
export const FRAME_COUNTER_INDEX = 0;
// ... (rest of the file is unchanged)
export const WIDTH_INDEX = 1;
export const HEIGHT_INDEX = 2;
export const IS_RUNNING_INDEX = 3;
export const DIRTY_REGION_COUNT_INDEX = 5;
export const DIRTY_REGIONS_START_INDEX = 6;

// --- Image Buffer Constants ---
export const HEADER_SIZE = 8;
export const BYTES_PER_PIXEL = 4;

// --- Minimap Specifics ---
export const MINIMAP_WIDTH = 106;
export const MINIMAP_HEIGHT = 109;
export const LANDMARK_SIZE = 3;
/**
 * A pre-computed map for fast lookups of a color's 8-bit palette index.
 * Key: An integer representing an RGB color (e.g., (r << 16) | (g << 8) | b).
 * Value: The 8-bit index from the palette.
 */
export const colorToIndexMap = new Map();
PALETTE_DATA.forEach((color, index) => {
  const intKey = (color.r << 16) | (color.g << 8) | color.b;
  colorToIndexMap.set(intKey, index);
});
