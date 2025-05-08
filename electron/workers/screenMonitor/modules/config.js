// --- Constants and Configuration ---

// Timeouts and Intervals (in milliseconds)
// export const RESIZE_STABILIZE_DELAY = 250; // Not currently used, consider removing if confirmed
export const MINIMAP_CHANGE_INTERVAL = 128; // ms after change before minimapChanged becomes false again
export const GET_FRAME_RETRY_DELAY = 60; // ms delay between retries for getting initial frame
export const GET_FRAME_MAX_RETRIES = 10; // Max retries for getting initial frame


// --- Feature Toggles & Settings ---
export const config = {
  // --- Region Capturing ---
  captureRegions: { // Toggle features on/off
    hpMana: { enabled: true },
    cooldowns: { enabled: true },
    statusBar: { enabled: true },
    battleList: { enabled: true },
    partyList: { enabled: true },
    minimap: { enabled: true },
    actionBars: { enabled: true },
  },

  // --- Processing Logic ---
  processing: {
    trackMinimap: true,
    monitorCooldowns: true,
    handleParty: true,
  },

  // --- Logging Configuration ---
  logging: { // Control console output
    // --- General ---
    logInitialization: true,     // Log steps during the initializeRegions function
    logPerformanceMetrics: false, // Toggle performance logging
    clearTerminal: false,        // Clear terminal before each iteration's log output
    logRegionCaptureFailures: false, // Log warnings if specific regions aren't found during init
    // --- Screen Monitor Specific ---
    logCaptureStatus: false,     // Log getLatestFrame success/failure/stale data status
    // --- Rule Processor Specific ---
    logRuleProcessingSteps: false, // Log count of rules remaining after each filter step
    logRuleExecutionDetails: false,// Log details when attempting/executing/failing rules (includes input simulation)
    logActiveActionItems: false, // Log which action items are detected as active each cycle (keep this one)
    logEquippedItems: false,
  }
};