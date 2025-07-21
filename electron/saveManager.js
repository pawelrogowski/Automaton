import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import throttle from 'lodash/throttle.js';
// Helper to normalize Lua scripts with a 'type' property if missing
const normalizeLuaScripts = (luaState) => {
  if (!luaState) return luaState;

  const normalizedState = { ...luaState };

  if (
    normalizedState.persistentScripts &&
    Array.isArray(normalizedState.persistentScripts)
  ) {
    normalizedState.persistentScripts = normalizedState.persistentScripts.map(
      (script) => ({
        ...script,
        type: script.type || 'persistent', // Ensure type is 'persistent'
      }),
    );
  }

  if (
    normalizedState.hotkeyScripts &&
    Array.isArray(normalizedState.hotkeyScripts)
  ) {
    normalizedState.hotkeyScripts = normalizedState.hotkeyScripts.map(
      (script) => ({
        ...script,
        type: script.type || 'hotkey', // Ensure type is 'hotkey'
      }),
    );
  }

  return normalizedState;
};

const user_data_path = app.getPath('userData');
const auto_load_file_path = path.join(user_data_path, 'autoLoadRules.json');

// Save state excluding window-specific data
export const saveRulesToFile = async (callback) => {
  try {
    const dialog_result = await dialog.showSaveDialog({
      title: 'Save State',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (!dialog_result.canceled && dialog_result.filePath) {
      const save_file_path = dialog_result.filePath.endsWith('.json')
        ? dialog_result.filePath
        : `${dialog_result.filePath}.json`;
      const state = store.getState();

      await fs.writeFile(save_file_path, JSON.stringify(state, null, 2));
      showNotification(`📥 Saved | ${path.basename(save_file_path)}`);
    }
    callback();
  } catch (err) {
    console.error('Failed to save state:', err);
    showNotification('❌ Failed to save state');
    callback();
  }
};

export const loadRulesFromFile = async (callback) => {
  try {
    const dialog_result = await dialog.showOpenDialog({
      title: 'Load State',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!dialog_result.canceled && dialog_result.filePaths.length > 0) {
      const file_path = dialog_result.filePaths[0];
      const content = await fs.readFile(file_path, 'utf8');
      const loaded_state = JSON.parse(content);

      // Check for each slice before setting state to avoid errors with old/malformed files
      if (loaded_state.rules)
        setGlobalState('rules/setState', loaded_state.rules);
      if (loaded_state.global) {
        // Exclude windowId but keep windowName from global state
        const { windowId, ...globalWithoutWindowId } = loaded_state.global;
        setGlobalState('global/setState', globalWithoutWindowId);
      }
      if (loaded_state.lua)
        setGlobalState('lua/setState', normalizeLuaScripts(loaded_state.lua));
      if (loaded_state.cavebot)
        setGlobalState('cavebot/setState', loaded_state.cavebot);
      if (loaded_state.targeting)
        setGlobalState('targeting/setState', loaded_state.targeting);

      showNotification(`📤 Loaded | ${path.basename(file_path)}`);
    }
    callback();
  } catch (err) {
    console.error('Failed to load state:', err);
    showNotification('❌ Failed to load state');
    callback();
  }
};

// Auto-save state excluding window-specific data
const perform_auto_save = async () => {
  try {
    const state = store.getState();
    if (Object.keys(state).length > 0) {
      // Create a filtered state that excludes windowId but keeps windowName
      const filteredState = {
        ...state,
        global: {
          ...state.global,
          windowId: undefined,
        },
      };
      await fs.writeFile(
        auto_load_file_path,
        JSON.stringify(filteredState, null, 2),
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

    if (Object.keys(loaded_state).length > 0) {
      if (loaded_state.rules)
        setGlobalState('rules/setState', loaded_state.rules);
      if (loaded_state.global) {
        // Exclude windowId but keep windowName from global state
        const { windowId, ...globalWithoutWindowId } = loaded_state.global;
        setGlobalState('global/setState', globalWithoutWindowId);
      }
      if (loaded_state.lua)
        setGlobalState('lua/setState', normalizeLuaScripts(loaded_state.lua));
      if (loaded_state.cavebot)
        setGlobalState('cavebot/setState', loaded_state.cavebot);
      if (loaded_state.targeting)
        setGlobalState('targeting/setState', loaded_state.targeting);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      // console.log('No auto-save file found. Starting with default state.');
    } else {
      console.error('Failed to auto-load rules:', error);
    }
  }
};

let previous_rules_state = null;
let previous_global_state = null;
let previous_lua_state = null;
let previous_cavebot_state = null;
let previous_targeting_state = null;

const has_state_changed = (new_state, prev_state) => {
  if (prev_state === null) return true;
  return (
    Object.keys(new_state).length !== Object.keys(prev_state).length ||
    Object.keys(new_state).some((key) => new_state[key] !== prev_state[key])
  );
};

store.subscribe(() => {
  const { rules, global, lua, cavebot, targeting } = store.getState();

  const rules_changed = has_state_changed(rules, previous_rules_state);
  const global_changed = has_state_changed(global, previous_global_state);
  const lua_changed = has_state_changed(lua, previous_lua_state);
  const cavebot_changed = has_state_changed(cavebot, previous_cavebot_state);
  const targeting_changed = has_state_changed(
    targeting,
    previous_targeting_state,
  );

  if (
    rules_changed ||
    global_changed ||
    lua_changed ||
    cavebot_changed ||
    targeting_changed
  ) {
    auto_save_rules();

    // Update previous state only if it changed
    if (rules_changed) previous_rules_state = { ...rules };
    if (global_changed) previous_global_state = { ...global };
    if (lua_changed) previous_lua_state = { ...lua };
    if (cavebot_changed) previous_cavebot_state = { ...cavebot };
    if (targeting_changed) previous_targeting_state = { ...targeting };
  }
});
