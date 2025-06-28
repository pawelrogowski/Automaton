import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { showNotification } from './notificationHandler.js';
import { createLogger } from './utils/logger.js';
import { BrowserWindow } from 'electron';
import { playSound } from './globalShortcuts.js';
const log = createLogger(); // Use default logger configuration

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const WORKER_INIT_DELAY = 50;
class WorkerManager {
  constructor() {
    const filename = fileURLToPath(import.meta.url);
    this.electronDir = dirname(filename);

    this.workers = new Map(); // Map<scriptId, { worker: Worker, config: ScriptConfig }> for luaScriptWorker, Map<name, Worker> for other workers
    this.workerPaths = new Map(); // Map<scriptId, workerPath> or Map<name, workerPath>
    this.prevWindowId = null;
    this.restartLocks = new Map();
    this.restartAttempts = new Map();
    this.restartTimeouts = new Map();

    this.paths = {
      utils: null,
      workers: null,
    };

    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
  }

  setupPaths(app, cwd) {
    if (app.isPackaged) {
      this.paths.utils = path.join(app.getAppPath(), '..', 'resources', 'x11utils');
    } else {
      this.paths.utils = path.join(cwd, '..', 'resources', 'x11utils');
    }
    this.paths.useItemOn = path.join(this.paths.utils, 'useItemOn.node');

    if (!app.isPackaged) {
      log('info', '[Worker Manager] Paths initialized:', this.paths);
    }
  }

  resetRestartState(name) {
    this.restartLocks.set(name, false);
    this.restartAttempts.set(name, 0);
    clearTimeout(this.restartTimeouts.get(name));
    this.restartTimeouts.delete(name);
  }

  async clearRestartLockWithTimeout(name) {
    const timeout = setTimeout(() => {
      log('warn', `[Worker Manager] Force clearing restart lock: ${name}`);
      this.resetRestartState(name);
    }, RESTART_LOCK_TIMEOUT);

    this.restartTimeouts.set(name, timeout);
  }

  getWorkerPath(workerName) {
    // For luaScriptWorker, workerName is the scriptId, so we always point to luaScriptWorker.js
    // Regex to match a UUID format (e.g., 3c76c71e-9657-4987-935b-f3da621081b0)
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(workerName);

    if (isUUID) {
      // If the workerName is a UUID, it's a persistent script, so always use luaScriptWorker.js
      return resolve(this.electronDir, './workers', 'luaScriptWorker.js');
    }
    // For other workers (like screenMonitor), use their specific name
    return resolve(this.electronDir, './workers', `${workerName}.js`);
  }

  handleWorkerError(name, error) {
    log('error', `[Worker Manager] Worker error: ${name}`, error);
    // For luaScriptWorkers, errors will be handled by the store update logic (which will restart them if enabled)
    // For other workers (like screenMonitor), we still want the restart logic
    if (!name.startsWith('script-') && !this.restartLocks.get(name)) {
      this.restartWorker(name).catch((err) => {
        log('error', `[Worker Manager] Restart failed after error: ${name}`, err);
      });
    } else if (name.startsWith('script-')) {
      // For script workers, just log and let the handleStoreUpdate manage their lifecycle
      log('info', `[Worker Manager] Script worker ${name} encountered an error. Lifecycle managed by store updates.`);
      this.workers.delete(name); // Remove from map so handleStoreUpdate can re-spawn if needed
    }
  }

  handleWorkerExit(name, code) {
    log('info', `[Worker Manager] Worker exited: ${name}, code ${code}`);
    this.workers.delete(name); // Remove the entry from the map
    this.workerPaths.delete(name); // Ensure path is also removed

    // Only attempt restart for non-script workers if they exited with an error code
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);

    if (!isUUID && code !== 0) {
      // This is a non-script worker and it exited with an error
      const attempts = this.restartAttempts.get(name) || 0;
      if (!this.restartLocks.get(name) && attempts < MAX_RESTART_ATTEMPTS) {
        log(
          'error',
          `[Worker Manager] Non-script worker exited with error: ${name}, code ${code}, attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS}`,
        );
        setTimeout(
          () => {
            this.restartWorker(name).catch((err) => {
              log('error', `Failed to restart worker ${name} after exit:`, err);
            });
          },
          RESTART_COOLDOWN * (attempts + 1),
        );
      } else if (attempts >= MAX_RESTART_ATTEMPTS) {
        log('error', `[Worker Manager] Max restart attempts reached for non-script worker: ${name}`);
        this.resetRestartState(name);
      }
    } else if (isUUID) {
      // For script workers (identified by UUID), exit is expected when disabled or updated.
      // The handleStoreUpdate will manage re-spawning if needed.
      log('debug', `[Worker Manager] Script worker ${name} exited. Lifecycle managed by store updates.`);
    } else {
      // This is a non-script worker and it exited cleanly (code 0)
      log('debug', `[Worker Manager] Non-script worker ${name} exited cleanly.`);
    }
  }

  handleWorkerMessage(message) {
    if (message.notification) {
      const { title, body } = message.notification;
      showNotification(title, body);
    }

    // Handle specific store updates originating from workers
    if (message.storeUpdate) {
      const { type, payload } = message;
      if (type) {
        setGlobalState(type, payload);
      } else {
        log('warn', '[Worker Manager] Received storeUpdate message without type.', message);
      }
    } else if (message.type === 'scriptError') {
      const logMessage = message.error;
      setGlobalState('lua/addLogEntry', { id: message.scriptId, message: logMessage });

      const { scriptId } = message; // Get scriptId from message
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('script-log-update', { scriptId, message: logMessage });
        }
      });
    } else if (message.type === 'luaPrint') {
      const { scriptId, message: logMessage } = message;
      if (scriptId && logMessage !== undefined) {
        setGlobalState('lua/addLogEntry', { id: scriptId, message: logMessage });

        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('script-log-update', { scriptId, message: logMessage });
          }
        });
      } else {
        log('warn', '[Worker Manager] Received incomplete luaPrint message:', message);
      }
    } else if (message.type === 'luaStatusUpdate') {
      const { scriptId, message: statusMessage } = message;
      if (scriptId && statusMessage !== undefined) {
        setGlobalState('lua/addLogEntry', { id: scriptId, message: statusMessage });

        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('script-log-update', { scriptId, message: statusMessage });
          }
        });
      } else {
        log('warn', '[Worker Manager] Received incomplete luaStatusUpdate message:', message);
      }
    } else if (message.type === 'play_alert') {
      log('info', '[Worker Manager] Received play_alert message from worker.');
      playSound('alert.wav');
    } else {
      // Handle other types of messages if necessary
    }
  }

  startWorker(name, scriptConfig = null, paths = null) {
    // Add paths parameter
    log('debug', `[Worker Manager] Attempting to start worker: ${name}`);
    if (this.workers.has(name)) {
      log('warn', `[Worker Manager] Worker already exists: ${name}`);
      return this.workers.get(name).worker; // Return the worker instance
    }

    try {
      const workerPath = this.getWorkerPath(name);
      log('debug', `[Worker Manager] Resolved worker path for ${name}: ${workerPath}`);
      const worker = new Worker(workerPath, {
        name,
        workerData: {
          paths: paths || this.paths, // Pass the entire paths object
        },
      });

      this.workerPaths.set(name, workerPath);
      worker.on('message', (msg) => this.handleWorkerMessage(msg));
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));

      this.workers.set(name, { worker, config: scriptConfig }); // Store worker and its config
      log('info', `[Worker Manager] Worker ${name} started successfully.`);

      // Post initial state or script config once worker is ready, after a small delay
      setTimeout(() => {
        if (scriptConfig) {
          // Check if scriptConfig is provided (implies it's a script worker)
          log('debug', `[Worker Manager] Sending 'init' and 'stateUpdate' to script worker: ${name}`);
          // For luaScriptWorker, send the specific script config
          worker.postMessage({ type: 'init', script: scriptConfig });
          // Also send the current full state
          worker.postMessage({ type: 'stateUpdate', state: store.getState() });
        } else {
          log('debug', `[Worker Manager] Sending initial state to non-script worker: ${name}`);
          // For other workers (like screenMonitor), send the raw initial state
          worker.postMessage(store.getState());
        }
      }, WORKER_INIT_DELAY);

      return worker;
    } catch (error) {
      log('error', `[Worker Manager] Failed to start worker: ${name}`, error);
      return null;
    }
  }

  async restartWorker(name, scriptConfig = null) {
    log('debug', `[Worker Manager] Attempting to restart worker: ${name}`);
    if (this.restartLocks.get(name)) {
      log('info', `[Worker Manager] Restart in progress: ${name}`);
      return null;
    }

    this.restartLocks.set(name, true);
    this.restartAttempts.set(name, (this.restartAttempts.get(name) || 0) + 1);
    this.clearRestartLockWithTimeout(name);

    try {
      log('debug', `[Worker Manager] Stopping worker for restart: ${name}`);
      await this.stopWorker(name);
      await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));

      const newWorker = this.startWorker(name, scriptConfig, this.paths); // Pass scriptConfig and paths
      if (!newWorker) {
        throw new Error(`Failed to create new worker: ${name}`);
      }
      log('info', `[Worker Manager] Worker ${name} restarted successfully.`);

      // After starting, send the latest state if it's not a script worker (script workers get it on init)
      // The check for name.startsWith('script-') is no longer needed here as scriptConfig presence implies script worker
      if (!scriptConfig) {
        // If scriptConfig is null, it's a non-script worker
        await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));
        const reduxState = store.getState();
        newWorker.postMessage(reduxState);
      }

      return newWorker;
    } catch (error) {
      log('error', `[Worker Manager] Error during restart: ${name}`, error);
      this.resetRestartState(name);
    } finally {
      setTimeout(() => {
        this.restartLocks.set(name, false);
      }, RESTART_COOLDOWN);
    }
  }

  async stopWorker(name) {
    log('debug', `[Worker Manager] Attempting to stop worker: ${name}`);
    const workerEntry = this.workers.get(name); // Get the worker entry (object with worker and config)
    if (workerEntry && workerEntry.worker) {
      try {
        await workerEntry.worker.terminate(); // Terminate the actual worker instance
        log('info', `[Worker Manager] Worker ${name} terminated successfully.`);
      } catch (error) {
        log('error', `[Worker Manager] Error terminating worker: ${name}`, error);
      }
      this.workers.delete(name);
      this.workerPaths.delete(name);
    } else {
      log('warn', `[Worker Manager] Attempted to stop non-existent worker: ${name}`);
    }
  }

  stopAllWorkers() {
    log('info', '[Worker Manager] Stopping all workers.');
    for (const [name] of this.workers) {
      this.stopWorker(name);
    }
  }

  async restartAllWorkers() {
    log('info', '[Worker Manager] Restarting all workers.');
    const workers = Array.from(this.workers.keys());
    for (const name of workers) {
      await this.restartWorker(name);
    }
  }

  handleStoreUpdate() {
    log('debug', '[Worker Manager] handleStoreUpdate triggered.');
    const state = store.getState();
    const { windowId } = state.global;
    const { enabled: cavebotEnabled } = state.cavebot; // Get cavebot enabled state
    const currentEnabledPersistentScripts = state.lua.persistentScripts.filter((script) => script.enabled);

    // Handle screenMonitor worker lifecycle
    if (windowId) {
      if (!this.workers.has('screenMonitor')) {
        log('info', '[Worker Manager] Starting screenMonitor for window ID:', windowId);
        this.startWorker('screenMonitor', null, this.paths); // Pass paths
      }
    } else {
      if (this.workers.has('screenMonitor')) {
        log('info', '[Worker Manager] Stopping screenMonitor as window ID is no longer set.');
        this.stopWorker('screenMonitor');
      }
    }

    // Handle minimapMonitor worker lifecycle
    if (windowId) {
      if (!this.workers.has('minimapMonitor')) {
        log('info', '[Worker Manager] Starting minimapMonitor for window ID:', windowId);
        this.startWorker('minimapMonitor', null, this.paths); // Pass paths
      }
    } else {
      if (this.workers.has('minimapMonitor')) {
        log('info', '[Worker Manager] Stopping minimapMonitor as window ID is no longer set.');
        this.stopWorker('minimapMonitor');
      }
    }

    // Handle pathfinderWorker worker lifecycle
    if (windowId) {
      if (!this.workers.has('pathfinderWorker')) {
        log('info', '[Worker Manager] Starting pathfinderWorker for window ID:', windowId);
        this.startWorker('pathfinderWorker', null, this.paths); // Pass paths
      }
    } else {
      if (this.workers.has('pathfinderWorker')) {
        log('info', '[Worker Manager] Stopping pathfinderWorker as window ID is no longer set.');
        this.stopWorker('pathfinderWorker');
      }
    }

    // --- NEW: Handle pathFollowerWorker lifecycle ---
    // It should run only if a window is attached AND cavebot is enabled.
    if (windowId && cavebotEnabled) {
      if (!this.workers.has('pathFollowerWorker')) {
        log('info', '[Worker Manager] Starting pathFollowerWorker.');
        this.startWorker('pathFollowerWorker', null, this.paths);
      }
    } else {
      if (this.workers.has('pathFollowerWorker')) {
        log('info', '[Worker Manager] Stopping pathFollowerWorker (no window or cavebot disabled).');
        this.stopWorker('pathFollowerWorker');
      }
    }
    // --- END NEW SECTION ---

    // Manage individual luaScriptWorkers
    const activeScriptIds = new Set(currentEnabledPersistentScripts.map((script) => script.id));
    const runningScriptWorkerIds = new Set(
      Array.from(this.workers.keys()).filter((name) => {
        // Check if the name is a UUID, indicating it's a script worker
        const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
        return isUUID;
      }),
    );

    log('debug', `[Worker Manager] Active script IDs from store: ${Array.from(activeScriptIds).join(', ')}`);
    log('debug', `[Worker Manager] Running script worker IDs: ${Array.from(runningScriptWorkerIds).join(', ')}`);

    // Stop workers for scripts that are no longer enabled or have been removed
    for (const scriptId of runningScriptWorkerIds) {
      if (!activeScriptIds.has(scriptId)) {
        log('info', `[Worker Manager] Stopping worker for script: ${scriptId} (no longer enabled or removed).`);
        this.stopWorker(scriptId);
      }
    }

    // Start or update workers for currently enabled scripts
    for (const script of currentEnabledPersistentScripts) {
      const workerName = script.id; // Use script ID as worker name
      const workerEntry = this.workers.get(workerName); // Get the stored entry { worker, config }

      if (!workerEntry) {
        log('info', `[Worker Manager] Starting new worker for script: ${script.name} (${script.id}).`);
        this.startWorker(workerName, script, this.paths); // Pass the full script config and paths
      } else {
        // Check if critical script properties have changed, requiring a full worker restart
        const oldConfig = workerEntry.config;
        const codeChanged = oldConfig.code !== script.code;
        const loopMinChanged = oldConfig.loopMin !== script.loopMin;
        const loopMaxChanged = oldConfig.loopMax !== script.loopMax;

        if (codeChanged || loopMinChanged || loopMaxChanged) {
          log(
            'info',
            `[Worker Manager] Script ${script.id} configuration changed (code: ${codeChanged}, loopMin: ${loopMinChanged}, loopMax: ${loopMaxChanged}). Restarting worker.`,
          );
          this.restartWorker(workerName, script); // Restart with new config
        } else {
          log('debug', `[Worker Manager] Worker for script ${script.id} already running. Sending state updates.`);
          // Only send state updates if no full restart is needed
          workerEntry.worker.postMessage({ type: 'stateUpdate', state: store.getState() });
          // No need to send updateScriptConfig if no critical changes, as the worker already has the latest config from the initial start or previous restart
        }
      }
    }

    // Send state updates to all non-script workers (e.g., screenMonitor)
    for (const [name, workerEntry] of this.workers) {
      // Check if the name is NOT a UUID, indicating it's a non-script worker
      const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
      if (!isUUID) {
        if (!this.restartLocks.get(name)) {
          log('debug', `[Worker Manager] Sending state update to non-script worker: ${name}`);
          workerEntry.worker.postMessage(state); // Access the worker instance
        }
      }
    }
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    log('info', '[Worker Manager] Initializing worker manager. Subscribing to store updates.');
    store.subscribe(this.handleStoreUpdate);

    app.on('before-quit', () => {
      log('info', '[Worker Manager] App quitting. Stopping all workers.');
      this.stopAllWorkers();
    });
    app.on('will-quit', () => {
      log('info', '[Worker Manager] App will quit. Stopping all workers.');
      this.stopAllWorkers();
    });
    app.on('window-all-closed', () => {
      log('info', '[Worker Manager] All windows closed. Stopping all workers.');
      this.stopAllWorkers();
    });
  }
}

const workerManager = new WorkerManager();

export default workerManager;
