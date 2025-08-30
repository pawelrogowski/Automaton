import { LuaFactory } from 'wasmoon';
import { parentPort } from 'worker_threads';
import { performance } from 'perf_hooks';
import { createLuaApi, createStateShortcutObject } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

export class CavebotLuaExecutor {
  /**
   * @param {object} context - The context from the cavebot worker.
   */
  constructor(context) {
    this.lua = null;
    this.logger = context.logger;
    // Ensure debug logging is enabled for this executor
    this.logger.setDebug(true);
    // Ensure debug logging is enabled for this executor
    this.logger.setDebug(true);
    this.context = context;
    this.isInitialized = false;
    this.isShuttingDown = false;

    // Performance tracking
    this.executionCount = 0;
    this.totalExecutionTime = 0;
    this.lastPerfReport = Date.now();

    // API state management
    this.asyncFunctionNames = [];
    this.navigationOccurred = false;

    // Error tracking
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 5000000;

    // Reusable objects to reduce GC pressure
    this.reusableResult = {
      success: false,
      error: null,
      navigationOccurred: false,
    };

    this.logger(
      'info',
      '[CavebotLuaExecutor] Instance created with performance monitoring.',
    );
  }

  async initialize() {
    if (this.isShuttingDown) {
      return false;
    }

    this.logger('info', '[CavebotLuaExecutor] Initializing Lua VM...');

    try {
      const initStart = performance.now();

      const factory = new LuaFactory();
      this.lua = await factory.createEngine();

      await this._syncApiToLua(true);

      const initTime = performance.now() - initStart;
      this.logger(
        'info',
        `[CavebotLuaExecutor] Lua VM initialized successfully in ${initTime.toFixed(
          2,
        )}ms.`,
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

  async _syncApiToLua(force = false) {
    if (!this.lua || this.isShuttingDown) return;

    if (force) {
      await this.context.getFreshState();
    }

    const { api, asyncFunctionNames, stateObject, sharedGlobalsProxy } =
      await createLuaApi({
        type: 'cavebot',
        ...this.context,
        postSystemMessage: (message) => {
          if (!this.isShuttingDown) {
            parentPort.postMessage(message);
          }
        },
        refreshLuaGlobalState: () => this._syncApiToLua(true),
        sharedLuaGlobals: this.context.sharedLuaGlobals, // Pass the shared JS object
        lua: this.lua, // Pass the Lua VM instance
      });

    this.asyncFunctionNames = asyncFunctionNames;

    // Log the sharedGlobalsProxy before setting it
    this.logger(
      'debug',
      `[CavebotLuaExecutor] sharedGlobalsProxy before setting: ${JSON.stringify(sharedGlobalsProxy)}`,
    );

    // Wrap navigation functions to track navigation events
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

    // Batch API sync for better performance
    const globals = this.lua.global;
    for (const funcName in wrappedApi) {
      globals.set(funcName, wrappedApi[funcName]);
    }
    globals.set('__BOT_STATE__', stateObject);
    globals.set('SharedGlobals', sharedGlobalsProxy); // NEW: Expose the shared globals proxy
  }

  _logPerformanceStats() {
    const now = Date.now();
    const timeSinceLastReport = now - this.lastPerfReport;

    if (timeSinceLastReport >= 30000) {
      // Log every 30 seconds
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

      // Reset counters
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

    // Check for circuit breaker condition
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

    // Reset navigation flag before each execution
    this.navigationOccurred = false;

    try {
      // Ensure API is synced before execution to provide up-to-date state
      await this._syncApiToLua(true);

      // Preprocess script with error handling
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

      // Execute the Lua code
      await this.lua.doString(processedCode);

      // Success case
      const execTime = performance.now() - execStart;
      this.executionCount++;
      this.totalExecutionTime += execTime;

      // Log slow executions
      if (execTime > 100) {
        this.logger(
          'warn',
          `[CavebotLuaExecutor] Slow script execution: ${execTime.toFixed(2)}ms`,
        );
      }

      // Reset error counter on success
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

      // Enhanced error logging with context
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

  /**
   * Reset the circuit breaker and error state
   */
  reset() {
    this.consecutiveErrors = 0;
    this.logger('info', '[CavebotLuaExecutor] Error state reset.');
  }

  /**
   * Get current performance metrics
   */
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

  /**
   * Graceful shutdown with cleanup
   */
  destroy() {
    this.logger('info', '[CavebotLuaExecutor] Starting graceful shutdown...');
    this.isShuttingDown = true;

    if (this.lua) {
      try {
        // Final performance report
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

    // Clear references
    this.context = null;
    this.asyncFunctionNames = [];
  }
}
