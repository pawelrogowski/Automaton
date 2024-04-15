import { dialog } from 'electron';
import { exec, fork } from 'child_process';
import { getMainWindow } from '../createMainWindow.js';
import store from '../store.js';
import { setWindowTitle, setWindowId } from '../../src/redux/slices/globalSlice.js';
import setGlobalState from '../setGlobalState.js';
import { resetWorkers } from '../main.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';

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
  resetWorkers();
  exec('xdotool selectwindow', async (error, stdout) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    const windowId = stdout.trim();
    console.log(`Selected window ID: ${windowId}`);
    const geometry = await getGeometry(windowId);
    if (geometry.includes('1x1')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState(
        'global/setWindowTitle',
        `Error: Please select a valid tibia window. (Alt+Shift+0)`,
      );
      return;
    }
    const windowTitle = await getWindowName(windowId);
    if (!windowTitle.includes('Tibia')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState(
        'global/setWindowTitle',
        `Error: Please select a valid tibia window. (Alt+Shift+0)`,
      );
      return;
    }
    getMainWindow().setTitle(`Automaton - ${windowId}`);
    setGlobalState('global/setWindowTitle', `Automaton - (${windowId})`);
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
    console.log(geometry);
    if (geometry.includes('1x1')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState(
        'global/setWindowTitle',
        `Error: Please select a valid tibia window. (Alt+Shift+0)`,
      );
      return;
    }
    const windowTitle = await getWindowName(windowId);
    if (!windowTitle.includes('Tibia')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState(
        'global/setWindowTitle',
        `Error: Please select a valid tibia window. (Alt+Shift+0)`,
      );
      return;
    }

    // Extract position coordinates from geometry string
    const positionMatch = geometry.match(/Position: (\d+),(\d+) \(screen: \d+\)/);
    if (positionMatch) {
      const [x, y] = positionMatch.slice(1).map(Number);
      // Update windowPos using setGlobalState
      console.log(x, y);
      setGlobalState('global/setWindowPos', { x, y });
    }

    getMainWindow().setTitle(`Automaton - ${windowId}`);
    resetWorkers();
    setGlobalState('global/setWindowTitle', `Automaton - (${windowId})`);
    setGlobalState('global/setWindowId', windowId);
  } catch (error) {
    console.error(`Error getting active window ID: ${error}`);
  }
};

export const getSelectedWindowId = () => selectedWindowId;
