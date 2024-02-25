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
  const electronWindowId = getMainWindow().getNativeWindowHandle().readUInt32LE().toString();
  exec('xdotool search --name "Tibia -"', async (error, stdout) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    const windowIds = await Promise.all(
      stdout.split('\n').map(async (id) => {
        if (id && id !== electronWindowId) {
          const geometry = await getGeometry(id);
          return !geometry.includes('1x1') ? id : null;
        }
        return null;
      }),
    );
    const validWindowIds = windowIds.filter((id) => id !== null);
    const windowNames = await Promise.all(validWindowIds.map(getWindowName));
    const windowList = validWindowIds.map((id, index) => `${windowNames[index]}`);
    dialog
      .showMessageBox({
        buttons: ['Cancel', ...windowList],
        title: 'Select Tibia Client',
      })
      .then((result) => {
        if (result.response === 0) {
          setGlobalState('global/setWindowId', null);
          setGlobalState('global/setWindowTitle', 'Pick a window from the bot menu');
          return;
        }
        selectedWindowId = validWindowIds[result.response - 1];
        const selectedWindowTitle = windowNames[result.response - 1];
        getMainWindow().setTitle(`Automaton - ${selectedWindowTitle}`);

        exec(`xdotool windowactivate ${selectedWindowId} --sync`);
        // console.log('windowID:', selectedWindowId);

        setGlobalState('global/setWindowTitle', selectedWindowTitle);
        setGlobalState('global/setWindowId', null);
        setGlobalState('global/setWindowId', selectedWindowId);
      });
  });
};

export const getSelectedWindowId = () => selectedWindowId;
