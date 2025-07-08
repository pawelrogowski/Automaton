import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false, // State for Lua scripts enable/disable
  persistentScripts: [], // Array to hold persistent Lua script objects
  hotkeyScripts: [], // Array to hold hotkey Lua script objects
};

const luaSlice = createSlice({
  name: 'lua',
  initialState,
  reducers: {
    /**
     * Adds a new Lua script.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - The payload containing script details.
     * @param {string} action.payload.name - The name of the script.
     * @param {string} action.payload.code - The Lua code of the script.
     * @param {'persistent' | 'hotkey'} action.payload.type - The type of script ('persistent' or 'hotkey').
     * @param {boolean} [action.payload.enabled=false] - Initial enabled state for persistent scripts.
     * @param {number} [action.payload.loopMin=1000] - Minimum loop delay in ms for persistent scripts.
     * @param {number} [action.payload.loopMax=5000] - Maximum loop delay in ms for persistent scripts.
     * @param {string | null} [action.payload.hotkey=null] - The hotkey string for hotkey scripts.
     */
    addScript: (state, action) => {
      // The ID is now generated in the renderer for now
      const { id, name, code, type, enabled = false, loopMin = 1000, loopMax = 5000, hotkey = null } = action.payload;
      const newScript = {
        id,
        name: name || 'New Script',
        code: code || '',
        type, // Include type directly in the new script object
        log: [], // Ensure log array is initialized
      };

      if (type === 'persistent') {
        state.persistentScripts.push({ ...newScript, enabled, loopMin, loopMax }); // Include loop properties
      } else if (type === 'hotkey') {
        state.hotkeyScripts.push({ ...newScript, hotkey });
      } else {
        console.warn('Attempted to add script with invalid type:', type);
      }
    },

    /**
     * Adds a log entry to a specific script's log array.
     * This action is expected to be dispatched from the main process (via setGlobalState).
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - The payload containing script ID and log message.
     * @param {string} action.payload.id - The ID of the script to add the log to.
     * @param {string} action.payload.message - The log message.
     */
    addLogEntry: (state, action) => {
      const { id, message } = action.payload;
      // Find the script in either list
      const script = state.persistentScripts.find((s) => s.id === id) || state.hotkeyScripts.find((s) => s.id === id);

      if (script) {
        // Ensure log is an array
        if (!Array.isArray(script.log)) {
          script.log = [];
        }
        script.log.push(message); // Add the message to the log array
        // Optional: Limit log history size
        const MAX_LOG_SIZE = 100; // Define a max size
        if (script.log.length > MAX_LOG_SIZE) {
          script.log.splice(0, script.log.length - MAX_LOG_SIZE); // Remove oldest entries
        }
      } else {
        console.warn('Attempted to add log to unknown script ID:', id);
      }
    },

    /**
     * Clears the log for a specific script.
     * Optional action, could be added later if needed.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {string} action.payload - The ID of the script to clear logs for.
     */
    clearScriptLog: (state, action) => {
      const scriptId = action.payload;
      const script = state.persistentScripts.find((s) => s.id === scriptId) || state.hotkeyScripts.find((s) => s.id === scriptId);
      if (script) {
        script.log = [];
      }
    },

    /**
     * Removes a Lua script by ID from either list.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {string} action.payload - The ID of the script to remove.
     */
    removeScript: (state, action) => {
      const scriptIdToRemove = action.payload;
      state.persistentScripts = state.persistentScripts.filter((script) => script.id !== scriptIdToRemove);
      state.hotkeyScripts = state.hotkeyScripts.filter((script) => script.id !== scriptIdToRemove);
    },

    /**
     * Updates an existing Lua script in either list.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - The payload containing the script ID and updates.\
     * @param {string} action.payload.id - The ID of the script to update.
     * @param {object} action.payload.updates - An object containing fields to update (e.g., { name: 'New Name', code: 'new code', enabled: true, hotkey: 'F2', loopMin: 2000, loopMax: 6000 }).
     */
    updateScript: (state, action) => {
      const { id, updates } = action.payload;

      // Try finding and updating in persistent scripts
      const persistentIndex = state.persistentScripts.findIndex((script) => script.id === id);
      if (persistentIndex !== -1) {
        state.persistentScripts[persistentIndex] = {
          ...state.persistentScripts[persistentIndex],
          ...updates,
          // Ensure log is preserved unless explicitly updated (not currently planned)
          log: state.persistentScripts[persistentIndex].log, // Keep existing log
        };
        // Ensure loopMin/loopMax are numbers if updated
        if (updates.hasOwnProperty('loopMin')) {
          state.persistentScripts[persistentIndex].loopMin = Number(updates.loopMin);
        }
        if (updates.hasOwnProperty('loopMax')) {
          state.persistentScripts[persistentIndex].loopMax = Number(updates.loopMax);
        }

        return; // Found and updated, exit
      }

      // Try finding and updating in hotkey scripts
      const hotkeyIndex = state.hotkeyScripts.findIndex((script) => script.id === id);
      if (hotkeyIndex !== -1) {
        state.hotkeyScripts[hotkeyIndex] = {
          ...state.hotkeyScripts[hotkeyIndex],
          ...updates,
          // Ensure log is preserved unless explicitly updated
          log: state.hotkeyScripts[hotkeyIndex].log, // Keep existing log
        };
        return; // Found and updated, exit
      }

      console.warn('Attempted to update script with unknown ID:', id);
    },

    /**
     * Toggles the enabled status of a persistent script.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {string} action.payload - The ID of the persistent script to toggle.
     */
    togglePersistentScript: (state, action) => {
      const scriptIdToToggle = action.payload;
      const script = state.persistentScripts.find((script) => script.id === scriptIdToToggle);
      if (script) {
        script.enabled = !script.enabled;
        // Optional: Add a log entry indicating the state change
        const status = script.enabled ? 'Enabled' : 'Disabled';
        script.log.push(`[Status] Script ${status}`);
        const MAX_LOG_SIZE = 100; // Define a max size
        if (script.log.length > MAX_LOG_SIZE) {
          script.log.splice(0, script.log.length - MAX_LOG_SIZE); // Remove oldest entries
        }
      }
    },

    setState: (state, action) => {
      const newState = { ...state };

      Object.keys(newState).forEach((key) => {
        newState[key] = action.payload[key];
      });

      return newState;
    },
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },
  },
});

export const { addScript, addLogEntry, removeScript, updateScript, togglePersistentScript, setState, clearScriptLog, setenabled } =
  luaSlice.actions;

export default luaSlice;
