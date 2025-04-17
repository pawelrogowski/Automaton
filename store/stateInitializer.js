import { getStoreClient } from './redisClient.js';
import { initialGlobalState } from './globalStore.js';
import { initialGameState } from './gameStateStore.js';
import { initialHealingState } from './healingStore.js';

/** Helper to prepare initial state object for HSET */
function prepareInitialHashData(stateObject) {
    const hashData = {};
    for (const [key, value] of Object.entries(stateObject)) {
        if (typeof value === 'object' && value !== null) {
            hashData[key] = JSON.stringify(value); // Stringify nested objects
        } else {
            hashData[key] = String(value ?? ''); // Convert others to string (handle null/undefined)
        }
    }
    return hashData;
}

/** Checks/initializes state. Uses Hashes for global/gameState, String for healing. */
async function initializeRedisStateIfEmpty() {
  const client = getStoreClient();
  if (!client) {
    console.error('[StateInit] Cannot initialize state: Client not available.');
    throw new Error('Redis client not connected for state initialization.');
  }

  try {
    console.log('[StateInit] Checking initial state...');
    const globalExists = await client.exists('global');
    const gameStateExists = await client.exists('gameState');
    const healingExists = await client.exists('healing');

    const multi = client.multi(); // Use transaction for all initializations

    // Initialize 'global' Hash if needed
    if (!globalExists) {
        console.log('[StateInit] Initializing default "global" hash...');
        const globalHashData = prepareInitialHashData(initialGlobalState);
        multi.hSet('global', globalHashData); // Use HSET with object
    } else {
        console.log('[StateInit] "global" hash already exists.');
    }

    // Initialize 'gameState' Hash if needed
    if (!gameStateExists) {
        console.log('[StateInit] Initializing default "gameState" hash...');
        const gameStateHashData = prepareInitialHashData(initialGameState);
        multi.hSet('gameState', gameStateHashData);
    } else {
        console.log('[StateInit] "gameState" hash already exists.');
    }

    // Initialize 'healing' String if needed (keeping as string for now)
    if (!healingExists) {
        console.log('[StateInit] Initializing default "healing" string...');
        multi.set('healing', JSON.stringify(initialHealingState));
    } else {
        console.log('[StateInit] "healing" string already exists.');
    }

    // Execute the transaction
    const results = await multi.exec();
    if (results === null) {
        console.error('[StateInit] MULTI/EXEC failed during initialization.');
        throw new Error('Atomic state initialization failed.');
    }
    // Optional: Check individual results in the array for errors
    console.log('[StateInit] Default state initialization check complete.');

  } catch (error) {
    console.error('[StateInit] Error during state initialization:', error);
    throw error;
  }
}

export { initializeRedisStateIfEmpty }; 