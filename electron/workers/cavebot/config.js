// /workers/cavebot/config.js

/**
 * Centralized configuration for the Cavebot Worker.
 * All time-based values are in milliseconds (Ms).
 */
export const config = {
  // --- Core Loop & Timing ---
  mainLoopIntervalMs: 25,
  stateChangePollIntervalMs: 5,
  mainLoopErrorDelayMs: 1000, // Delay after a critical error in the main loop

  // --- Action & Movement Timing ---
  animationArrivalTimeoutMs: 500, // Used for shovel/rope to let animation settle
  actionStateChangeTimeoutMs: 250,
  moveConfirmTimeoutMs: 400,
  moveConfirmTimeoutDiagonalMs: 550,
  defaultAwaitStateChangeTimeoutMs: 250,
  controlHandoverGraceMs: 5,

  // --- Map Click Controls ---
  mapClickStartMoveTimeoutMs: 500, // Wait up to 500ms to confirm movement after a minimap click
  mapClickStallIntervalMs: 400, // Consider auto-walk stalled if no tile change for 400ms
  mapClickMinPathLength: 15, // Only use minimap click when path length is at least 15
  mapClickKeyboardOnlyThreshold: 4, // Always use keyboard when remaining path length <= 4
  mapClickFallbackMinMs: 10000, // Keyboard fallback window min
  mapClickFallbackMaxMs: 15000, // Keyboard fallback window max

  // --- Retries & Delays ---
  maxScriptRetries: 1,
  maxMacheteRetries: 3, // Centralized from hardcoded value
  actionFailureRetryDelayMs: 250, // Renamed from macheteRetryDelay
  scriptErrorDelayMs: 250,

  // --- Gameplay Parameters ---
  teleportDistanceThreshold: 5,
  toolHotkeys: {
    rope: 'b',
    machete: 'n',
    shovel: 'v',
  },
};
