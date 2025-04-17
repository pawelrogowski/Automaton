// import { getStoreClient } from './redisClient.js'; // No longer needed at top level

const SLICE_NAME = 'global';

export const initialGlobalState = {
  windowTitle: 'Press Alt+W on focused tibia window to attach bot',
  windowId: null,
  windowPos: { x: 0, y: 0 },
  botEnabled: false,
  refreshRate: 32,
  notificationsEnabled: true,
  activePresetIndex: 0, // Note: Belongs here based on globalSlice.js
};

/** Helper to parse HGETALL results back to correct types */
function parseGlobalState(hashData) {
    if (!hashData) return initialGlobalState; // Return default if no data
    const state = {};
    for (const key in initialGlobalState) { // Iterate over known keys
        if (hashData.hasOwnProperty(key)) {
            const value = hashData[key];
            // Basic type inference based on initial state
            switch (typeof initialGlobalState[key]) {
                case 'number':
                    state[key] = parseFloat(value) || 0; // Parse float, default 0
                    break;
                case 'boolean':
                    state[key] = value === 'true';
                    break;
                case 'object':
                    // Handle null and nested objects (like windowPos)
                    if (initialGlobalState[key] === null) {
                        state[key] = value === 'null' ? null : value; // Allow storing non-null ID etc.
                    } else {
                        try {
                            state[key] = JSON.parse(value);
                        } catch (e) {
                            console.error(`[${SLICE_NAME}Store] Error parsing JSON for key ${key}:`, e);
                            state[key] = initialGlobalState[key]; // Fallback to default
                        }
                    }
                    break;
                default: // String or other
                    state[key] = value;
            }
        } else {
            // Key missing in Redis, use default
            state[key] = initialGlobalState[key];
        }
    }
    // Ensure all default keys are present even if not in Redis
    for(const key in initialGlobalState) {
        if (!state.hasOwnProperty(key)) {
            state[key] = initialGlobalState[key];
        }
    }
    return state;
}

/** Fetches the global state slice using HGETALL */
export async function getGlobalState(client) {
  if (!client || !client.isReady) { /* ... error handling ... */ return initialGlobalState; }
  try {
    const hashData = await client.hGetAll(SLICE_NAME);
    return parseGlobalState(hashData); // Parse the raw hash data
  } catch (error) {
    console.error(`[${SLICE_NAME}Store] Error getting state with HGETALL:`, error);
    return initialGlobalState; // Return default on error
  }
}

/** Replaces the entire global state using HSET */
export async function setGlobalState(client, newState) {
   if (!client || !client.isReady) { /* ... error handling ... */ return false; }
   try {
     const hashData = prepareInitialHashData(newState); // Use helper from initializer
     // Consider using DEL first then HSET for a true replace? Or just HSET.
     // await client.del(SLICE_NAME); // Optional: If you need a true replace
     await client.hSet(SLICE_NAME, hashData);
     return true;
   } catch (error) {
     console.error(`[${SLICE_NAME}Store] Error setting state with HSET:`, error);
     return false;
   }
}

// --- Internal Update Helper using HSET (No WATCH needed for single HSET) ---
/** Internal helper to update specific fields using HSET */
async function _updateSingleField(client, field, value) {
    if (!client || !client.isReady) {
        console.error(`[${SLICE_NAME}Store] Cannot update field ${field}: Invalid client.`);
        return false;
    }
    try {
        let valueToSet;
        // Prepare value for HSET (stringify objects/arrays, convert others to string)
        if (typeof value === 'object' && value !== null) {
            valueToSet = JSON.stringify(value);
        } else {
            valueToSet = String(value ?? ''); // Handle null/undefined
        }

        // --- Optional: Add Logging ---
        // const oldValue = await client.hGet(SLICE_NAME, field); // Read before write for logging
        // const timestamp = getFormattedTimestamp(); // Need timestamp helper here too
        // if (String(oldValue) !== valueToSet) { // Compare string representations
        //      console.log(`${timestamp} ${field}: ${formatLogValue(oldValue)} -> ${formatLogValue(valueToSet)}`);
        // }
        // --- End Optional Logging ---

        await client.hSet(SLICE_NAME, field, valueToSet);
        return true; // HSET is atomic per field
    } catch (error) {
        console.error(`[${SLICE_NAME}Store] Error updating field ${field} with HSET:`, error);
        return false;
    }
}

// --- Reducer Equivalents using HSET ---

export async function setWindowTitle(client, title) {
    return _updateSingleField(client, 'windowTitle', String(title ?? ''));
}

export async function setWindowId(client, windowId) {
    // Allow null or string/number ID - store as string
    return _updateSingleField(client, 'windowId', windowId);
}

export async function setIsBotEnabled(client, isEnabled) {
    return _updateSingleField(client, 'botEnabled', Boolean(isEnabled));
}

export async function setRefreshRate(client, rate) {
    const validatedRate = Math.max(0, parseInt(rate, 10) || 0);
    return _updateSingleField(client, 'refreshRate', validatedRate);
}

// Toggles need Read-Modify-Write, so WATCH/MULTI is still needed here
export async function toggleNotifications(client) {
    if (!client || !client.isReady) return false;
     try {
        await client.watch(SLICE_NAME);
        // Read only the specific field needed
        const currentValStr = await client.hGet(SLICE_NAME, 'notificationsEnabled');
        const currentVal = currentValStr === 'true'; // Parse boolean
        const newVal = !currentVal;

        const multi = client.multi()
            .hSet(SLICE_NAME, 'notificationsEnabled', String(newVal)); // Set new string value
        const results = await multi.exec();
        if (results === null) { console.warn(`[${SLICE_NAME}Store] Conflict on toggle notifications.`); return false; }
        // Optional log change here if needed
        return true;
     } catch (error) {
        console.error(`[${SLICE_NAME}Store] Error toggling notifications:`, error);
        if(client.isWatching) await client.unwatch(); return false;
     }
}

export async function toggleBotEnabled(client) {
     if (!client || !client.isReady) return false;
     try {
        await client.watch(SLICE_NAME);
        const currentValStr = await client.hGet(SLICE_NAME, 'botEnabled');
        const currentVal = currentValStr === 'true';
        const newVal = !currentVal;

        const multi = client.multi()
            .hSet(SLICE_NAME, 'botEnabled', String(newVal));
        const results = await multi.exec();
        if (results === null) { console.warn(`[${SLICE_NAME}Store] Conflict on toggle bot.`); return false; }
        return true;
     } catch (error) {
        console.error(`[${SLICE_NAME}Store] Error toggling bot enabled:`, error);
        if(client.isWatching) await client.unwatch(); return false;
     }
}

export async function setActivePresetIndex(client, index) {
    const validIndex = Math.max(0, Math.min(4, parseInt(index, 10) || 0));
    return _updateSingleField(client, 'activePresetIndex', validIndex);
}

export async function setWindowPos(client, pos) {
    const validPos = (pos && typeof pos.x === 'number' && typeof pos.y === 'number')
        ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
    // Store nested object as JSON string
    return _updateSingleField(client, 'windowPos', validPos);
}

/*
// Note on `setState` from globalSlice:
// The original `setState` had complex logic to exclude certain keys.
// Replicating this precisely might be fragile. It's often better to use
// specific setters or the generic `setGlobalState` if a full replace is needed.
// If absolutely required, it could be implemented like this:
export async function setPartialGlobalState(payload) {
     const client = getStoreClient();
    if (!client) return false;
     try {
        await client.watch(SLICE_NAME);
        const currentState = await getGlobalState();
        const newState = { ...currentState };
        const excludedKeys = ['windowId', 'windowPos', 'botEnabled']; // Keys to keep from current state

        for (const key in payload) {
            if (initialGlobalState.hasOwnProperty(key) && !excludedKeys.includes(key)) {
                newState[key] = payload[key];
            }
        }

        const multi = client.multi().set(SLICE_NAME, JSON.stringify(newState));
        const results = await multi.exec();
        if (results === null) { console.warn(`[${SLICE_NAME}Store] Conflict on setPartialGlobalState.`); return false; }
        return true;
     } catch (error) {
        console.error(`[${SLICE_NAME}Store] Error in setPartialGlobalState:`, error);
        await client.unwatch(); return false;
     }
}
*/ 