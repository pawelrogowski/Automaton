import { getMainWindow } from '../createMainWindow.js';
import setGlobalState from '../setGlobalState.js';

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { restartWorker } from '../workerManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let windowInfoPath;

if (app.isPackaged) {
  windowInfoPath = path.join(app.getAppPath(), '..', 'resources', 'x11utils', 'windowinfo.node');
} else {
  windowInfoPath = path.join(__dirname, '..', '..', 'resources', 'x11utils', 'windowinfo.node');
}

const require = createRequire(import.meta.url);
const windowinfo = require(windowInfoPath);

let selectedWindowId = null;

const getWindowName = (id) => windowinfo.getName(id);

export const selectWindow = async () => {
  const pickedWindowId = windowinfo.getWindowIdByClick();
  const winInfo = windowinfo.getAllInfo(pickedWindowId);
  restartWorker('screenMonitor');
  if (!winInfo.name.includes('Tibia')) {
    return;
  }
  setGlobalState('global/setWindowId', pickedWindowId);
};

const getActiveWindowId = () => windowinfo.getActiveWindow();

export const selectActiveWindow = async () => {
  try {
    const windowId = await getActiveWindowId();

    const windowTitle = await getWindowName(windowinfo.getActiveWindow());
    if (!windowTitle.includes('Tibia')) {
      return;
    }
    restartWorker('screenMonitor');
    getMainWindow().setTitle(``);
    setGlobalState('global/setWindowId', windowId);
  } catch (error) {
    console.error(`Error getting active window ID: ${error}`);
  }
};

export const getSelectedWindowId = () => selectedWindowId;
