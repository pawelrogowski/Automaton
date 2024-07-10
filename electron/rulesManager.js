import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import debounce from 'lodash/debounce.js';

const userDataPath = app.getPath('userData');
const autoLoadFilePath = path.join(userDataPath, 'autoLoadRules.json');

export const saveRulesToFile = async (callback) => {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Save State',
      filters: [{ extensions: ['json'] }],
    });

    if (!result.canceled && result.filePath) {
      const filePath = result.filePath.endsWith('.json')
        ? result.filePath
        : `${result.filePath}.json`;
      await fs.writeFile(filePath, JSON.stringify(store.getState(), null, 2));
      showNotification(`📥 Saved | ${path.basename(filePath)}`);
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
    const result = await dialog.showOpenDialog({
      title: 'Load State',
      filters: [{ extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const content = await fs.readFile(result.filePaths[0], 'utf8');
      const loadedState = JSON.parse(content);

      setGlobalState('healing/setState', loadedState.healing);
      setGlobalState('global/setState', loadedState.global);
      // Uncomment the following line if you want to load gameState as well
      // setGlobalState('gameState/setState', loadedState.gameState);

      showNotification(`📤 Loaded | ${path.basename(result.filePaths[0])}`);
    }
    callback();
  } catch (err) {
    console.error('Failed to load state:', err);
    showNotification('❌ Failed to load state');
    callback();
  }
};

export const autoSaveRules = debounce(async () => {
  try {
    const state = store.getState();
    // Only save if the state is not empty
    if (Object.keys(state).length > 0) {
      await fs.writeFile(autoLoadFilePath, JSON.stringify(state, null, 2));
      console.log('Auto-saved rules successfully to:', autoLoadFilePath);
    } else {
      console.log('Skipped auto-save: State is empty');
    }
  } catch (error) {
    console.error('Failed to auto-save rules:', error);
  }
}, 5000);

export const autoLoadRules = async () => {
  try {
    await fs.access(autoLoadFilePath);
    const content = await fs.readFile(autoLoadFilePath, 'utf8');
    const loadedState = JSON.parse(content);

    if (Object.keys(loadedState).length > 0) {
      setGlobalState('healing/setState', loadedState.healing);
      setGlobalState('global/setState', loadedState.global);
      // Uncomment the following line if you want to load gameState as well
      // setGlobalState('gameState/setState', loadedState.gameState);

      console.log('Auto-loaded rules successfully from:', autoLoadFilePath);
    } else {
      console.log('Skipped auto-load: Saved state is empty');
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No auto-save file found. Starting with default state.');
    } else {
      console.error('Failed to auto-load rules:', error);
    }
  }
};

// Subscribe to store changes
store.subscribe(() => {
  autoSaveRules();
});
