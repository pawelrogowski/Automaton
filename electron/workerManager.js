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
const log = createLogger();

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const WORKER_INIT_DELAY = 50;
const SNIPPET_SCRIPT_ID = 'script-snippet'; // Special ID for snippets

class WorkerManager {
  constructor() {
    const filename = fileURLToPath(import.meta.url);
    this.electronDir = dirname(filename);

    this.workers = new Map();
    this.workerPaths = new Map();
    this.prevWindowId = null;
    this.restartLocks = new Map();
    this.restartAttempts = new Map();
    this.restartTimeouts = new Map();
    // We will now send the full state, so we need to track the last *full* state sent to the Lua worker
    this.lastSentLuaState = null; // This is still needed to track state for Lua worker restart logic


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

    this.paths.x11capture = path.join(this.paths.utils, 'x11RegionCapture.node');
    this.paths.keypress = path.join(this.paths.utils, 'keypress.node');
    this.paths.useItemOn = path.join(this.paths.utils, 'useItemOn.node');
    this.paths.findSequences = path.join(this.paths.utils, 'findSequences.node');

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
    return resolve(this.electronDir, './workers', `${workerName}.js`);
  }

  handleWorkerError(name, error) {
    log('error', `[Worker Manager] Worker error: ${name}`, error);
    if (!this.restartLocks.get(name)) {
      this.restartWorker(name).catch((err) => {
        log('error', `[Worker Manager] Restart failed after error: ${name}`, err);
      });
    }
  }

  handleWorkerExit(name, code) {
    const attempts = this.restartAttempts.get(name) || 0;

    if (code !== 0 && !this.restartLocks.get(name) && attempts < MAX_RESTART_ATTEMPTS) {
      log('error', `[Worker Manager] Worker exited: ${name}, code ${code}, attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS}`);
      this.workers.delete(name);

      setTimeout(
        () => {
          this.restartWorker(name).catch((err) => {
            console.error(`Failed to restart worker ${name} after exit:`, err);
          });
        },
        RESTART_COOLDOWN * (attempts + 1),
      );
    } else if (attempts >= MAX_RESTART_ATTEMPTS) {
      log('error', `[Worker Manager] Max restart attempts reached: ${name}`);
      this.resetRestartState(name);
    } else {
      this.workers.delete(name);
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
    }

    else if (message.type === 'scriptError') {
      const logMessage = message.error;
      setGlobalState('lua/addLogEntry', { id: message.scriptId, message: logMessage });

      const { scriptId } = message; // Get scriptId from message
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('script-log-update', { scriptId, message: logMessage });
        }
      });

    } else if (message.type === 'luaPrint') {
      const { scriptId, message: logMessage } = message;
      if (scriptId && logMessage !== undefined) {
        setGlobalState('lua/addLogEntry', { id: scriptId, message: logMessage });

        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach(win => {
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
        allWindows.forEach(win => {
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

  startWorker(name) {
    if (this.workers.has(name)) {
      log('warn', `[Worker Manager] Worker already exists: ${name}`);
      return this.workers.get(name);
    }

    try {
      const workerPath = this.getWorkerPath(name);
      const worker = new Worker(workerPath, {
        name,
        workerData: {
          x11capturePath: this.paths.x11capture,
          keypressPath: this.paths.keypress,
          useItemOnPath: this.paths.useItemOn,
          findSequencesPath: this.paths.findSequences,
        },
      });

      this.workerPaths.set(name, workerPath);
      worker.on('message', (msg) => this.handleWorkerMessage(msg));
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));

      this.workers.set(name, worker);
      // Post initial state once worker is ready, after a small delay
      setTimeout(() => {
        const initialState = store.getState();
        // {{change 1}}
        // Send full initial state to luaVMWorker wrapped in a message object
        if (name === 'luaVMWorker') {
          worker.postMessage({ type: 'initialState', state: initialState });
          this.lastSentLuaState = initialState; // Track for lua worker
        } else {
          // Send raw initial state object to other workers
          worker.postMessage(initialState);
        }

      }, WORKER_INIT_DELAY);


      return worker;
    } catch (error) {
      log('error', `[Worker Manager] Failed to start worker: ${name}`, error);
      return null;
    }
  }

  async restartWorker(name) {
    if (this.restartLocks.get(name)) {
      log('info', `[Worker Manager] Restart in progress: ${name}`);
      return null;
    }

    this.restartLocks.set(name, true);
    this.restartAttempts.set(name, (this.restartAttempts.get(name) || 0) + 1);
    this.clearRestartLockWithTimeout(name);

    try {
      await this.stopWorker(name);
      await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));

      const newWorker = this.startWorker(name);
      if (!newWorker) {
        throw new Error(`Failed to create new worker: ${name}`);
      }

      // After starting, send the latest state
      await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));
      const reduxState = store.getState();

      // {{change 2}}
      // Send full latest state to luaVMWorker wrapped in a message object
      if (name === 'luaVMWorker') {
        newWorker.postMessage({ type: 'stateUpdate', state: reduxState });
        this.lastSentLuaState = reduxState; // Track for lua worker
      } else {
        // Send raw latest state object to other workers
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
    const worker = this.workers.get(name);
    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        log('error', `[Worker Manager] Error terminating worker: ${name}`, error);
      }
      this.workers.delete(name);
      this.workerPaths.delete(name);
    }
  }

  stopAllWorkers() {
    for (const [name] of this.workers) {
      this.stopWorker(name);
    }
  }

  async restartAllWorkers() {
    const workers = Array.from(this.workers.keys());
    for (const name of workers) {
      await this.restartWorker(name);
    }
  }

  handleStoreUpdate() {
    const state = store.getState();
    const { windowId } = state.global;

    if (windowId) {
      if (!this.workers.has('screenMonitor')) {
        log('info', '[Worker Manager] Starting screenMonitor for window ID:', windowId);
        this.startWorker('screenMonitor');
      }
    } else {
      if (this.workers.has('screenMonitor')) {
        log('info', '[Worker Manager] Stopping screenMonitor as window ID is no longer set.');
        this.stopWorker('screenMonitor');
      }
    }


    // Update existing workers with the latest state
    for (const [name, worker] of this.workers) {
      if (!this.restartLocks.get(name)) {
        // {{change 3}}
        // Send full latest state to luaVMWorker wrapped in a message object
        if (name === 'luaVMWorker') {
          // Check if a restart is needed based on script changes before sending state
          const currentEnabledPersistentScripts = state.lua.persistentScripts.filter(script => script.enabled)
            .map(({ id, name, code, loopMin, loopMax }) => ({ id, name, code, loopMin, loopMax })); // Include name for logging

          const lastEnabledPersistentScripts = this.lastSentLuaState?.lua?.persistentScripts.filter(script => script.enabled)
            .map(({ id, name, code, loopMin, loopMax }) => ({ id, name, code, loopMin, loopMax })) || [];

          let luaWorkerNeedsRestart = false;
          const lastEnabledMap = new Map(lastEnabledPersistentScripts.map(script => [script.id, script]));
          const currentEnabledMap = new Map(currentEnabledPersistentScripts.map(script => [script.id, script]));

          // Check for scripts that were enabled but are now disabled
          for (const [scriptId, lastScript] of lastEnabledMap.entries()) {
            if (!currentEnabledMap.has(scriptId)) {
              log('info', `[Worker Manager] Detected disabled persistent script: ${lastScript.name} (${scriptId}). Restarting luaVMWorker.`);
              luaWorkerNeedsRestart = true;
              break;
            }
          }

          // If no restart needed yet, check for changes in code or settings of scripts that remain enabled
          if (!luaWorkerNeedsRestart) {
            for (const currentScript of currentEnabledPersistentScripts) {
              const lastScript = lastEnabledMap.get(currentScript.id);
              if (lastScript) {
                // Script was enabled before and is still enabled, check if details changed
                if (lastScript.code !== currentScript.code ||
                  lastScript.loopMin !== currentScript.loopMin ||
                  lastScript.loopMax !== currentScript.loopMax) {
                  log('info', `[Worker Manager] Detected change in enabled persistent script: ${currentScript.name} (${currentScript.id}). Restarting luaVMWorker.`);
                  luaWorkerNeedsRestart = true;
                  break; // Found a script that needs restart
                }
              } else {
                // A new script was enabled. This also requires a restart.
                log('info', `[Worker Manager] Detected new enabled persistent script: ${currentScript.name} (${currentScript.id}). Restarting luaVMWorker.`);
                luaWorkerNeedsRestart = true;
                break;
              }
            }
          }

          // Store the current full state for the next comparison, regardless of restart
          this.lastSentLuaState = state;


          if (luaWorkerNeedsRestart) {
            // Restart the entire luaVMWorker
            // restartWorker will fetch the latest state and send it to the new worker
            this.restartWorker('luaVMWorker');
          } else {
            // If no worker restart is needed, send the full state update message
            worker.postMessage({ type: 'stateUpdate', state: state });
            // log('info', '[Worker Manager] Full state update sent to luaVMWorker.'); // Mute internal log
          }
        } else {
          // Send raw latest state object to other workers
          worker.postMessage(state);
        }
      }
    }
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    this.startWorker('luaVMWorker');
    // screenMonitor is started by handleStoreUpdate when windowId is set
    store.subscribe(this.handleStoreUpdate);

    app.on('before-quit', () => this.stopAllWorkers());
    app.on('will-quit', () => this.stopAllWorkers());
    app.on('window-all-closed', () => this.stopAllWorkers());
  }
}

const workerManager = new WorkerManager();


export default workerManager;