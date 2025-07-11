import { LuaFactory } from 'wasmoon';
import { parentPort } from 'worker_threads';
import { createLuaApi } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

/**
 * Manages a persistent Lua VM instance for the Cavebot worker.
 */
export class CavebotLuaExecutor {
  /**
   * @param {object} context - The context from the cavebot worker.
   * @param {import('../utils/logger.js').Logger} context.logger - The logger instance.
   * @param {function} context.postStoreUpdate - Function to dispatch actions to Redux.
   * @param {function} context.getState - Function to get the latest application state.
   * @param {function} context.advanceToNextWaypoint - Function to advance to the next waypoint.
   * @param {function} context.goToLabel - Function to jump to a specific waypoint label.
   * @param {function} context.goToSection - Function to jump to a specific waypoint section.
   * @param {function} context.goToWpt - Function to jump to a specific waypoint index.
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

  _exposeApiToLua() {
    if (!this.lua) return;

    const { api: baseApi, asyncFunctionNames } = createLuaApi({
      type: 'cavebot',
      ...this.context,
      postSystemMessage: (message) => parentPort.postMessage(message),
    });

    this.asyncFunctionNames = asyncFunctionNames;

    const navigationApi = {
      skipWaypoint: () => {
        this.navigationOccurred = true;
        this.logger('info', '[Lua/Cavebot] Advancing to next waypoint via skipWaypoint().');
        this.context.advanceToNextWaypoint();
      },
      goToLabel: (label) => {
        this.navigationOccurred = true;
        this.logger('info', `[Lua/Cavebot] Attempting to go to label: "${label}"`);
        this.context.goToLabel(label);
      },
      goToSection: (sectionName) => {
        this.navigationOccurred = true;
        this.logger('info', `[Lua/Cavebot] Attempting to go to section: "${sectionName}"`);
        this.context.goToSection(sectionName);
      },
      // --- NEW FUNCTION START ---
      goToWpt: (index) => {
        this.navigationOccurred = true;
        this.logger('info', `[Lua/Cavebot] Attempting to go to waypoint index: ${index}`);
        this.context.goToWpt(index);
      },
      // --- NEW FUNCTION END ---
    };

    const finalApi = { ...baseApi, ...navigationApi };

    for (const funcName in finalApi) {
      if (Object.hasOwnProperty.call(finalApi, funcName)) {
        this.lua.global.set(funcName, finalApi[funcName]);
      }
    }
    this.logger('debug', '[CavebotLuaExecutor] Cavebot Lua API exposed to VM.');
  }

  _syncGameStateToLua() {
    if (!this.lua) return;
    const fullState = this.context.getState();
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

  async executeScript(scriptCode) {
    if (!this.isInitialized || !this.lua) {
      this.logger('error', '[CavebotLuaExecutor] Cannot execute script: VM not initialized.');
      return { success: false, error: 'Lua VM is not initialized.', navigationOccurred: false };
    }
    if (!scriptCode || !scriptCode.trim()) {
      return { success: true, navigationOccurred: false };
    }
    this.logger('info', '[CavebotLuaExecutor] Executing script...');
    this.navigationOccurred = false;
    try {
      this._syncGameStateToLua();
      const processedCode = preprocessLuaScript(scriptCode, this.asyncFunctionNames);
      await this.lua.doString(processedCode);
      return { success: true, navigationOccurred: this.navigationOccurred };
    } catch (error) {
      const errorMessage = error.message || String(error);
      this.logger('error', '[CavebotLuaExecutor] Script execution failed:', errorMessage);
      return { success: false, error: errorMessage, navigationOccurred: this.navigationOccurred };
    }
  }

  destroy() {
    if (this.lua) {
      this.lua.close();
      this.lua = null;
      this.isInitialized = false;
      this.logger('info', '[CavebotLuaExecutor] Lua VM destroyed and resources released.');
    }
  }
}
