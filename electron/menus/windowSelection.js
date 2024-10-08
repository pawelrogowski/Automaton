import { dialog } from 'electron';
import { exec, fork } from 'child_process';
import { getMainWindow } from '../createMainWindow.js';
import store from '../store.js';
import { setWindowTitle, setWindowId } from '../../src/redux/slices/globalSlice.js';
import setGlobalState from '../setGlobalState.js';
import { resetWorkers } from '../main.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let xdotool;

if (app.isPackaged) {
  xdotool = path.join(app.getAppPath(), '..', 'resources', 'xdotool', 'xdotool');
} else {
  xdotool = path.join(__dirname, '..', '..', 'resources', 'xdotool', 'xdotool');
}
let selectedWindowId = null;

const getGeometry = (id) =>
  new Promise((resolve, reject) => {
    exec(`${xdotool} getwindowgeometry ${id}`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });

const getWindowName = (id) =>
  new Promise((resolve, reject) => {
    exec(`${xdotool} getwindowname ${id}`, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });

export const selectWindow = async () => {
  resetWorkers();
  exec(`${xdotool} selectwindow`, async (error, stdout) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    const windowId = stdout.trim();
    const geometry = await getGeometry(windowId);
    if (geometry.includes('1x1')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState('global/setWindowTitle', `Error: Please select a valid tibia window.`);
      return;
    }
    const windowTitle = await getWindowName(windowId);
    if (!windowTitle.includes('Tibia')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState('global/setWindowTitle', `Error: Please select a valid tibia window.`);
      return;
    }
    getMainWindow().setTitle(`Automaton - ${getWindowName(windowId)}`);
    setGlobalState('global/setWindowTitle', `Automaton - (${windowId})`);
    setGlobalState('global/setWindowId', windowId);
  });
};

const getActiveWindowId = () =>
  new Promise((resolve, reject) => {
    exec(`${xdotool} getactivewindow`, (error, stdout) => {
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
    const geometry = await getGeometry(windowId);
    if (geometry.includes('1x1')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window Selected');
      setGlobalState('global/setWindowTitle', `Error: Please select a valid tibia window.`);
      return;
    }
    const windowTitle = await getWindowName(windowId);
    if (!windowTitle.includes('Tibia')) {
      console.error('Error: Please select a valid tibia window.');
      getMainWindow().setTitle('Automaton - No Window');
      setGlobalState('global/setWindowTitle', `Error: Please select a valid tibia window.`);
      return;
    }

    // Extract position coordinates from geometry string
    const positionMatch = geometry.match(/Position: (\d+),(\d+) \(screen: \d+\)/);
    if (positionMatch) {
      const [x, y] = positionMatch.slice(1).map(Number);
      // Update windowPos using setGlobalState
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
