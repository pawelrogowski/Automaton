// /home/feiron/Dokumenty/Automaton/electron/workers/cavebotLuaExecutor.js

import { LuaFactory } from 'wasmoon';
import { parentPort } from 'worker_threads';
import { performance } from 'perf_hooks';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLuaApi, createStateShortcutObject } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CavebotLuaExecutor {
  constructor(context) {
    this.lua = null;
    this.logger = context.logger;
    this.context = context;
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.executionCount = 0;
    this.totalExecutionTime = 0;
    this.lastPerfReport = Date.now();
    this.asyncFunctionNames = [];
    this.navigationOccurred = false;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 5000000;
    this.reusableResult = {
      success: false,
      error: null,
      navigationOccurred: false,
    };

    // NEW: For handling awaitable input actions
    this.pendingInputActions = new Map();
    this.nextActionId = 0;

    this.logger(
      'info',
      '[CavebotLuaExecutor] Instance created with performance monitoring.',
    );
  }

  // ======================= FIX START: COMPLETE REFACTOR OF INITIALIZATION AND SYNC =======================

  async _loadLuaLibraries() {
    if (!this.lua) return;
    const libPath = path.join(__dirname, 'lua', 'lib');
    try {
      const files = await fs.readdir(libPath);
      for (const file of files) {
        if (path.extname(file) === '.lua') {
          const filePath = path.join(libPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          await this.lua.doString(content);
          this.logger(
            'info',
            `[CavebotLuaExecutor] Loaded Lua library: ${file}`,
          );
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger(
          'error',
          `[CavebotLuaExecutor] Error loading Lua libraries:`,
          error,
        );
      } else {
        this.logger(
          'info',
          `[CavebotLuaExecutor] No Lua libraries found to load.`,
        );
      }
    }
  }

  async initialize() {
    if (this.isShuttingDown) return false;
    this.logger(
      'info',
      '[CavebotLuaExecutor] Initializing Lua VM and full API...',
    );

    try {
      const initStart = performance.now();
      const factory = new LuaFactory();
      this.lua = await factory.createEngine();
      await this._loadLuaLibraries();

      // Create the full API, including the SharedGlobals proxy, ONCE.
      const { api, asyncFunctionNames: newNames } = await createLuaApi({
        type: 'cavebot',
        ...this.context,
        postSystemMessage: (message) => {
          if (!this.isShuttingDown) parentPort.postMessage(message);
        },
        refreshLuaGlobalState: () => this._syncDynamicStateToLua(), // This now calls the lightweight sync
        sharedLuaGlobals: this.context.sharedLuaGlobals,
        lua: this.lua,
        postInputAction: (action) => this.postInputAction(action),
      });

      this.asyncFunctionNames = newNames;

      // Wrap navigation functions to track events
      const wrappedApi = { ...api };
      const navFuncs = ['skipWaypoint', 'goToLabel', 'goToSection', 'goToWpt'];
      navFuncs.forEach((funcName) => {
        if (api[funcName]) {
          wrappedApi[funcName] = (...args) => {
            this.navigationOccurred = true;
            return api[funcName](...args);
          };
        }
      });

      // Set all functions and the SharedGlobals proxy in the Lua environment
      const globals = this.lua.global;
      for (const funcName in wrappedApi) {
        globals.set(funcName, wrappedApi[funcName]);
      }

      // Perform the first sync of dynamic state (__BOT_STATE__)
      await this._syncDynamicStateToLua();

      const initTime = performance.now() - initStart;
      this.logger(
        'info',
        `[CavebotLuaExecutor] Lua VM and API initialized successfully in ${initTime.toFixed(2)}ms.`,
      );

      this.isInitialized = true;
      this.consecutiveErrors = 0;
      return true;
    } catch (error) {
      this.logger(
        'error',
        '[CavebotLuaExecutor] Failed to initialize Lua VM:',
        error,
      );
      this.isInitialized = false;
      return false;
    }
  }

  // This is the new lightweight function that runs before each script execution.
  // It ONLY updates the __BOT_STATE__ object with fresh, per-tick data.
  async _syncDynamicStateToLua() {
    if (!this.lua || this.isShuttingDown) return;

    // Get fresh state from the main thread
    await this.context.getFreshState();

    // Create and set only the dynamic state object
    const stateObject = createStateShortcutObject(
      () => this.context.getState(),
      'cavebot',
    );
    this.lua.global.set('__BOT_STATE__', stateObject);
  }

  // The old _syncApiToLua function is no longer needed and has been replaced by the logic above.

  // ======================= FIX END =======================

  // NEW: Method to handle awaitable input actions
  postInputAction(action) {
    return new Promise((resolve, reject) => {
      const actionId = this.nextActionId++;
      this.pendingInputActions.set(actionId, { resolve, reject, action });

      // Timeout to prevent promises from hanging forever
      const timeout = setTimeout(() => {
        if (this.pendingInputActions.has(actionId)) {
          this.logger(
            'error',
            `[CavebotLuaExecutor] Input action timed out: ${JSON.stringify(action)}`,
          );
          this.pendingInputActions.delete(actionId);
          reject(new Error('Input action timed out after 30 seconds'));
        }
      }, 30000); // 30-second timeout

      this.pendingInputActions.get(actionId).timeout = timeout;

      parentPort.postMessage({
        type: 'inputAction',
        payload: { ...action, actionId }, // Pass actionId to orchestrator
      });
    });
  }

  // NEW: Method to resolve promises when an action is completed
  handleInputActionCompleted(payload) {
    const { actionId, success, error } = payload;
    const pending = this.pendingInputActions.get(actionId);

    if (pending) {
      clearTimeout(pending.timeout); // Clear the timeout
      if (success) {
        pending.resolve();
      } else {
        this.logger(
          'error',
          `[CavebotLuaExecutor] Input action failed: ${error}`,
          pending.action,
        );
        pending.reject(
          new Error(error || 'Input action failed in orchestrator'),
        );
      }
      this.pendingInputActions.delete(actionId);
    }
  }

  _logPerformanceStats() {
    const now = Date.now();
    const timeSinceLastReport = now - this.lastPerfReport;

    if (timeSinceLastReport >= 30000) {
      const avgExecTime =
        this.executionCount > 0
          ? (this.totalExecutionTime / this.executionCount).toFixed(2)
          : 0;
      const execPerMinute = (
        (this.executionCount / timeSinceLastReport) *
        60000
      ).toFixed(1);

      this.logger(
        'info',
        `[CavebotLuaExecutor] Performance: ${execPerMinute} executions/min, avg: ${avgExecTime}ms, errors: ${this.consecutiveErrors}`,
      );

      this.executionCount = 0;
      this.totalExecutionTime = 0;
      this.lastPerfReport = now;
    }
  }

  _resetResult() {
    this.reusableResult.success = false;
    this.reusableResult.error = null;
    this.reusableResult.navigationOccurred = false;
    return this.reusableResult;
  }

  async executeScript(scriptCode) {
    if (this.isShuttingDown) {
      const result = this._resetResult();
      result.error = 'Executor is shutting down';
      return result;
    }

    if (!this.isInitialized) {
      const result = this._resetResult();
      result.error = 'Lua VM is not initialized';
      return result;
    }

    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.logger(
        'error',
        `[CavebotLuaExecutor] Circuit breaker triggered: ${this.consecutiveErrors} consecutive errors. Refusing execution.`,
      );
      const result = this._resetResult();
      result.error = 'Too many consecutive errors, execution disabled';
      return result;
    }

    if (!scriptCode?.trim()) {
      const result = this._resetResult();
      result.success = true;
      return result;
    }

    const execStart = performance.now();
    this.logger('debug', '[CavebotLuaExecutor] Executing script...');
    this.navigationOccurred = false;

    try {
      // Now only syncs the dynamic state, not the whole API
      await this._syncDynamicStateToLua();

      let processedCode;
      try {
        processedCode = preprocessLuaScript(
          scriptCode,
          this.asyncFunctionNames,
        );
      } catch (preprocessError) {
        throw new Error(
          `Script preprocessing failed: ${preprocessError.message}`,
        );
      }

      await this.lua.doString(processedCode);

      // NEW: Wait for any pending async operations triggered by the script to complete
      const asyncWaitStart = performance.now();
      while (this.context.activeAsyncOperations > 0) {
        if (performance.now() - asyncWaitStart > 60000) {
          // 60-second timeout
          this.logger(
            'error',
            `[CavebotLuaExecutor] Timeout waiting for ${this.context.activeAsyncOperations} async operations to complete.`,
          );
          this.context.activeAsyncOperations = 0; // Reset to prevent infinite loop
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10)); // Poll every 10ms
      }

      const execTime = performance.now() - execStart;
      this.executionCount++;
      this.totalExecutionTime += execTime;

      if (execTime > 100) {
        this.logger(
          'warn',
          `[CavebotLuaExecutor] Slow script execution: ${execTime.toFixed(2)}ms`,
        );
      }

      this.consecutiveErrors = 0;
      const result = this._resetResult();
      result.success = true;
      result.navigationOccurred = this.navigationOccurred;
      this._logPerformanceStats();
      return result;
    } catch (error) {
      const execTime = performance.now() - execStart;
      this.executionCount++;
      this.totalExecutionTime += execTime;
      this.consecutiveErrors++;

      const errorMessage = error.message || String(error);
      this.logger(
        'error',
        `[CavebotLuaExecutor] Script execution failed (attempt ${this.consecutiveErrors}): ${errorMessage}`,
      );

      try {
        const currentState = this.context.getState();
        const scriptId = currentState?.cavebot?.wptId;

        if (scriptId) {
          this.context.postStoreUpdate('cavebot/addWaypointLogEntry', {
            id: scriptId,
            message: `[ERROR] ${errorMessage}`,
          });
        }
      } catch (storeError) {
        this.logger(
          'error',
          '[CavebotLuaExecutor] Failed to log error to store:',
          storeError,
        );
      }

      const result = this._resetResult();
      result.error = errorMessage;
      result.navigationOccurred = this.navigationOccurred;
      this._logPerformanceStats();
      return result;
    }
  }

  reset() {
    this.consecutiveErrors = 0;
    this.logger('info', '[CavebotLuaExecutor] Error state reset.');
  }

  getMetrics() {
    return {
      isInitialized: this.isInitialized,
      isShuttingDown: this.isShuttingDown,
      executionCount: this.executionCount,
      avgExecutionTime:
        this.executionCount > 0
          ? this.totalExecutionTime / this.executionCount
          : 0,
      consecutiveErrors: this.consecutiveErrors,
      circuitBreakerTripped:
        this.consecutiveErrors >= this.maxConsecutiveErrors,
    };
  }

  destroy() {
    this.logger('info', '[CavebotLuaExecutor] Starting graceful shutdown...');
    this.isShuttingDown = true;

    if (this.lua) {
      try {
        if (this.executionCount > 0) {
          const avgTime = (
            this.totalExecutionTime / this.executionCount
          ).toFixed(2);
          this.logger(
            'info',
            `[CavebotLuaExecutor] Final stats - Executions: ${this.executionCount}, Avg time: ${avgTime}ms`,
          );
        }

        this.lua.global.close();
        this.lua = null;
        this.isInitialized = false;

        this.logger(
          'info',
          '[CavebotLuaExecutor] Lua VM destroyed successfully.',
        );
      } catch (error) {
        this.logger(
          'error',
          '[CavebotLuaExecutor] Error during cleanup:',
          error,
        );
      }
    }

    this.context = null;
    this.asyncFunctionNames = [];
  }
}
