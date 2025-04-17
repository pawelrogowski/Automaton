// store/store.js - Orchestrator and Exporter

// --- Core Lifecycle Imports ---
import { stopRedisServer } from './redisServer.js';
import { connectClient, disconnectClient } from './redisClient.js';
import { initializeRedisStateIfEmpty } from './stateInitializer.js';

// --- Re-export functions from the specific store modules ---
// This makes functions from globalStore, gameStateStore, etc.,
// available when importing from 'store/store.js'
export * from './globalStore.js';
export * from './gameStateStore.js';
export * from './healingStore.js';
// If you add more slice files (e.g., ./someOtherStore.js), add them here:
// export * from './someOtherStore.js';


// --- Lifecycle Functions Defined Here ---

/**
 * Initializes the Redis store: starts server, connects client, ensures default state.
 */
async function initializeStore() {
  console.log('[Store] Initializing...');
  try {
    // Ensure client is connected (implicitly starts server via connectClient)
    await connectClient();
    // Ensure the default state structure exists in Redis
    await initializeRedisStateIfEmpty();
    console.log('[Store] Initialization complete.');
  } catch (error) {
    console.error('[Store] Initialization failed:', error);
    // Attempt cleanup even on initialization failure
    await quitStore();
    // Re-throw the error so the main process knows initialization failed
    throw error;
  }
}

/**
 * Shuts down the Redis store: disconnects client, stops server.
 */
async function quitStore() {
  console.log('[Store] Shutting down...');
  // Disconnect the client gracefully
  await disconnectClient();
  // Stop the underlying Redis server process
  await stopRedisServer();
  console.log('[Store] Shutdown complete.');
}

// --- Final Exports ---
// Export the main lifecycle functions defined in *this* file
export { initializeStore, quitStore };

// Note: The specific store functions (like getGlobalState, updateHealingRuleField, etc.)
// are already exported via the `export * from ...` lines above.
// Consumers of this module can import them directly, e.g.:
// import { initializeStore, getGlobalState, addHealingRule } from './store/store.js';
