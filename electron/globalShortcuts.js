import { app, globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';

export const registerGlobalShortcuts = () => {
  // Register a shortcut to select the window
  globalShortcut.register('Ctrl+Shift+Home', () => {
    console.log('shortcut detected');
    selectWindow();
  });
};

export const unregisterGlobalShortcuts = () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
};
