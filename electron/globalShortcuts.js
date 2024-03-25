// globalShortcuts.js
import { globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';
import setGlobalState from './setGlobalState.js';
import { getMainWindow } from './createMainWindow.js';
import { resetWorkers } from './main.js';
import { showNotification } from './notificationHandler.js';
import pkg from 'lodash';

const { debounce } = pkg;

const debounceTime = 75;

const debouncedSelectActiveWindow = debounce(() => {
  console.log('Alt+0 shortcut clicked');
  resetWorkers();
  selectActiveWindow();
  showNotification('Automaton', 'Window Picked');
}, debounceTime);

const debouncedSelectWindow = debounce(() => {
  console.log('Alt+Shift+0 shortcut clicked');
  selectWindow();
  showNotification('Automaton', 'Window Selected');
}, debounceTime);

const debouncedToggleBotEnabled = debounce(() => {
  console.log('Alt+1 shortcut clicked');
  setGlobalState('global/toggleBotEnabled');
  showNotification('Automaton', 'Bot Enabled/Disabled');
}, debounceTime);

const debouncedToggleMainWindowVisibility = debounce(() => {
  console.log('Alt+2 shortcut clicked');
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      showNotification('Automaton', 'hidden to tray');
    } else {
      mainWindow.show();
    }
  }
}, debounceTime);

export const registerGlobalShortcuts = () => {
  try {
    globalShortcut.register('Alt+0', debouncedSelectActiveWindow);
    globalShortcut.register('Alt+Shift+0', debouncedSelectWindow);
    globalShortcut.register('Alt+1', debouncedToggleBotEnabled);
    globalShortcut.register('Alt+2', debouncedToggleMainWindowVisibility);
  } catch (error) {
    console.error('Failed to register global shortcuts:', error);
  }
};

export const unregisterGlobalShortcuts = () => {
  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    console.error('Failed to unregister global shortcuts:', error);
  }
};
