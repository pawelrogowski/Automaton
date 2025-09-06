import { createSlice } from '@reduxjs/toolkit';

const DEBOUNCE_DELAY = 500; // 500ms debounce delay

const initialState = {
  enabled: false, // State for Lua scripts enable/disable
  persistentScripts: [], // Array to hold persistent Lua script objects
  hotkeyScripts: [], // Array to hold hotkey Lua script objects
  error: null,
  _lastEnabledChange: 0, // Internal timestamp for debouncing
  _lastScriptToggle: {}, // Internal timestamps for individual script debouncing
};

const luaSlice = createSlice({
  name: 'lua',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    /**
     * Adds a new Lua script.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - The payload containing script details.
     */
    addScript: (state, action) => {
      const {
        id,
        name,
        code,
        type,
        enabled = false,
        loopMin = 1000,
        loopMax = 5000,
        hotkey = null,
      } = action.payload;

      const nameExists =
        state.persistentScripts.some((script) => script.name === name) ||
        state.hotkeyScripts.some((script) => script.name === name);

      if (nameExists) {
        state.error = `Script with name \"${name}\" already exists.`;
        console.warn(state.error);
        return;
      }
      state.error = null; // Clear previous error

      const newScript = {
        id,
        name: name || 'New Script',
        code: code || '',
        type,
        log: [], // Ensure log array is initialized
      };

      if (type === 'persistent') {
        state.persistentScripts.push({
          ...newScript,
          enabled,
          loopMin,
          loopMax,
        });
      } else if (type === 'hotkey') {
        state.hotkeyScripts.push({ ...newScript, hotkey });
      } else {
        console.warn('Attempted to add script with invalid type:', type);
      }
    },

    /**
     * Adds a timestamped log entry to a specific script's log array.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     */
    addLogEntry: (state, action) => {
      const { id, message } = action.payload;
      const script =
        state.persistentScripts.find((s) => s.id === id) ||
        state.hotkeyScripts.find((s) => s.id === id);

      if (script) {
        if (!Array.isArray(script.log)) {
          script.log = [];
        }
        // Create a timestamp string with milliseconds
        const now = new Date();
        const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

        script.log.push(`[${timestamp}] ${message}`);

        const MAX_LOG_SIZE = 100;
        if (script.log.length > MAX_LOG_SIZE) {
          script.log.splice(0, script.log.length - MAX_LOG_SIZE);
        }
      } else {
        console.warn('Attempted to add log to unknown script ID:', id);
      }
    },

    /**
     * Clears the log for a specific script.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     */
    clearScriptLog: (state, action) => {
      const scriptId = action.payload;
      const script =
        state.persistentScripts.find((s) => s.id === scriptId) ||
        state.hotkeyScripts.find((s) => s.id === scriptId);
      if (script) {
        script.log = [];
      }
    },

    /**
     * Removes a Lua script by ID from either list.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     */
    removeScript: (state, action) => {
      const scriptIdToRemove = action.payload;
      state.persistentScripts = state.persistentScripts.filter(
        (script) => script.id !== scriptIdToRemove,
      );
      state.hotkeyScripts = state.hotkeyScripts.filter(
        (script) => script.id !== scriptIdToRemove,
      );
    },

    /**
     * Updates an existing Lua script in either list.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     */
    updateScript: (state, action) => {
      const { id, updates } = action.payload;

      if (updates.name) {
        const nameExists = 
          state.persistentScripts.some(
            (script) => script.name === updates.name && script.id !== id,
          ) ||
          state.hotkeyScripts.some(
            (script) => script.name === updates.name && script.id !== id,
          );
        if (nameExists) {
          state.error = `Script with name \"${updates.name}\" already exists.`;
          console.warn(state.error);
          return;
        }
        state.error = null;
      }

      const persistentIndex = state.persistentScripts.findIndex(
        (script) => script.id === id,
      );
      if (persistentIndex !== -1) {
        state.persistentScripts[persistentIndex] = {
          ...state.persistentScripts[persistentIndex],
          ...updates,
          log: state.persistentScripts[persistentIndex].log,
        };
        if (updates.hasOwnProperty('loopMin'))
          state.persistentScripts[persistentIndex].loopMin = Number(
            updates.loopMin,
          );
        if (updates.hasOwnProperty('loopMax'))
          state.persistentScripts[persistentIndex].loopMax = Number(
            updates.loopMax,
          );
        return;
      }

      const hotkeyIndex = state.hotkeyScripts.findIndex(
        (script) => script.id === id,
      );
      if (hotkeyIndex !== -1) {
        state.hotkeyScripts[hotkeyIndex] = {
          ...state.hotkeyScripts[hotkeyIndex],
          ...updates,
          log: state.hotkeyScripts[hotkeyIndex].log,
        };
        return;
      }

      console.warn('Attempted to update script with unknown ID:', id);
    },

    /**
     * Toggles the enabled status of a persistent script.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     */
    togglePersistentScript: (state, action) => {
      const scriptIdToToggle = action.payload;
      const now = Date.now();

      // Ensure _lastScriptToggle exists
      if (!state._lastScriptToggle) {
        state._lastScriptToggle = {};
      }

      // Check if this script was toggled recently
      const lastToggle = state._lastScriptToggle[scriptIdToToggle] || 0;
      if (now - lastToggle < DEBOUNCE_DELAY) {
        return; // Skip if toggled within debounce delay
      }

      const script = state.persistentScripts.find(
        (script) => script.id === scriptIdToToggle,
      );
      if (script) {
        script.enabled = !script.enabled;
        const status = script.enabled ? 'Enabled' : 'Disabled';
        if (!Array.isArray(script.log)) script.log = [];
        script.log.push(`[Status] Script ${status}`);
        const MAX_LOG_SIZE = 100;
        if (script.log.length > MAX_LOG_SIZE) {
          script.log.splice(0, script.log.length - MAX_LOG_SIZE);
        }

        // Update last toggle timestamp
        state._lastScriptToggle[scriptIdToToggle] = now;
      }
    },

    setState: (state, action) => {
      // Merge the incoming payload with the current state,
      // ensuring that hotkeyScripts defaults to an empty array if not provided in the payload.
      return {
        ...state,
        ...action.payload,
        hotkeyScripts: action.payload.hotkeyScripts || [],
        persistentScripts: action.payload.persistentScripts || [],
      };
    },
    setenabled: (state, action) => {
      const now = Date.now();

      // Ensure _lastEnabledChange exists
      if (typeof state._lastEnabledChange !== 'number') {
        state._lastEnabledChange = 0;
      }

      // Check if enabled state was changed recently
      if (now - state._lastEnabledChange < DEBOUNCE_DELAY) {
        return; // Skip if changed within debounce delay
      }

      state.enabled = action.payload;
      state._lastEnabledChange = now;
    },

    setScriptEnabledByName(state, action) {
      const { name, enabled } = action.payload;
      const script = state.persistentScripts.find((s) => s.name === name);
      if (script) {
        script.enabled = enabled;
        const status = script.enabled ? 'Enabled' : 'Disabled';
        if (!Array.isArray(script.log)) script.log = [];
        script.log.push(`[Status] Script ${status} by API call`);
      } else {
        console.warn(`[luaSlice] setScriptEnabledByName: Script with name "${name}" not found.`);
      }
    },
  },
});

export const {
  addScript,
  addLogEntry,
  removeScript,
  updateScript,
  togglePersistentScript,
  setState,
  clearError,
  clearScriptLog,
  setenabled,
  setScriptEnabledByName,
} = luaSlice.actions;

export default luaSlice;
