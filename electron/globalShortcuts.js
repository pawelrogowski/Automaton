import { app, globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';
import setGlobalState from './setGlobalState.js';
import { getMainWindow } from './createMainWindow.js';

export const registerGlobalShortcuts = () => {
  globalShortcut.register('Alt+0', () => {
    selectActiveWindow();
  });

  globalShortcut.register('Alt+Shift+0', () => {
    selectWindow();
  });

  globalShortcut.register('Alt+1', () => {
    setGlobalState('global/toggleBotEnabled');
  });

  globalShortcut.register('Alt+2', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
};

export const unregisterGlobalShortcuts = () => {
  globalShortcut.unregisterAll();
};
