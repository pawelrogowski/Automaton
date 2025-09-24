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
  actionStateChangeTimeoutMs: 200,
  postDiagonalMoveDelayMs: 150,
  postTeleportGraceMs: 750,
  moveConfirmTimeoutMs: 400,
  moveConfirmTimeoutDiagonalMs: 650,
  defaultAwaitStateChangeTimeoutMs: 500,
  floorChangeGraceMs: 500,
  controlHandoverGraceMs: 100,

  // --- Retries & Delays ---
  standStillThresholdMs: 3000, // Time before unstuck mechanism triggers
  maxScriptRetries: 1,
  maxMacheteRetries: 3, // Centralized from hardcoded value
  actionFailureRetryDelayMs: 500, // Renamed from macheteRetryDelay
  scriptErrorDelayMs: 250,

  // --- Gameplay Parameters ---
  teleportDistanceThreshold: 5,
  toolHotkeys: {
    rope: 'b',
    machete: 'n',
    shovel: 'v',
  },
  creatureMonitorSyncTimeoutMs: 1000, // Timeout for CreatureMonitor Z-level sync
};
