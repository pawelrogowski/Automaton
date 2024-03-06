import { dialog } from 'electron';
import { exec, fork } from 'child_process';
import store from '../store.js';
import { getMainWindow } from '../createMainWindow.js';
import { setWindowTitle, setWindowId } from '../../src/redux/slices/globalSlice.js';
import setGlobalState from '../setGlobalState.js';

let selectedWindowId = null;

const getGeometry = (id) =>
  new Promise((resolve, reject) => {
    exec(`xdotool getwindowgeometry ${id}`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });

const getWindowName = (id) =>
  new Promise((resolve, reject) => {
    exec(`xdotool getwindowname ${id}`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });

export const selectWindow = async () => {
  exec('xdotool selectwindow', async (error, stdout) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    const windowId = stdout.trim();
    console.log(`Selected window ID: ${windowId}`);
    const geometry = await getGeometry(windowId);
    if (geometry.includes('1x1')) {
      console.error('Invalid window selected. Please select a valid window.');
      return;
    }
    const windowTitle = await getWindowName(windowId);
    getMainWindow().setTitle(`Automaton - ${windowId}`);
    setGlobalState('global/setWindowTitle', windowId);
    setGlobalState('global/setWindowId', windowId);
  });
};

const getActiveWindowId = () =>
  new Promise((resolve, reject) => {
    exec('xdotool getactivewindow', (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });

export const selectActiveWindow = async () => {
  try {
    const windowId = await getActiveWindowId();
    console.log(`Active window ID: ${windowId}`);
    const geometry = await getGeometry(windowId);
    if (geometry.includes('1x1')) {
      console.error('Invalid window selected. Please select a valid window.');
      return;
    }
    const windowTitle = await getWindowName(windowId);
    if (!windowTitle.includes('Tibia')) {
      console.error(
        'The selected window does not include "Tibia" in its title. Please select a valid window.',
      );
      return;
    }
    getMainWindow().setTitle(`Automaton - ${windowId}`);
    setGlobalState('global/setWindowTitle', windowTitle);
    setGlobalState('global/setWindowId', windowId);
  } catch (error) {
    console.error(`Error getting active window ID: ${error}`);
  }
};

export const getSelectedWindowId = () => selectedWindowId;
