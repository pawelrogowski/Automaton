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
   * @param {import('../utils/logger.js').Logger} context.logger - The logger instance.
   * @param {function} context.postStoreUpdate - Function to dispatch actions to Redux.
   * @param {function} context.getState - Function to get the latest application state.
   * @param {function} context.advanceToNextWaypoint - Function to advance to the next waypoint.
   * @param {function} context.goToLabel - Function to jump to a specific waypoint label.
   */
  constructor(context) {
    this.lua = null;
    this.logger = context.logger;
    this.context = context; // Store the entire context
    this.isInitialized = false;
    this.asyncFunctionNames = [];

    this.logger('info', '[CavebotLuaExecutor] Instance created.');
  }

  /**
   * Initializes the Lua VM, creates the engine, and exposes the custom Cavebot API.
   * This must be called before executing any scripts.
   * @returns {Promise<boolean>} True if initialization was successful, false otherwise.
   */
  async initialize() {
    this.logger('info', '[CavebotLuaExecutor] Initializing Lua VM...');
    try {
      const factory = new LuaFactory();
      this.lua = await factory.createEngine();
      this._exposeApiToLua();
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
   * Creates the Cavebot-specific API and sets the functions in the Lua global scope.
   * @private
   */
  _exposeApiToLua() {
    if (!this.lua) return;

    const { api, asyncFunctionNames } = createLuaApi({
      type: 'cavebot',
      // Pass through the context provided by cavebotWorker
      ...this.context,
      // Add system message posting capability
      postSystemMessage: (message) => parentPort.postMessage(message),
    });

    this.asyncFunctionNames = asyncFunctionNames;

    for (const funcName in api) {
      if (Object.hasOwnProperty.call(api, funcName)) {
        this.lua.global.set(funcName, api[funcName]);
      }
    }
    this.logger('debug', '[CavebotLuaExecutor] Cavebot Lua API exposed to VM.');
  }

  /**
   * Synchronizes the latest game state to the Lua VM's global scope.
   * This should be called before each script execution to ensure the script
   * has the most up-to-date information.
   * @private
   */
  _syncGameStateToLua() {
    if (!this.lua) return;

    const fullState = this.context.getState();
    // Expose specific, relevant slices of the state as global variables in Lua.
    const stateSlicesToExpose = {
      gameState: fullState.gameState,
      cavebot: fullState.cavebot,
      global: fullState.global,
    };

    for (const sliceName in stateSlicesToExpose) {
      if (Object.hasOwnProperty.call(stateSlicesToExpose, sliceName)) {
        const value = stateSlicesToExpose[sliceName];
        this.lua.global.set(sliceName, value === null || value === undefined ? this.lua.nil : value);
      }
    }
  }

  /**
   * Executes a given string of Lua code within the persistent VM.
   * @param {string} scriptCode - The Lua script to execute.
   * @returns {Promise<{success: boolean, error?: string}>} An object indicating the outcome.
   */
  async executeScript(scriptCode) {
    if (!this.isInitialized || !this.lua) {
      this.logger('error', '[CavebotLuaExecutor] Cannot execute script: VM not initialized.');
      return { success: false, error: 'Lua VM is not initialized.' };
    }

    if (!scriptCode || !scriptCode.trim()) {
      this.logger('warn', '[CavebotLuaExecutor] Attempted to execute an empty script.');
      return { success: true }; // Consider empty script a success (no-op)
    }

    this.logger('info', '[CavebotLuaExecutor] Executing script...');
    try {
      // Ensure the VM has the latest state before execution
      this._syncGameStateToLua();

      const processedCode = preprocessLuaScript(scriptCode, this.asyncFunctionNames);
      await this.lua.doString(processedCode);

      this.logger('info', '[CavebotLuaExecutor] Script executed successfully.');
      return { success: true };
    } catch (error) {
      const errorMessage = error.message || String(error);
      this.logger('error', '[CavebotLuaExecutor] Script execution failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Safely closes the Lua VM and releases its resources.
   */
  destroy() {
    if (this.lua) {
      this.lua.close();
      this.lua = null;
      this.isInitialized = false;
      this.logger('info', '[CavebotLuaExecutor] Lua VM destroyed and resources released.');
    }
  }
}
