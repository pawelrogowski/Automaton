import { createSlice } from '@reduxjs/toolkit';

const initialState = {
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
     * @param {string | null} [action.payload.hotkey=null] - The hotkey string for hotkey scripts.
     */
    addScript: (state, action) => {
      // The ID is now generated in the main process before dispatching this action
      const { id, name, code, type, enabled = false, hotkey = null } = action.payload;
      const newScript = {
        id, // Use the ID provided in the action payload
        name: name || 'New Script',
        code: code || '',
      };

      if (type === 'persistent') {
        state.persistentScripts.push({ ...newScript, enabled });
      } else if (type === 'hotkey') {
        state.hotkeyScripts.push({ ...newScript, hotkey });
      } else {
        console.warn('Attempted to add script with invalid type:', type);
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
      state.persistentScripts = state.persistentScripts.filter(script => script.id !== scriptIdToRemove);
      state.hotkeyScripts = state.hotkeyScripts.filter(script => script.id !== scriptIdToRemove);
    },

    /**
     * Updates an existing Lua script in either list.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - The payload containing the script ID and updates.\
     * @param {string} action.payload.id - The ID of the script to update.
     * @param {object} action.payload.updates - An object containing fields to update (e.g., { name: 'New Name', code: 'new code', enabled: true, hotkey: 'F2' }).
     */
    updateScript: (state, action) => {
      const { id, updates } = action.payload;

      // Try finding and updating in persistent scripts
      const persistentIndex = state.persistentScripts.findIndex(script => script.id === id);
      if (persistentIndex !== -1) {
        state.persistentScripts[persistentIndex] = { ...state.persistentScripts[persistentIndex], ...updates };
        return; // Found and updated, exit
      }

      // Try finding and updating in hotkey scripts
      const hotkeyIndex = state.hotkeyScripts.findIndex(script => script.id === id);
      if (hotkeyIndex !== -1) {
        state.hotkeyScripts[hotkeyIndex] = { ...state.hotkeyScripts[hotkeyIndex], ...updates };
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
        const script = state.persistentScripts.find(script => script.id === scriptIdToToggle);
        if (script) {
            script.enabled = !script.enabled;
        }
    },

    /**
     * Replaces the entire scripts state. Useful for loading saved scripts.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {{ persistentScripts: Array<object>, hotkeyScripts: Array<object> }} action.payload - Object containing arrays of persistent and hotkey script objects.
     */
    loadScripts: (state, action) => {
        state.persistentScripts = action.payload?.persistentScripts || [];
        state.hotkeyScripts = action.payload?.hotkeyScripts || [];
    },
  },
});

// Export the actions. setScriptStatus, requestScriptExecution, triggerHotkeyScriptExecution are removed.
export const {
    addScript,
    removeScript,
    updateScript,
    togglePersistentScript,
    loadScripts,
} = luaSlice.actions;

export default luaSlice;