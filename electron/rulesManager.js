import { app, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { showNotification } from './notificationHandler.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import throttle from 'lodash/throttle.js';
import { createLogger } from './utils/logger.js';

const userDataPath = app.getPath('userData');
const autoLoadFilePath = path.join(userDataPath, 'autoLoadRules.json');
const log = createLogger();

export const saveRulesToFile = async (callback) => {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Save State',
      filters: [{ extensions: ['json'] }],
    });

    if (!result.canceled && result.filePath) {
      const filePath = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.json`;
      await fs.writeFile(filePath, JSON.stringify(store.getState(), null, 2));
      showNotification(`📥 Saved | ${path.basename(filePath)}`);
    }
    callback();
  } catch (err) {
    log('error', `[Rule Manager] ${err}`);
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

      setGlobalState('rules/setState', loadedState.rules);
      setGlobalState('global/setState', loadedState.global);

      showNotification(`📤 Loaded | ${path.basename(result.filePaths[0])}`);
    }
    callback();
  } catch (err) {
    log('error', `[Rule Manager] ${err}`);
    showNotification('❌ Failed to load state');
    callback();
  }
};

const autoSaveRules = throttle(
  async () => {
    try {
      const state = store.getState();
      if (Object.keys(state).length > 0) {
        await fs.writeFile(autoLoadFilePath, JSON.stringify(state, null, 2));
        log('info', `[Auto Save] success`);
      } else {
        log('warn', `[Auto Save] skipped - state is empty`);
      }
    } catch (error) {
      log('error', `[Auto Save] ${error}`);
    }
  },
  1000,
  { leading: false, trailing: true },
);

export const autoLoadRules = async () => {
  try {
    await fs.access(autoLoadFilePath);
    const content = await fs.readFile(autoLoadFilePath, 'utf8');
    const loadedState = JSON.parse(content);

    if (Object.keys(loadedState).length > 0) {
      setGlobalState('rules/setState', loadedState.rules);
      setGlobalState('global/setState', loadedState.global);
      log('info', `[Rule Manager] auto load success`);
    } else {
      log('warn', 'skipped - state is empty');s
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('warn', 'No auto-save file found');
    } else {
      log('error', `Auto Load - ${error}`);
    }
  }
};

let previousHealingState = null;
let previousGlobalState = null;

const isObjectChanged = (newObj, prevObj) => {
  if (prevObj === null) return true;
  for (let key in newObj) {
    if (newObj[key] !== prevObj[key]) return true;
  }
  return false;
};

store.subscribe(() => {
  const { rules, global } = store.getState();

  const healingChanged = isObjectChanged(rules, previousHealingState);
  const globalChanged = isObjectChanged(global, previousGlobalState);

  if (healingChanged || globalChanged) {
    autoSaveRules();
    previousHealingState = healingChanged ? { ...rules } : previousHealingState;
    previousGlobalState = globalChanged ? { ...global } : previousGlobalState;
  }
});
