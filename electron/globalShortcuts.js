import { app, globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';

import { selectActiveWindow } from './menus/windowSelection.js';

export const registerGlobalShortcuts = () => {
  // Register a shortcut to select the active window
  globalShortcut.register('Ctrl+Shift+Home', () => {
    selectActiveWindow();
  });
};
export const unregisterGlobalShortcuts = () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
};
