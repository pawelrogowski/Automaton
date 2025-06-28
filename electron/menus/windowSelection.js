import { getMainWindow } from '../createMainWindow.js';
import setGlobalState from '../setGlobalState.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ info: true, error: true, warn: true });

import workerManager from '../workerManager.js';
import windowinfo from 'windowinfo-native';

let selectedWindowId = null;

const getWindowName = (id) => windowinfo.getName(id);

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

    const screenMonitorWorkerEntry = workerManager.workers.get('screenMonitor');
    const minimapMonitorWorkerEntry = workerManager.workers.get('minimapMonitor');
    if (screenMonitorWorkerEntry && screenMonitorWorkerEntry.worker) {
      log('info', '[windowSelection] Sending forceReinitialize command to workers');
      screenMonitorWorkerEntry.worker.postMessage({ command: 'forceReinitialize' });
      minimapMonitorWorkerEntry.worker.postMessage({ command: 'forceReinitialize' });
    }
  } catch (error) {
    log('error', '[windowSelection] Error getting active window ID: ' + error);
  }
};

export const getSelectedWindowId = () => selectedWindowId;
