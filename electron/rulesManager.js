import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';

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
      fs.writeFileSync(filePath, JSON.stringify(store.getState(), null, 2)); // Serialize entire state
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
      const content = fs.readFileSync(result.filePaths[0], 'utf8');
      const loadedState = JSON.parse(content);

      // Dispatch actions to update each slice with its corresponding state
      // store.dispatch({ type: 'healing/setState', payload: loadedState.healing });
      // store.dispatch({ type: 'global/setState', payload: loadedState.global });
      // store.dispatch({ type: 'gameState/setState', payload: loadedState.gameState });
      setGlobalState('healing/setState', loadedState.healing);
      setGlobalState('global/setState', loadedState.global);
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

const autoSaveRules = async () => {
  try {
    const rules = store.getState();
    fs.writeFileSync(autoLoadFilePath, JSON.stringify(rules, null, 2));
    console.log('Rules saved successfully');
  } catch (error) {
    console.error('Failed to save rules:', error);
  }
};

const autoLoadRules = async () => {
  if (fs.existsSync(autoLoadFilePath)) {
    const content = fs.readFileSync(autoLoadFilePath, 'utf8');
    const loadedState = JSON.parse(content);
    setGlobalState('healing/setState', loadedState.healing);
    setGlobalState('global/setState', loadedState.global);
    // setGlobalState('gameState/setState', loadedState.gameState);
  }
};

export { autoSaveRules, autoLoadRules };
