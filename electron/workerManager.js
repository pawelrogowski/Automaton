import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { showNotification } from './notificationHandler.js';
import { getRedisConnectionDetails } from '../store/redisClient.js';

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
    this.paths.x11capture = path.join(this.paths.utils, 'x11capture.node');
    this.paths.keypress = path.join(this.paths.utils, 'keypress.node');
    this.paths.useItemOn = path.join(this.paths.utils, 'useItemOn.node');
    this.paths.windowInfo = path.join(this.paths.utils, 'windowinfo.node');
    this.paths.sequenceFinder = path.join(this.paths.utils, 'sequence_finder.node');

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
    // Use the same path resolution approach as the original implementation
    return resolve(this.electronDir, './workers', `${workerName}.js`);
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
      );
    } else if (attempts >= MAX_RESTART_ATTEMPTS) {
      console.error(`Maximum restart attempts reached for worker ${name}`);
      this.resetRestartState(name);
    } else {
      this.workers.delete(name);
    }
  }

  async handleWorkerMessage(message) {
    if (message.notification) {
      const { title, body } = message.notification;
      showNotification(title, body);
    }

    if (message.storeUpdate && message.type && message.payload) {
      setGlobalState(`gameState/${message.type}`, message.payload);
    } else if (message.storeUpdate) {
      console.warn('[WorkerManager] Received storeUpdate message with missing type or payload:', message);
    }
  }

  startWorker(name) {
    if (this.workers.has(name)) {
      console.warn(`Worker ${name} already exists`);
      return this.workers.get(name);
    }

    try {
      const redisDetails = getRedisConnectionDetails();
      if (!redisDetails || !redisDetails.host || !redisDetails.port) {
        console.error(`[WorkerManager] Cannot start worker ${name}: Redis connection details unavailable.`);
        return null;
      }
      console.log(`[WorkerManager] Passing Redis details to worker ${name}:`, redisDetails);

      const workerPath = this.getWorkerPath(name);
      const worker = new Worker(workerPath, {
        name,
        workerData: {
          x11capturePath: this.paths.x11capture,
          keypressPath: this.paths.keypress,
          useItemOnPath: this.paths.useItemOn,
          windowInfoPath: this.paths.windowInfo,
          sequenceFinderPath: this.paths.sequenceFinder,
          redisHost: redisDetails.host,
          redisPort: redisDetails.port,
        },
      });

      this.workerPaths.set(name, workerPath);
      worker.on('message', (msg) => this.handleWorkerMessage(msg));
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
      const reduxState = store.getState();
      newWorker.postMessage(reduxState);

      if (name === 'screenMonitor') {
        this.resetRestartState(name);
      }
      return newWorker;
    } catch (error) {
      console.error(`Error during worker ${name} restart:`, error);
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

    // Only restart workers if windowId actually changed and is valid
    if (windowId && windowId !== this.prevWindowId) {
      console.log(`Window ID changed from ${this.prevWindowId} to ${windowId}, restarting workers...`);
      if (!this.restartLocks.get('screenMonitor')) {
        this.restartAllWorkers();
      }
    }

    // Start screenMonitor if needed
    if (windowId && !this.workers.has('screenMonitor')) {
      console.log('Starting screenMonitor worker for window ID:', windowId);
      const worker = this.startWorker('screenMonitor');
      if (worker) {
        // Add a small delay before sending initial state
        setTimeout(() => {
          worker.postMessage(state);
        }, 100);
      }
    }

    // Update existing workers
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
