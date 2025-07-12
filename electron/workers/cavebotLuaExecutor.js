import { LuaFactory } from 'wasmoon';
import { parentPort } from 'worker_threads';
import { createLuaApi } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

/**
 * Manages a persistent Lua VM instance for the Cavebot worker.
 * This allows for stateful script execution across multiple waypoint actions,
 * providing a shared context for all cavebot-related Lua scripts.
 */
export class CavebotLuaExecutor {
  /**
   * @param {object} context - The context from the cavebot worker.
   */
  constructor(context) {
    this.lua = null;
    this.logger = context.logger;
    this.context = context;
    this.isInitialized = false;
    this.asyncFunctionNames = [];
    this.navigationOccurred = false;
    this.logger('info', '[CavebotLuaExecutor] Instance created.');
  }

  /**
   * Initializes the Lua VM and prepares it for execution.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    this.logger('info', '[CavebotLuaExecutor] Initializing Lua VM...');
    try {
      const factory = new LuaFactory();
      this.lua = await factory.createEngine();
      this.isInitialized = true;
      this.logger('info', '[CavebotLuaExecutor] Lua VM initialized successfully.');
      return true;
    } catch (error) {
      this.logger('error', '[CavebotLuaExecutor] Failed to initialize Lua VM:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Creates the full API and exposes it to the Lua global scope.
   * This method is called before each script execution to ensure the API
   * has access to the latest state and context.
   * @private
   */
  _syncApiToLua() {
    if (!this.lua) return;

    // 1. Get the complete API from the central factory.
    const { api, asyncFunctionNames, stateObject } = createLuaApi({
      type: 'cavebot',
      ...this.context, // Pass the cavebot worker's context, including direct navigation functions.
      postSystemMessage: (message) => parentPort.postMessage(message),
    });

    this.asyncFunctionNames = asyncFunctionNames;

    // 2. Wrap the navigation functions to track their usage.
    // This is critical for the cavebot worker to know if a script handled its own flow control.
    const wrappedApi = { ...api };
    const navFuncs = ['skipWaypoint', 'goToLabel', 'goToSection', 'goToWpt'];
    navFuncs.forEach((funcName) => {
      if (api[funcName]) {
        wrappedApi[funcName] = (...args) => {
          this.navigationOccurred = true; // Set the flag
          return api[funcName](...args); // Call the original function
        };
      }
    });

    // 3. Expose the final API and state object to Lua.
    for (const funcName in wrappedApi) {
      this.lua.global.set(funcName, wrappedApi[funcName]);
    }
    this.lua.global.set('__BOT_STATE__', stateObject);

    this.logger('debug', '[CavebotLuaExecutor] Cavebot Lua API and state synced to VM.');
  }

  /**
   * Executes a string of Lua code.
   * @param {string} scriptCode - The Lua code to execute.
   * @returns {Promise<{success: boolean, navigationOccurred: boolean, error?: string}>}
   */
  async executeScript(scriptCode) {
    if (!this.isInitialized) {
      return { success: false, error: 'Lua VM is not initialized.', navigationOccurred: false };
    }
    if (!scriptCode?.trim()) {
      return { success: true, navigationOccurred: false };
    }

    this.logger('info', '[CavebotLuaExecutor] Executing script...');
    this.navigationOccurred = false; // Reset flag before each run.

    try {
      this._syncApiToLua();
      const processedCode = preprocessLuaScript(scriptCode, this.asyncFunctionNames);
      await this.lua.doString(processedCode);
      return { success: true, navigationOccurred: this.navigationOccurred };
    } catch (error) {
      const errorMessage = error.message || String(error);
      this.logger('error', '[CavebotLuaExecutor] Script execution failed:', errorMessage);

      // Log the error to the specific waypoint's log in the UI.
      const scriptId = this.context.getState().cavebot.wptId;
      this.context.postStoreUpdate('cavebot/addWaypointLogEntry', { id: scriptId, message: `[ERROR] ${errorMessage}` });

      return { success: false, error: errorMessage, navigationOccurred: this.navigationOccurred };
    }
  }

  /**
   * Safely closes the Lua VM.
   */
  destroy() {
    if (this.lua) {
      this.lua.close();
      this.lua = null;
      this.isInitialized = false;
      this.logger('info', '[CavebotLuaExecutor] Lua VM destroyed.');
    }
  }
}
