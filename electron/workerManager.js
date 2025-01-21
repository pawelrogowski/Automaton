import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import store from './store.js';
import setGlobalState from './setGlobalState.js';

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
      workerFiles: {
        screenMonitor: 'screenMonitor.js',
      },
      x11Modules: {
        x11capture: 'x11capture.node',
        keypress: 'keypress.node',
        useItemOn: 'useItemOn.node',
        windowInfo: 'windowinfo.node',
        sequenceFinder: 'sequence_finder.node',
      },
    };

    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
  }

  setupPaths(app, cwd) {
    this.paths.utils = app.isPackaged
      ? path.join(app.getAppPath(), '..', 'resources', 'x11utils')
      : path.join(cwd, '..', 'resources', 'x11utils');

    this.paths.workers = app.isPackaged ? path.join(app.getAppPath(), 'workers') : path.join(this.electronDir, 'workers');

    for (const [key, fileName] of Object.entries(this.paths.x11Modules)) {
      this.paths[key] = path.join(this.paths.utils, fileName);
    }

    for (const [key, fileName] of Object.entries(this.paths.workerFiles)) {
      this.paths.workerFiles[key] = path.join(this.paths.workers, fileName);
    }

    if (!app.isPackaged) {
      console.log('Initialized paths:', this.paths);
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
      console.warn(`Force clearing restart lock for ${name} after timeout`);
      this.resetRestartState(name);
    }, RESTART_LOCK_TIMEOUT);

    this.restartTimeouts.set(name, timeout);
  }

  getWorkerPath(workerName) {
    const workerPath = this.paths.workerFiles[workerName];
    if (!workerPath) {
      throw new Error(`Unknown worker type: ${workerName}`);
    }
    return workerPath;
  }

  handleWorkerError(name, error) {
    console.error(`Worker ${name} encountered an error:`, error);
    if (!this.restartLocks.get(name)) {
      this.restartWorker(name).catch((err) => {
        console.error(`Failed to restart worker ${name} after error:`, err);
      });
    }
  }

  handleWorkerExit(name, code) {
    const attempts = this.restartAttempts.get(name) || 0;

    if (code !== 0 && !this.restartLocks.get(name) && attempts < MAX_RESTART_ATTEMPTS) {
      console.error(`Worker ${name} exited with code ${code}, attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS}`);
      this.workers.delete(name);

      setTimeout(
        () => {
          this.restartWorker(name).catch((err) => {
            console.error(`Failed to restart worker ${name} after exit:`, err);
          });
        },
        RESTART_COOLDOWN * (attempts + 1),
      ); // Exponential backoff
    } else if (attempts >= MAX_RESTART_ATTEMPTS) {
      console.error(`Maximum restart attempts reached for worker ${name}`);
      this.resetRestartState(name);
    } else {
      this.workers.delete(name);
    }
  }

  handleWorkerMessage(message) {
    if (message.storeUpdate) {
      setGlobalState(`gameState/${message.type}`, message.payload);
    }
  }

  startWorker(name) {
    if (this.workers.has(name)) {
      console.warn(`Worker ${name} already exists`);
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
          windowInfoPath: this.paths.windowInfo,
          sequenceFinderPath: this.paths.sequenceFinder,
        },
      });

      this.workerPaths.set(name, workerPath);
      worker.on('message', this.handleWorkerMessage);
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));

      this.workers.set(name, worker);
      return worker;
    } catch (error) {
      console.error(`Failed to start worker ${name}:`, error);
      return null;
    }
  }

  async restartWorker(name) {
    if (this.restartLocks.get(name)) {
      console.log(`Restart already in progress for worker ${name}`);
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

      const state = store.getState();
      newWorker.postMessage(state);

      // Reset restart attempts on successful restart
      if (name === 'screenMonitor') {
        this.resetRestartState(name);
      }

      return newWorker;
    } catch (error) {
      console.error(`Error during worker ${name} restart:`, error);
      throw error;
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
        console.error(`Error terminating worker ${name}:`, error);
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

    if (windowId !== this.prevWindowId) {
      if (!this.restartLocks.get('screenMonitor')) {
        this.restartAllWorkers();
      }
    }

    if (windowId && !this.workers.has('screenMonitor')) {
      const worker = this.startWorker('screenMonitor');
      if (worker) {
        worker.postMessage(state);
      }
    }

    for (const [name, worker] of this.workers) {
      if (!this.restartLocks.get(name)) {
        worker.postMessage(state);
      }
    }

    this.prevWindowId = windowId;
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
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
