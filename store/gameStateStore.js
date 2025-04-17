// import { getStoreClient } from './redisClient.js'; // Already removed

const SLICE_NAME = 'gameState';

export const initialGameState = {
  hpPercentage: null,
  manaPercentage: null,
  isVisible: false,
  healingCdActive: false,
  supportCdActive: false,
  attackCdActive: false,
  monsterNum: 0,
  partyNum: 0,
  characterStatus: {
    bleeding: false, burning: false, cursed: false, dazzled: false,
    drowning: false, drunk: false, electrified: false, freezing: false,
    hasted: false, hexed: false, hungry: false, battleSign: false,
    magicShield: false, eRing: false, poisoned: false, redBattleSign: false,
    paralyzed: false, strengthened: false, inProtectedZone: false,
    inRestingArea: false, whiteSkull: false, redSkull: false,
  },
};

/** Helper to get formatted timestamp */
function getFormattedTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `[${hours}:${minutes}:${seconds}:${ms}]`;
}

/** Helper to format state values for logging */
function formatLogValue(value) {
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value); // Keep objects/arrays stringified
    return String(value); // Convert others to string
}

/** Helper to parse HGETALL results back to correct types */
function parseGameState(hashData) {
    if (!hashData) return initialGameState;
    const state = {};
     for (const key in initialGameState) {
        if (hashData.hasOwnProperty(key)) {
            const value = hashData[key];
            switch (typeof initialGameState[key]) {
                case 'number':
                    // Handle float for percentages if needed, else parseInt
                    if (key.includes('Percentage')) {
                       state[key] = parseFloat(value); // Keep null if parsing fails? or default?
                       if (isNaN(state[key])) state[key] = null; // Reset to null if parse failed
                    } else {
                       state[key] = parseInt(value, 10) || 0;
                    }
                    break;
                case 'boolean':
                    state[key] = value === 'true';
                    break;
                case 'object': // Handles characterStatus
                    try {
                        state[key] = JSON.parse(value);
                    } catch (e) {
                         console.error(`[${SLICE_NAME}Store] Error parsing JSON for key ${key}:`, e);
                         state[key] = initialGameState[key];
                    }
                    break;
                default: state[key] = value;
            }
        } else { state[key] = initialGameState[key]; }
    }
     // Ensure all default keys are present
    for(const key in initialGameState) {
        if (!state.hasOwnProperty(key)) { state[key] = initialGameState[key]; }
    }
    return state;
}

/** Fetches the gameState slice using HGETALL */
export async function getGameState(client) {
  if (!client || !client.isReady) { return initialGameState; }
  try {
    const hashData = await client.hGetAll(SLICE_NAME);
    return parseGameState(hashData);
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error getting state with HGETALL:`, error);
    return initialGameState;
  }
}

/** Replaces the entire gameState using HSET */
export async function setGameState(client, newState) {
   if (!client || !client.isReady) { return false; }
   try {
     const hashData = prepareInitialHashData(newState); // Reuse helper
     // await client.del(SLICE_NAME); // Optional DEL for true replace
     await client.hSet(SLICE_NAME, hashData);
     return true;
   } catch (error) {
     console.error(`[${SLICE_NAME}Store] Error setting state with HSET:`, error);
     return false;
   }
}

/** Internal helper to update specific fields using HSET with logging */
async function _updateSingleFieldGameState(client, field, value) {
    if (!client || !client.isReady) { /* ... error */ return false; }
    try {
        let valueToSet;
        if (typeof value === 'object' && value !== null) {
            valueToSet = JSON.stringify(value);
        } else {
             // Handle null specifically for percentages
             if ((field === 'hpPercentage' || field === 'manaPercentage') && value === null) {
                 valueToSet = 'null'; // Store null explicitly as string 'null' if needed, or handle in parse
             } else {
                 valueToSet = String(value ?? '');
             }
        }

        // --- Logging ---
        const oldValueStr = await client.hGet(SLICE_NAME, field);
        if (oldValueStr !== valueToSet) { // Only log if changed
             const timestamp = getFormattedTimestamp();
             let logKeyName = field;
             if (field === 'hpPercentage') logKeyName = 'HP';
             else if (field === 'manaPercentage') logKeyName = 'Mana';
             console.log(`${timestamp} ${logKeyName}: ${formatLogValue(oldValueStr)} -> ${formatLogValue(valueToSet)}`);
        }
        // --- End Logging ---

        await client.hSet(SLICE_NAME, field, valueToSet);
        return true;
    } catch (error) {
        console.error(`[${SLICE_NAME}Store] Error updating field ${field} with HSET:`, error);
        return false;
    }
}

/** Sets the health percentage */
export async function setHealthPercent(client, hpPercentage) {
    const validatedHp = (typeof hpPercentage === 'number') ? Math.max(0, Math.min(100, hpPercentage)) : null;
    // Pass validated value (could be null)
    return _updateSingleFieldGameState(client, 'hpPercentage', validatedHp);
}

/** Sets the mana percentage */
export async function setManaPercent(client, manaPercentage) {
    const validatedMana = (typeof manaPercentage === 'number') ? Math.max(0, Math.min(100, manaPercentage)) : null;
    return _updateSingleFieldGameState(client, 'manaPercentage', validatedMana);
}

/** Sets the healing cooldown status */
export async function setHealingCdActive(client, isActive) {
    return _updateSingleFieldGameState(client, 'healingCdActive', Boolean(isActive));
}

/** Sets the support cooldown status */
export async function setSupportCdActive(client, isActive) {
    return _updateSingleFieldGameState(client, 'supportCdActive', Boolean(isActive));
}

/** Sets the attack cooldown status */
export async function setAttackCdActive(client, isActive) {
    return _updateSingleFieldGameState(client, 'attackCdActive', Boolean(isActive));
}

/** Updates character status flags (merges) - NOW ACCEPTS CLIENT */
export async function setCharacterStatus(client, statusUpdates) {
    if (!client || !client.isReady) { /*...*/ return false; }
    if (!statusUpdates || typeof statusUpdates !== 'object') return false;
    let retries = 0;
    while(retries < MAX_UPDATE_RETRIES) { // Use retry logic for this specific field
        try {
            await client.watch(SLICE_NAME); // Watch the whole hash key
            const currentStateStr = await client.hGet(SLICE_NAME, 'characterStatus');
            const currentStatus = currentStateStr ? JSON.parse(currentStateStr) : initialGameState.characterStatus;
            const newStatus = { ...currentStatus };
            for (const key in statusUpdates) {
                if (initialGameState.characterStatus.hasOwnProperty(key)) {
                    newStatus[key] = Boolean(statusUpdates[key]);
                }
            }
            const newStatusStr = JSON.stringify(newStatus);

            // Only proceed if changed
            if (newStatusStr === currentStateStr) {
                await client.unwatch();
                return true; // No change needed
            }

            const multi = client.multi()
                .hSet(SLICE_NAME, 'characterStatus', newStatusStr);
            const results = await multi.exec();

            if (results === null) { // Conflict
                retries++;
                console.warn(`[${SLICE_NAME}Store] Conflict on setCharacterStatus (Attempt ${retries}). Retrying...`);
                 if (retries >= MAX_UPDATE_RETRIES) { console.error(`[${SLICE_NAME}Store] Max retries reached for setCharacterStatus.`); return false; }
                 await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                 continue; // Retry
            }
            // Log change here if desired, after successful exec
            // console.log(`${getFormattedTimestamp()} characterStatus updated.`);
            return true; // Success

        } catch (error) {
            console.error(`[${SLICE_NAME}Store] Error setting character status:`, error);
            if (client.isWatching) await client.unwatch();
            return false; // Exit loop on error
        }
    }
    return false; // Should only be reached if max retries exceeded
}

/** Sets the number of monsters */
export async function setMonsterNum(client, num) {
    const validatedNum = Math.max(0, parseInt(num, 10) || 0);
    return _updateSingleFieldGameState(client, 'monsterNum', validatedNum);
}

/** Sets the number of party members */
export async function setPartyNum(client, num) {
    const validatedNum = Math.max(0, parseInt(num, 10) || 0);
    return _updateSingleFieldGameState(client, 'partyNum', validatedNum);
}

// ... other specific setters corresponding to gameStateSlice reducers ... 