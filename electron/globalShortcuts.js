import { app, globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';

export const registerGlobalShortcuts = () => {
  // Register a shortcut to select the active window
  globalShortcut.register('Alt+W', () => {
    selectActiveWindow();
  });

  // Register a new shortcut for selecting a window
  globalShortcut.register('Alt+Shift+W', () => {
    selectWindow();
  });
};

export const unregisterGlobalShortcuts = () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
};
