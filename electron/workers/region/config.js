// @electron/workers/region/config.js
// --- Worker Timing & Performance ---
export const SCAN_INTERVAL_MS = 50; // The base interval for the main loop.
export const PERFORMANCE_LOGGING_ENABLED = true;
export const PERFORMANCE_LOG_INTERVAL_MS = 10000;

// --- Dirty Rectangle Management ---
export const DIRTY_RECT_MERGE_THRESHOLD = 50; // (px) Merge rects if they are this close.
export const DIRTY_RECT_MAX_AGE_FRAMES = 5; // How many frames a dirty rect is remembered.

// --- Scan Strategy ---
export const FULL_SCAN_FALLBACK_PERCENTAGE = 50; // If dirty area > 30%, force a full scan.
export const FULL_SCAN_SAFETY_NET_INTERVAL_MS = 500; // Force a full scan every 2s as a safety net.
export const MIN_REGION_SIZE = 10; // Minimum size for a region to be considered valid.
export const MAX_REGIONS_PER_FRAME = 100; // Maximum number of regions to process per frame.

// --- SharedArrayBuffer (SAB) Indices ---
export const FRAME_COUNTER_INDEX = 0;
export const WIDTH_INDEX = 1;
export const HEIGHT_INDEX = 2;
export const IS_RUNNING_INDEX = 3;
export const DIRTY_REGION_COUNT_INDEX = 5;
export const DIRTY_REGIONS_START_INDEX = 6;

// --- BattleList Constants ---
export const BATTLE_LIST_ENTRY_HEIGHT = 20;
export const BATTLE_LIST_ENTRY_VERTICAL_PITCH = 22;
