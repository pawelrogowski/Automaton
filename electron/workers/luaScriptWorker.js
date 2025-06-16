import { parentPort, workerData } from 'worker_threads';
import { LuaFactory } from 'wasmoon';
import { createLogger } from '../utils/logger.js';
import { createLuaApi } from './luaApi.js'; // Import the new API creator

const log = createLogger(); // Use default logger configuration

let lua;
let currentState = {};
let scriptConfig = {}; // To store id, code, loopMin, loopMax for this specific worker
let loopInterval = null; // To manage the persistent loop

/**
 * Pre-processes a Lua script string to automatically append :await() to 'wait(args)' calls.
 * @param {string} scriptCode The original Lua script string.
 * @returns {string} The processed Lua script string.
 */
function preprocessLuaScript(scriptCode) {
  const processedCode = scriptCode.replace(/\bwait\s*\([^)]*\)/g, '$&:await()');
  return processedCode;
}

async function initializeLuaVM() {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing Lua VM...`);
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();

    // Expose functions from the Lua API to the Lua global environment
    // This is now handled by updateLuaApiGlobals to ensure latest currentState is used
    log('info', `[Lua Script Worker ${scriptConfig.id}] Lua VM initialized successfully.`);
  } catch (error) {
    log('error', `[Lua Script Worker ${scriptConfig.id}] Error initializing Lua VM:`, error);
    throw error;
  }
}

// Reverted to exposing only gameState properties directly to Lua globals.
function exposeGameStateToLua(luaInstance) {
  if (!luaInstance || !currentState.gameState) return;
  for (const key in currentState.gameState) {
    if (Object.hasOwnProperty.call(currentState.gameState, key)) {
      const value = currentState.gameState[key];
      luaInstance.global.set(key, value === null || value === undefined ? luaInstance.nil : value);
    }
  }
}

// New function to update Lua global API functions with the latest state
function updateLuaApiGlobals() {
  if (!lua) return;
  const luaApi = createLuaApi(scriptConfig.id, currentState);
  for (const funcName in luaApi) {
    if (Object.hasOwnProperty.call(luaApi, funcName)) {
      lua.global.set(funcName, luaApi[funcName]);
    }
  }
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Lua API globals updated with latest state.`);
}

async function executeScriptLoop() {
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Entering executeScriptLoop. Script enabled: ${scriptConfig.enabled}`);
  if (!lua || !scriptConfig.enabled) {
    log('debug', `[Lua Script Worker ${scriptConfig.id}] Lua VM not initialized or script not enabled. Stopping loop.`);
    stopScriptLoop();
    return;
  }

  if (!scriptConfig.code.trim()) {
    // Check if code is empty or just whitespace
    log('debug', `[Lua Script Worker ${scriptConfig.id}] Script code is empty. Skipping execution for this iteration.`);
    // Do not stop the loop, just skip execution and proceed to delay
  } else {
    log('info', `[Lua Script Worker ${scriptConfig.id}] Executing script code.`);
    try {
      exposeGameStateToLua(lua);
      await lua.doString(preprocessLuaScript(scriptConfig.code));
      parentPort.postMessage({ type: 'scriptResult', success: true, scriptId: scriptConfig.id });
    } catch (error) {
      log('error', `[Lua Script Worker ${scriptConfig.id}] Error executing script:`, error);
      parentPort.postMessage({ type: 'scriptError', success: false, scriptId: scriptConfig.id, error: error.message });
      // Do NOT stop the loop on error; allow it to continue after the delay.
    }
  }

  // Calculate random delay
  const min = scriptConfig.loopMin || 100;
  const max = scriptConfig.loopMax || 200;
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Next loop in ${delay}ms.`);

  loopInterval = setTimeout(executeScriptLoop, delay);
}

function startScriptLoop() {
  if (loopInterval) {
    clearTimeout(loopInterval);
  }
  log('info', `[Lua Script Worker ${scriptConfig.id}] Starting script loop.`);
  executeScriptLoop(); // Start immediately
}

function stopScriptLoop() {
  if (loopInterval) {
    log('info', `[Lua Script Worker ${scriptConfig.id}] Stopping script loop.`);
    clearTimeout(loopInterval);
    loopInterval = null;
  }
}

parentPort.on('message', async (message) => {
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Received message: ${message.type}`);
  if (message.type === 'init') {
    scriptConfig = message.script;
    log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing with config:`, scriptConfig);
    await initializeLuaVM();
    updateLuaApiGlobals(); // Initial exposure of API functions
    if (scriptConfig.enabled) {
      startScriptLoop();
    }
  } else if (message.type === 'stateUpdate') {
    currentState = message.state;
    if (lua) {
      exposeGameStateToLua(lua);
      updateLuaApiGlobals(); // Update API functions with latest state
    }
  } else if (message.type === 'updateScriptConfig') {
    const oldCode = scriptConfig.code;
    const oldLoopMin = scriptConfig.loopMin;
    const oldLoopMax = scriptConfig.loopMax;
    const wasEnabled = scriptConfig.enabled; // Capture current enabled state before update

    scriptConfig = { ...scriptConfig, ...message.updates };
    log('debug', `[Lua Script Worker ${scriptConfig.id}] Received script config update:`, message.updates);

    const isNowEnabled = scriptConfig.enabled;

    // Determine if a restart is truly necessary
    const codeChanged = oldCode !== scriptConfig.code;
    const loopMinChanged = oldLoopMin !== scriptConfig.loopMin;
    const loopMaxChanged = oldLoopMax !== scriptConfig.loopMax;
    const enabledStateChangedToTrue = !wasEnabled && isNowEnabled; // Script was disabled, now enabled

    if (codeChanged || loopMinChanged || loopMaxChanged || enabledStateChangedToTrue) {
      log(
        'info',
        `[Lua Script Worker ${scriptConfig.id}] Script configuration changed (code: ${codeChanged}, loopMin: ${loopMinChanged}, loopMax: ${loopMaxChanged}, enabled: ${enabledStateChangedToTrue}), restarting loop.`,
      );
      stopScriptLoop();
      if (scriptConfig.enabled) {
        // Only start if it's currently enabled
        startScriptLoop();
      }
    } else if (wasEnabled && !isNowEnabled) {
      // Script was enabled, now disabled
      log('info', `[Lua Script Worker ${scriptConfig.id}] Script disabled, stopping loop.`);
      stopScriptLoop();
    }
    // If only logs or other non-critical properties changed, and script was already enabled, do nothing.
  } else if (message.type === 'stopScript') {
    stopScriptLoop();
  }
});

parentPort.on('close', () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Worker closing.`);
  stopScriptLoop();
  if (lua) {
    lua.close();
    lua = null;
  }
});
