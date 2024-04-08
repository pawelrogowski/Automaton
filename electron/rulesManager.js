// rulesManager.js
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
    const rules = store.getState().healing;
    const result = await dialog.showSaveDialog({
      title: 'Save Rules',
      filters: [{ extensions: ['json'] }],
    });

    if (!result.canceled && result.filePath) {
      const filePath = result.filePath.endsWith('.json')
        ? result.filePath
        : `${result.filePath}.json`;
      fs.writeFileSync(filePath, JSON.stringify(rules, null, 2));
      showNotification('Automaton', `📥 Saved | ${path.basename(filePath)}`);
    }
    callback();
  } catch (err) {
    console.error('Failed to save rules:', err);
    showNotification('Automaton', '❌ Failed to save rules');
    callback();
  }
};

export const loadRulesFromFile = async (callback) => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Load Rules',
      filters: [{ extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const content = fs.readFileSync(result.filePaths[0], 'utf8');
      const loadedRules = JSON.parse(content);
      store.dispatch({ type: 'healing/loadRules', payload: loadedRules });
      setGlobalState('healing/loadRules', loadedRules);
      showNotification('Automaton', `📤 Loaded | ${path.basename(result.filePaths[0])}`);
    }
    callback();
  } catch (err) {
    console.error('Failed to load rules:', err);
    showNotification('Automaton', '❌ Failed to load rules');
    callback();
  }
};

const autoSaveRules = async () => {
  try {
    const rules = store.getState().healing;
    fs.writeFileSync(autoLoadFilePath, JSON.stringify(rules, null, 2));
    console.log('Rules saved successfully');
  } catch (error) {
    console.error('Failed to save rules:', error);
  }
};

const autoLoadRules = async () => {
  if (fs.existsSync(autoLoadFilePath)) {
    const content = fs.readFileSync(autoLoadFilePath, 'utf8');
    const loadedRules = JSON.parse(content);
    store.dispatch({ type: 'healing/loadRules', payload: loadedRules });
    setGlobalState('healing/loadRules', loadedRules);
    console.log('Rules loaded successfully:', loadedRules);
  }
};

export { autoSaveRules, autoLoadRules };
