import { getMainWindow } from '../createMainWindow.js';
import setGlobalState from '../setGlobalState.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ info: true, error: true, warn: true });

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import workerManager from '../workerManager.js';

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
  if (!winInfo.name.includes('Tibia')) {
    return;
  }
  setGlobalState('global/setWindowTitle', winInfo.name);
  setGlobalState('global/setWindowId', pickedWindowId);
};

const getActiveWindowId = () => windowinfo.getActiveWindow();

export const selectActiveWindow = async () => {
  try {
    const windowId = await getActiveWindowId();
    const windowTitle = await getWindowName(windowId);

    if (!windowTitle.includes('Tibia')) {
      setGlobalState('global/setWindowTitle', 'Please focus a Tibia window and press Alt+W');
      return;
    }
    getMainWindow().setTitle(``);
    setGlobalState('global/setWindowTitle', windowTitle);
    setGlobalState('global/setWindowId', windowId);

    const screenMonitorWorker = workerManager.workers.get('screenMonitor');
    if (screenMonitorWorker) {
      log('info', '[windowSelection] Sending forceReinitialize command to screenMonitor');
      screenMonitorWorker.postMessage({ command: 'forceReinitialize' });
    }

  } catch (error) {
    log('error', '[windowSelection] Error getting active window ID: ' + error);
  }
};

export const getSelectedWindowId = () => selectedWindowId;
