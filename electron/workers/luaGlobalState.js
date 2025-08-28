// electron/workers/luaGlobalState.js

import { parentPort, workerData } from 'worker_threads';

/**
 * Manages the global Lua variables within a worker thread.
 * It acts as a proxy between the Lua VM and the main WorkerManager.
 */
export class LuaGlobalState {
  constructor(workerId, logger) {
    this.workerId = workerId;
    this.logger = logger;
    this.globals = new Map(); // Local cache of global Lua variables
    this.pendingGetRequests = new Map(); // Map to store promises for pending 'get' requests
    this.nextRequestId = 0;

    parentPort.on('message', this.handleMessage.bind(this));
    this.logger(
      'info',
      `[LuaGlobalState] Initialized for worker ${this.workerId}`,
    );
  }

  /**
   * Handles incoming messages from the main WorkerManager.
   * @param {object} message - The message received.
   */
  handleMessage(message) {
    if (message.type === 'lua_global_update') {
      const { key, value } = message.payload;
      this.globals.set(key, value);
      this.logger(
        'debug',
        `[LuaGlobalState] Received update for global '${key}': ${JSON.stringify(value)}`,
      );
      // Resolve any pending 'get' requests for this key
      if (this.pendingGetRequests.has(key)) {
        const requests = this.pendingGetRequests.get(key);
        requests.forEach(({ resolve }) => resolve(value));
        this.pendingGetRequests.delete(key);
      }
    } else if (message.type === 'lua_global_value') {
      const { key, value, requestId } = message.payload;
      if (this.pendingGetRequests.has(key)) {
        const requests = this.pendingGetRequests.get(key);
        const requestIndex = requests.findIndex(
          (req) => req.requestId === requestId,
        );
        if (requestIndex !== -1) {
          requests[requestIndex].resolve(value);
          requests.splice(requestIndex, 1);
          if (requests.length === 0) {
            this.pendingGetRequests.delete(key);
          }
        }
      }
      this.globals.set(key, value); // Update local cache
      this.logger(
        'debug',
        `[LuaGlobalState] Received value for global '${key}': ${JSON.stringify(value)}`,
      );
    }
  }

  /**
   * Sets a global Lua variable. Sends a message to WorkerManager.
   * @param {string} key - The name of the variable.
   * @param {*} value - The value to set.
   */
  set(key, value) {
    this.logger(
      'debug',
      `[LuaGlobalState] Setting global '${key}' to: ${JSON.stringify(value)}`,
    );
    this.globals.set(key, value); // Update local cache immediately for responsiveness
    parentPort.postMessage({
      type: 'lua_global_set',
      senderId: this.workerId,
      payload: { key, value },
    });
  }

  /**
   * Gets a global Lua variable. If not in local cache, requests from WorkerManager.
   * @param {string} key - The name of the variable.
   * @returns {Promise<*>} A promise that resolves with the variable's value.
   */
  get(key) {
    if (this.globals.has(key)) {
      this.logger(
        'debug',
        `[LuaGlobalState] Getting global '${key}' from cache: ${JSON.stringify(this.globals.get(key))}`,
      );
      return Promise.resolve(this.globals.get(key));
    }

    this.logger(
      'debug',
      `[LuaGlobalState] Requesting global '${key}' from WorkerManager.`,
    );
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      if (!this.pendingGetRequests.has(key)) {
        this.pendingGetRequests.set(key, []);
      }
      this.pendingGetRequests.get(key).push({ resolve, requestId });

      parentPort.postMessage({
        type: 'lua_global_get',
        senderId: this.workerId,
        payload: { key, requestId },
      });
    });
  }

  /**
   * Returns a proxy object that can be exposed to the Lua VM.
   * This proxy intercepts property access to simulate global variable behavior.
   * @returns {object} A proxy object for Lua global variables.
   */
  getLuaProxy() {
    return new Proxy(this, {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          // For Lua, 'nil' is the equivalent of 'undefined' or 'null'
          // We need to return a function that returns a promise for async gets
          return () => target.get(prop);
        }
        return Reflect.get(target, prop);
      },
      set: (target, prop, value) => {
        if (typeof prop === 'string') {
          target.set(prop, value);
          return true;
        }
        return Reflect.set(target, prop, value);
      },
      has: (target, prop) => {
        if (typeof prop === 'string') {
          return target.globals.has(prop);
        }
        return Reflect.has(target, prop);
      },
      deleteProperty: (target, prop) => {
        if (typeof prop === 'string') {
          target.set(prop, undefined); // Set to undefined to simulate deletion in Lua
          return true;
        }
        return Reflect.deleteProperty(target, prop);
      },
      ownKeys: (target) => {
        return Array.from(target.globals.keys());
      },
    });
  }
}
