import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import throttle from 'lodash/throttle.js';
import omit from 'lodash/omit.js';

// ... (normalizeLuaScripts and STATE_SCHEMA are unchanged)
// Helper to normalize Lua scripts
const normalizeLuaScripts = (luaState) => {
  if (!luaState) return luaState;
  const normalizedState = { ...luaState };
  if (
    normalizedState.persistentScripts &&
    Array.isArray(normalizedState.persistentScripts)
  ) {
    normalizedState.persistentScripts = normalizedState.persistentScripts.map(
      (script) => ({ ...script, type: script.type || 'persistent' }),
    );
  }
  if (
    normalizedState.hotkeyScripts &&
    Array.isArray(normalizedState.hotkeyScripts)
  ) {
    normalizedState.hotkeyScripts = normalizedState.hotkeyScripts.map(
      (script) => ({ ...script, type: script.type || 'hotkey' }),
    );
  }
  return normalizedState;
};

// STATE PERSISTENCE SCHEMA
const STATE_SCHEMA = {
  global: {
    transformOnSave: (state) => ({
      notificationsEnabled: state.notificationsEnabled,
      isGlobalShortcutsEnabled: state.isGlobalShortcutsEnabled,
    }),
  },
  rules: {},
  lua: {
    transformOnSave: (state) => ({
      enabled: false,
      persistentScripts:
        state.persistentScripts?.map((script) => ({
          ...script,
          log: [],
        })) || [],
    }),
    transformOnLoad: (state) =>
      normalizeLuaScripts({ ...state, enabled: false }),
  },
  cavebot: {
    transformOnSave: (state) => ({
      enabled: false,
      waypointSections: state.waypointSections,
      specialAreas: state.specialAreas,
    }),
    transformOnLoad: (state) => ({ ...state, enabled: false }),
  },
  targeting: {
    transformOnSave: (state) => ({
      enabled: false,
      targetingList: state.targetingList,
    }),
    transformOnLoad: (state) => ({ ...state, enabled: false }),
  },
};

const PERSISTED_SLICES = Object.keys(STATE_SCHEMA);
const user_data_path = app.getPath('userData');
const auto_load_file_path = path.join(user_data_path, 'autoLoadRules.json');

// ============================================================================
// Schema-Driven Helper Functions
// ============================================================================

const prepareStateForSave = (fullState) => {
  const stateToSave = {};
  for (const sliceName of PERSISTED_SLICES) {
    if (fullState[sliceName]) {
      const sliceConfig = STATE_SCHEMA[sliceName];
      stateToSave[sliceName] = sliceConfig.transformOnSave
        ? sliceConfig.transformOnSave(fullState[sliceName])
        : fullState[sliceName];
    }
  }
  return stateToSave;
};

const applyLoadedState = (loadedState) => {
  if (!loadedState || typeof loadedState !== 'object') return;
  for (const sliceName of PERSISTED_SLICES) {
    if (loadedState[sliceName]) {
      let sliceData = loadedState[sliceName];
      const sliceConfig = STATE_SCHEMA[sliceName];
      if (sliceConfig.transformOnLoad) {
        sliceData = sliceConfig.transformOnLoad(sliceData);
      }
      setGlobalState(`${sliceName}/setState`, sliceData);
    }
  }
};

// ============================================================================
// Generic Save Function & Factory
// ============================================================================

/**
 * A generic function to handle the logic of saving data to a file.
 * @param {object} dataToSave - The JavaScript object to be stringified and saved.
 * @param {string} dialogTitle - The title for the save file dialog window.
 * @param {string} defaultFilename - The suggested filename in the dialog.
 * @param {function} [callback] - An optional callback to run after completion.
 */
const genericSaveToFile = async (
  dataToSave,
  dialogTitle,
  defaultFilename,
  callback,
) => {
  try {
    const dialog_result = await dialog.showSaveDialog({
      title: dialogTitle,
      defaultPath: defaultFilename,
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (!dialog_result.canceled && dialog_result.filePath) {
      const save_file_path = dialog_result.filePath.endsWith('.json')
        ? dialog_result.filePath
        : `${dialog_result.filePath}.json`;

      await fs.writeFile(save_file_path, JSON.stringify(dataToSave, null, 2));
      showNotification(`📥 Saved | ${path.basename(save_file_path)}`);
    }
  } catch (err) {
    console.error(`Failed to save file for "${dialogTitle}":`, err);
    showNotification(`❌ Failed to save ${defaultFilename}`);
  } finally {
    if (callback) callback();
  }
};

/**
 * Factory function to create a dedicated save function for a specific state slice.
 * @param {string} sliceName - The key of the state slice (e.g., 'targeting').
 * @param {string} dialogTitle - The title for the save dialog.
 * @param {string} defaultFilename - The suggested filename.
 * @returns {function} An async function that takes an optional callback.
 */
const createSliceSaver = (sliceName, dialogTitle, defaultFilename) => {
  return async (callback) => {
    const sliceState = store.getState()[sliceName];
    if (!sliceState) {
      console.error(`Attempted to save non-existent slice: ${sliceName}`);
      showNotification(`❌ Cannot save ${sliceName}: state not found`);
      if (callback) callback();
      return;
    }

    // Use the schema to prepare the slice for saving, ensuring consistency.
    const sliceConfig = STATE_SCHEMA[sliceName];
    const stateToSave = sliceConfig.transformOnSave
      ? sliceConfig.transformOnSave(sliceState)
      : sliceState;

    await genericSaveToFile(
      stateToSave,
      dialogTitle,
      defaultFilename,
      callback,
    );
  };
};

// ============================================================================
// Public API (Save/Load Functions)
// ============================================================================

/** Saves the ENTIRE configured state to a file. */
export const saveRulesToFile = async (callback) => {
  const fullStateToSave = prepareStateForSave(store.getState());
  await genericSaveToFile(
    fullStateToSave,
    'Save Full Profile',
    'full_profile.json',
    callback,
  );
};

/** Loads state from a file. */
export const loadRulesFromFile = async (callback) => {
  try {
    const dialog_result = await dialog.showOpenDialog({
      title: 'Load Profile',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!dialog_result.canceled && dialog_result.filePaths.length > 0) {
      const file_path = dialog_result.filePaths[0];
      const content = await fs.readFile(file_path, 'utf8');
      const loaded_state = JSON.parse(content);
      applyLoadedState(loaded_state);
      showNotification(`📤 Loaded | ${path.basename(file_path)}`);
    }
  } catch (err) {
    console.error('Failed to load state:', err);
    showNotification('❌ Failed to load state');
  } finally {
    if (callback) callback();
  }
};

// --- NEW SLICE-SPECIFIC SAVE FUNCTIONS ---

export const saveTargeting = createSliceSaver(
  'targeting',
  'Save Targeting Profile',
  'targeting_profile.json',
);

export const saveCavebot = createSliceSaver(
  'cavebot',
  'Save Cavebot Profile',
  'cavebot_profile.json',
);

export const saveRules = createSliceSaver(
  'rules',
  'Save Rules Profile',
  'rules_profile.json',
);

export const saveLua = createSliceSaver(
  'lua',
  'Save Lua Scripts Profile',
  'lua_profile.json',
);

// ============================================================================
// Individual Lua Script Save/Load Functions
// ============================================================================

/**
 * Save a single Lua script to a file
 * @param {object} script - The script object to save
 * @param {function} callback - Optional callback
 */
export const saveLuaScript = async (script, callback) => {
  if (!script) {
    console.error('No script provided to save');
    showNotification('❌ No script to save');
    if (callback) callback();
    return;
  }

  // Clean the script data for export
  const scriptToSave = {
    ...script,
    enabled: false, // Disable by default
    log: [], // Clear logs
  };

  const defaultName = script.name
    ? `${script.name.replace(/[^a-z0-9_-]/gi, '_')}.lua.json`
    : 'lua_script.json';

  await genericSaveToFile(
    scriptToSave,
    'Save Lua Script',
    defaultName,
    callback,
  );
};

/**
 * Load a single Lua script from a file
 * @param {function} callback - Optional callback
 * @returns {Promise<object|null>} The loaded script or null
 */
export const loadLuaScript = async (callback) => {
  try {
    const dialog_result = await dialog.showOpenDialog({
      title: 'Load Lua Script',
      filters: [{ name: 'Lua Script Files', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!dialog_result.canceled && dialog_result.filePaths.length > 0) {
      const file_path = dialog_result.filePaths[0];
      const content = await fs.readFile(file_path, 'utf8');
      const loaded_script = JSON.parse(content);

      // Validate script structure
      if (!loaded_script.id || !loaded_script.type || !loaded_script.code) {
        showNotification('❌ Invalid script file format');
        if (callback) callback();
        return null;
      }

      // Ensure script is disabled and has fresh log
      loaded_script.enabled = false;
      loaded_script.log = [];

      showNotification(`📤 Loaded script | ${loaded_script.name || 'Unnamed'}`);
      if (callback) callback();
      return loaded_script;
    }
  } catch (err) {
    console.error('Failed to load Lua script:', err);
    showNotification('❌ Failed to load script');
  }

  if (callback) callback();
  return null;
};

/**
 * Save multiple Lua scripts as a package
 * @param {Array} scripts - Array of script objects to save
 * @param {function} callback - Optional callback
 */
export const saveLuaScriptPackage = async (scripts, callback) => {
  if (!scripts || !Array.isArray(scripts) || scripts.length === 0) {
    console.error('No scripts provided to save');
    showNotification('❌ No scripts to save');
    if (callback) callback();
    return;
  }

  // Clean the scripts for export
  const scriptsToSave = scripts.map((script) => ({
    ...script,
    enabled: false, // Disable by default
    log: [], // Clear logs
  }));

  const packageData = {
    version: '1.0',
    type: 'lua_script_package',
    scriptCount: scriptsToSave.length,
    exportedAt: new Date().toISOString(),
    scripts: scriptsToSave,
  };

  await genericSaveToFile(
    packageData,
    'Save Lua Script Package',
    'lua_scripts_package.json',
    callback,
  );
};

/**
 * Load multiple Lua scripts from a package file
 * @param {function} callback - Optional callback
 * @returns {Promise<Array|null>} The loaded scripts or null
 */
export const loadLuaScriptPackage = async (callback) => {
  try {
    const dialog_result = await dialog.showOpenDialog({
      title: 'Load Lua Script Package',
      filters: [{ name: 'Script Package Files', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!dialog_result.canceled && dialog_result.filePaths.length > 0) {
      const file_path = dialog_result.filePaths[0];
      const content = await fs.readFile(file_path, 'utf8');
      const packageData = JSON.parse(content);

      // Validate package structure
      if (!packageData.scripts || !Array.isArray(packageData.scripts)) {
        showNotification('❌ Invalid package file format');
        if (callback) callback();
        return null;
      }

      // Ensure all scripts are disabled and have fresh logs
      const loaded_scripts = packageData.scripts.map((script) => ({
        ...script,
        enabled: false,
        log: [],
      }));

      showNotification(
        `📤 Loaded ${loaded_scripts.length} script${loaded_scripts.length !== 1 ? 's' : ''} from package`,
      );
      if (callback) callback();
      return loaded_scripts;
    }
  } catch (err) {
    console.error('Failed to load Lua script package:', err);
    showNotification('❌ Failed to load script package');
  }

  if (callback) callback();
  return null;
};

// ============================================================================
// Auto Save / Load & Store Subscription (Unchanged)
// ============================================================================

const perform_auto_save = async () => {
  try {
    const stateToSave = prepareStateForSave(store.getState());
    if (Object.keys(stateToSave).length > 0) {
      await fs.writeFile(
        auto_load_file_path,
        JSON.stringify(stateToSave, null, 2),
      );
    }
  } catch (error) {
    console.error('Failed to auto-save rules:', error);
  }
};

const auto_save_rules = throttle(perform_auto_save, 1000, {
  leading: false,
  trailing: true,
});

export const autoLoadRules = async () => {
  try {
    await fs.access(auto_load_file_path);
    const content = await fs.readFile(auto_load_file_path, 'utf8');
    const loaded_state = JSON.parse(content);
    applyLoadedState(loaded_state);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to auto-load rules:', error);
    }
  }
};

const previousStates = {};
const hasStateChanged = (newState, prevState) => {
  if (newState === prevState) return false;
  if (
    !prevState ||
    typeof newState !== 'object' ||
    typeof prevState !== 'object'
  )
    return true;
  return JSON.stringify(newState) !== JSON.stringify(prevState);
};

store.subscribe(() => {
  const currentState = store.getState();
  let hasChanged = false;

  for (const sliceName of PERSISTED_SLICES) {
    if (hasStateChanged(currentState[sliceName], previousStates[sliceName])) {
      hasChanged = true;
      previousStates[sliceName] = currentState[sliceName];
    }
  }

  // if (hasChanged) {
  //   auto_save_rules();
  // }
});
