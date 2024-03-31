import { globalShortcut } from 'electron';
import { selectWindow } from './menus/windowSelection.js';
import { selectActiveWindow } from './menus/windowSelection.js';
import setGlobalState from './setGlobalState.js';
import { getMainWindow } from './createMainWindow.js';
import { resetWorkers } from './main.js';
import { showNotification } from './notificationHandler.js';
import pkg from 'lodash';
import store from './store.js';
const { debounce } = pkg;
const debounceTime = 75;

let windId = '';
let windTitle = '';
let isEnabled = false;

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId, botEnabled } = global;
  windId = windowId;
  isEnabled = botEnabled;
});

const debouncedSelectActiveWindow = debounce(() => {
  console.log('Alt+0 shortcut clicked');
  resetWorkers();
  selectActiveWindow();
  setTimeout(() => {
    showNotification('Automaton', `🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedSelectWindow = debounce(() => {
  console.log('Alt+Shift+0 shortcut clicked');
  selectWindow();
  setTimeout(() => {
    showNotification('Automaton', `🔐 Window Selected - ${windId}`);
  }, 100);
}, debounceTime);

const debouncedToggleBotEnabled = debounce(() => {
  console.log('Alt+1 shortcut clicked');
  setGlobalState('global/toggleBotEnabled');
  console.log(isEnabled);
  if (isEnabled) {
    showNotification('Automaton', '🟢 Bot Enabled');
  } else {
    showNotification('Automaton', '🔴 Bot Disabled');
  }
}, debounceTime);

const debouncedToggleManaSync = debounce(() => {
  console.log('Alt+S shortcut clicked');
  setGlobalState('global/toggleBotEnabled');
  console.log(isEnabled);
  if (isEnabled) {
    showNotification('Automaton', '🟢 Bot Enabled');
  } else {
    showNotification('Automaton', '🔴 Bot Disabled');
  }
}, debounceTime);

const debouncedToggleMainWindowVisibility = debounce(() => {
  console.log('Alt+2 shortcut clicked');
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      showNotification('Automaton', '🙈 Hidden');
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
