import { dialog } from 'electron';
import { exec, fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMainWindow } from '../../createWindow.js';

let selectedWindowId;
let workerProcess;

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

const startWorkerProcess = () => {
  const currentURL = new URL(import.meta.url);
  const currentDirname = path.dirname(fileURLToPath(currentURL));
  workerProcess = fork(path.join(currentDirname, '..', '..', 'monitorStats.js'));
  workerProcess.send({ command: 'start', windowId: selectedWindowId });
  workerProcess.on('message', (message) => {
    // Send IPC message to renderer process
    getMainWindow().webContents.send('dispatch', message);
    Object.keys(global.monitoringProcesses).forEach((id) => {
      if (global.monitoringProcesses[id] !== workerProcess) {
        console.log('forwarding message');
        global.monitoringProcesses[id].send(message);
      }
    });
  });

  // When the parent process is closed, kill the child process
  process.on('exit', () => {
    workerProcess.kill();
  });
};

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
        buttons: windowList,
        title: 'Select Tibia Client',
        checkboxLabel: 'Censor window title',
      })
      .then((result) => {
        selectedWindowId = validWindowIds[result.response];
        let windowTitle = windowNames[result.response];
        if (result.response === -1) {
          console.log('Window picking cancelled');
          return;
        }
        if (result.checkboxChecked) {
          const titleParts = windowTitle.split(' - ');
          if (titleParts.length > 1) {
            windowTitle = `${titleParts[0]} - Censored`;
          }
        }
        getMainWindow().setTitle(`Automaton - ${windowTitle}`);

        // If a worker process is already running, kill it
        if (workerProcess) {
          workerProcess.kill();
        }

        exec(`xdotool windowactivate ${selectedWindowId}`);
        console.log('windowID:', selectedWindowId);
        startWorkerProcess();
      });
  });
};

export const getSelectedWindowId = () => selectedWindowId;
