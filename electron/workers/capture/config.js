export const TARGET_FPS = 60;

// --- SharedArrayBuffer (SAB) Indices ---
export const FRAME_COUNTER_INDEX = 0;
export const WIDTH_INDEX = 1;
export const HEIGHT_INDEX = 2;
export const IS_RUNNING_INDEX = 3;
export const WINDOW_ID_INDEX = 4;
export const DIRTY_REGION_COUNT_INDEX = 5;
export const DIRTY_REGIONS_START_INDEX = 6;

// --- Capture Limits ---
// This must match the value used when creating the SharedArrayBuffer
export const MAX_DIRTY_REGIONS = 64;
