import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import throttle from 'lodash/throttle.js';
import { createLogger } from './utils/logger.js';
// Import the loadScripts action from the lua slice
import { loadScripts as loadLuaScripts } from '../frontend/redux/slices/luaSlice.js';

const userDataPath = app.getPath('userData');
const autoLoadFilePath = path.join(userDataPath, 'autoLoadRules.json');
const log = createLogger();

export const saveRulesToFile = async (callback) => {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Save State',
      filters: [{ name: 'JSON Files', extensions: ['json'] }], // More descriptive filter name
    });

    if (!result.canceled && result.filePath) {
      const filePath = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.json`;
      // Get the entire state, including the lua slice
      const stateToSave = store.getState();
      await fs.writeFile(filePath, JSON.stringify(stateToSave, null, 2));
      log('info', `[Rule Manager] Saved state to ${filePath}`); // Added internal log
      showNotification(`📥 Saved | ${path.basename(filePath)}`);
    } else {
        log('info', '[Rule Manager] Save dialog canceled.'); // Log cancelation
    }
    if (callback) callback(); // Ensure callback is always called
  } catch (err) {
    log('error', `[Rule Manager] Save failed: ${err}`); // More specific error log
    showNotification('❌ Failed to save state');
    if (callback) callback(); // Ensure callback is always called
  }
};

export const loadRulesFromFile = async (callback) => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Load State',
      filters: [{ name: 'JSON Files', extensions: ['json'] }], // More descriptive filter name
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf8');
      const loadedState = JSON.parse(content);

      // Dispatch actions to set states for each slice
      if (loadedState.rules) {
         setGlobalState('rules/setState', loadedState.rules);
      } else {
          log('warn', `[Rule Manager] No 'rules' state found in ${filePath}`);
      }
      if (loadedState.global) {
          setGlobalState('global/setState', loadedState.global);
      } else {
          log('warn', `[Rule Manager] No 'global' state found in ${filePath}`);
      }
      // Dispatch action to load the lua slice state
      if (loadedState.lua) {
          setGlobalState(loadLuaScripts.type, loadedState.lua);
           log('info', `[Rule Manager] Loaded 'lua' state from ${filePath}`); // Added internal log
      } else {
           log('warn', `[Rule Manager] No 'lua' state found in ${filePath}`); // Warn if lua state is missing
      }


      showNotification(`📤 Loaded | ${path.basename(filePath)}`);
      log('info', `[Rule Manager] Loaded state from ${filePath}`); // Added internal log
    } else {
        log('info', '[Rule Manager] Load dialog canceled.'); // Log cancelation
    }
    if (callback) callback(); // Ensure callback is always called
  } catch (err) {
    log('error', `[Rule Manager] Load failed: ${err}`); // More specific error log
    showNotification('❌ Failed to load state');
    if (callback) callback(); // Ensure callback is always called
  }
};

const autoSaveRules = throttle(
  async () => {
    try {
      const state = store.getState();
       // Only auto-save if there's some state to save beyond initial empty state
      if (state && (Object.keys(state.rules || {}).length > 0 || Object.keys(state.global || {}).length > 0 || Object.keys(state.lua || {}).length > 0)) {
        await fs.writeFile(autoLoadFilePath, JSON.stringify(state, null, 2));
        // Removed frequent success log, keep errors/warnings
        // log('info', `[Auto Save] success`);
      } else {
        // Removed frequent "skipped" log
        // log('warn', `[Auto Save] skipped - state is empty`);
      }
    } catch (error) {
      log('error', `[Auto Save] failed: ${error}`); // More specific error log
      // Consider showing a subtle notification or app log for auto-save failures
    }
  },
  1000, // Throttle every 1 second
  { leading: false, trailing: true }, // Only run on the trailing edge of updates
);

export const autoLoadRules = async () => {
  try {
    // Check if the auto-save file exists
    await fs.access(autoLoadFilePath);
    const content = await fs.readFile(autoLoadFilePath, 'utf8');
    const loadedState = JSON.parse(content);

     // Only load if the parsed state is not empty
    if (loadedState && (Object.keys(loadedState.rules || {}).length > 0 || Object.keys(loadedState.global || {}).length > 0 || Object.keys(loadedState.lua || {}).length > 0)) {

      // Dispatch actions to set states for each slice
      if (loadedState.rules) {
         setGlobalState('rules/setState', loadedState.rules);
      } else {
          log('warn', "[Rule Manager] No 'rules' state found in auto-load file.");
      }
      if (loadedState.global) {
          setGlobalState('global/setState', loadedState.global);
      } else {
           log('warn', "[Rule Manager] No 'global' state found in auto-load file.");
      }
      // Dispatch action to load the lua slice state
       if (loadedState.lua) {
           setGlobalState(loadLuaScripts.type, loadedState.lua);
           log('info', "[Rule Manager] Auto loaded 'lua' state."); // Added internal log
       } else {
           log('warn', "[Rule Manager] No 'lua' state found in auto-load file."); // Warn if lua state is missing
       }

      log('info', `[Rule Manager] Auto load success from ${autoLoadFilePath}`); // More specific log
    } else {
      log('warn', '[Rule Manager] Auto load skipped - auto-save file is empty or contains no state.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('info', '[Rule Manager] No auto-save file found, skipping auto-load.'); // Changed to info, not a warning
    } else {
      log('error', `[Rule Manager] Auto Load failed: ${error}`); // More specific error log
       // Consider showing a subtle notification or app log for auto-load failures
    }
  }
};


// Track previous state for comparison
let previousState = null;

store.subscribe(() => {
  const currentState = store.getState();

  // Perform a shallow comparison of the relevant slices (rules, global, lua)
  // A deep comparison could be too performance-intensive for every store update.
  // Shallow compare each top-level slice object.
  const rulesChanged = previousState?.rules !== currentState.rules;
  const globalChanged = previousState?.global !== currentState.global;
  const luaChanged = previousState?.lua !== currentState.lua;


  // Trigger auto-save if any of the relevant slices have changed
  if (rulesChanged || globalChanged || luaChanged) {
    // log('debug', '[Rule Manager] State change detected in rules, global, or lua. Triggering auto-save.'); // Optional debug log
    autoSaveRules();
    // Update previousState with the current state (shallow copy of relevant parts)
    previousState = {
      ...previousState, // Keep other potential slices if they existed
      rules: currentState.rules,
      global: currentState.global,
      lua: currentState.lua,
    };
  } else {
    // log('debug', '[Rule Manager] State change detected, but not in rules, global, or lua.'); // Optional debug log
     // If no relevant slice changed, just update previousState to track changes in other slices
     previousState = {
         ...previousState,
         ...currentState, // Shallow copy all current state
     };
  }
});