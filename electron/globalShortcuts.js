import { app, globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';
import setGlobalState from './setGlobalState.js';
import { getMainWindow } from './createMainWindow.js';

export const registerGlobalShortcuts = () => {
  // Register a shortcut to select the active window
  globalShortcut.register('Alt+W', () => {
    selectActiveWindow();
  });

  // Register a new shortcut for selecting a window
  globalShortcut.register('Alt+Shift+W', () => {
    selectWindow();
  });

  globalShortcut.register('Alt+E', () => {
    setGlobalState('global/toggleBotEnabled');
  });

  globalShortcut.register('Ctrl+Shift+Home', () => {
    setGlobalState('global/toggleBotEnabled');
  });

  globalShortcut.register('Alt+S', () => {
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
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
};
