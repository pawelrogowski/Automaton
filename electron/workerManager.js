import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { showNotification } from './notificationHandler.js';
import { createLogger } from './utils/logger.js';
const log = createLogger();

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const WORKER_INIT_DELAY = 50;

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
    // Set up x11 utility paths
    if (app.isPackaged) {
      this.paths.utils = path.join(app.getAppPath(), '..', 'resources', 'x11utils');
    } else {
      this.paths.utils = path.join(cwd, '..', 'resources', 'x11utils');
    }

    // X11 utilities paths
    this.paths.x11capture = path.join(this.paths.utils, 'x11RegionCapture.node');
    this.paths.keypress = path.join(this.paths.utils, 'keypress.node');
    this.paths.useItemOn = path.join(this.paths.utils, 'useItemOn.node');
    // this.paths.windowInfo = path.join(this.paths.utils, 'windowinfo.node');
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
    // Use the same path resolution approach as the original implementation
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

    // Handle specific game state updates from workers
    // {{change 1: Add case for the new combined update action type}}
    if (message.storeUpdate && message.type === 'gameState/updateGameStateFromMonitorData') {
        setGlobalState(message.type, message.payload); // Dispatch the payload directly
    }
    // {{end change 1}}
    else if (message.storeUpdate && message.type === 'setHealthPercent') {
      // {{change 2: Keep for backwards compatibility or remove if no longer used elsewhere}}
      setGlobalState('gameState/setHealthPercent', message.payload);
    } else if (message.storeUpdate && message.type === 'setManaPercent') {
      // {{change 3: Keep for backwards compatibility or remove if no longer used elsewhere}}
      setGlobalState('gameState/setManaPercent', message.payload);
      // Add case for the new actual FPS update
    } else if (message.storeUpdate) {
      log('warn', '[Worker Manager] Unrecognized storeUpdate:', message);
    }
    // Handle messages from the luaVMWorker
    if (message.type === 'scriptResult' || message.type === 'scriptError') {
        // TODO: Handle the result/error, potentially update the Redux store
        // setGlobalState('lua/scriptResult', message); // Example dispatch
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

      await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));
      const reduxState = store.getState();
      newWorker.postMessage(reduxState);

      if (name === 'screenMonitor') {
        this.resetRestartState(name);
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
        const worker = this.startWorker('screenMonitor');
        if (worker) {
          setTimeout(() => {
            worker.postMessage(state);
          }, 100);
        }
      }

      // if (!this.workers.has('rawCapture')) {
      //   console.log('Starting rawCapture worker for window ID:', windowId);
      //   const worker = this.startWorker('rawCapture');
      //   if (worker) {
      //     setTimeout(() => {
      //       worker.postMessage(state);
      //     }, 100);
      //   }
      // }
    }

    // Update existing workers
    for (const [name, worker] of this.workers) {
      if (!this.restartLocks.get(name)) {
        worker.postMessage(state);
      }
    }

    // Handle Lua script execution requests
    const luaState = state.lua;
    const luaWorker = this.workers.get('luaVMWorker');

    if (luaState && luaState.scripts && luaWorker) {
      // Find scripts marked for execution
      const scriptsToExecute = luaState.scripts.filter(script => script.execute);

      scriptsToExecute.forEach(script => {
        log('info', `[Worker Manager] Requesting execution of Lua script: ${script.name} (${script.id})`);
        // Send script to worker for execution
        luaWorker.postMessage({ type: 'executeScript', scriptId: script.id, code: script.code });

        // Immediately update state to reflect execution request and set status to running
        // Dispatching directly in the main process store
        store.dispatch({ type: 'lua/setScriptStatus', payload: { id: script.id, status: 'running' } });
        store.dispatch({ type: 'lua/updateScript', payload: { id: script.id, updates: { execute: false } } });
      });
    }
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    // Start the Lua VM worker on initialization
    this.startWorker('luaVMWorker');
    store.subscribe(this.handleStoreUpdate);

    app.on('before-quit', () => this.stopAllWorkers());
    app.on('will-quit', () => this.stopAllWorkers());
    app.on('window-all-closed', () => this.stopAllWorkers());
  }
}

const workerManager = new WorkerManager();

export const restartWorker = async (workerName) => {
  return await workerManager.restartWorker(workerName);
};

export default workerManager;
