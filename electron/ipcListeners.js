import { ipcMain } from 'electron';
import store from './store.js';
import { saveRulesToFile, loadRulesFromFile, autoLoadRules } from './rulesManager.js';
import { registerGlobalShortcuts } from './globalShortcuts.js';
import { getMainWindow } from './createMainWindow.js';
import { grabScreen } from './screenMonitor/screenGrabUtils/grabScreen.js';

ipcMain.on('state-change', (_, serializedAction) => {
  try {
    const action = JSON.parse(serializedAction);
    if (action.origin === 'renderer') {
      store.dispatch(action);
    }
  } catch (error) {
    console.error('Error dispatching action in main process:', error);
  }
});

ipcMain.on('save-rules', async () => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await saveRulesToFile(() => {
    mainWindow.restore();
  });
});

ipcMain.handle('load-rules', async () => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await loadRulesFromFile(() => {
    mainWindow.restore();
  });
});

ipcMain.on('renderer-ready', () => {
  autoLoadRules();
  registerGlobalShortcuts();
});
