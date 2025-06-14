import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import throttle from 'lodash/throttle.js';

const user_data_path = app.getPath('userData');
const auto_load_file_path = path.join(user_data_path, 'autoLoadRules.json');

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
      await fs.writeFile(save_file_path, JSON.stringify(store.getState(), null, 2));
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

      setGlobalState('rules/setState', loaded_state.rules);
      setGlobalState('global/setState', loaded_state.global);
      setGlobalState('lua/setState', loaded_state.lua);
      showNotification(`📤 Loaded | ${path.basename(file_path)}`);
    }
    callback();
  } catch (err) {
    console.error('Failed to load state:', err);
    showNotification('❌ Failed to load state');
    callback();
  }
};

const perform_auto_save = async () => {
  try {
    const state = store.getState();
    if (Object.keys(state).length > 0) {
      await fs.writeFile(auto_load_file_path, JSON.stringify(state, null, 2));
      // console.log('Auto-saved rules successfully');
    } else {
      // console.log('Skipped auto-save: State is empty');
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
      setGlobalState('rules/setState', loaded_state.rules);
      setGlobalState('global/setState', loaded_state.global);
      setGlobalState('lua/setState', loaded_state.lua);

      // console.log('Auto-loaded rules successfully');
    } else {
      // console.log('Skipped auto-load: Saved state is empty');
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

// Shallow comparison to check if object keys with primitive values have changed
const has_state_changed = (new_state, prev_state) => {
  if (prev_state === null) return true;
  // Check if any key value is different or if keys were added/removed
  return (
    Object.keys(new_state).length !== Object.keys(prev_state).length ||
    Object.keys(new_state).some(key => new_state[key] !== prev_state[key])
  );
};

store.subscribe(() => {
  const { rules, global, lua } = store.getState();

  const rules_changed = has_state_changed(rules, previous_rules_state);
  const global_changed = has_state_changed(global, previous_global_state);
  const lua_changed = has_state_changed(lua, previous_lua_state);

  if (rules_changed || global_changed || lua_changed) {
    auto_save_rules();

    // Update previous state only if it changed
    if (rules_changed) previous_rules_state = { ...rules };
    if (global_changed) previous_global_state = { ...global };
    if (lua_changed) previous_lua_state = { ...lua };
  }
});
