import { parentPort, workerData, threadId } from 'worker_threads';
import { performance } from 'perf_hooks';
import { appendFile } from 'fs/promises';
import path from 'path';
import { LuaFactory } from 'wasmoon';
import { createLogger } from '../utils/logger.js';
import { createLuaApi } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

// --- Worker Configuration ---
const { enableMemoryLogging = false } = workerData;

// --- Memory Usage Logging (Conditional) ---
const LOG_INTERVAL_MS = 10000; // 10 seconds
const LOG_FILE_NAME = `lua-script-worker-${threadId}-memory-usage.log`;
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME);
let lastLogTime = 0;

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function logMemoryUsage() {
  try {
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();
    const logEntry =
      `${timestamp} | ` +
      `RSS: ${toMB(memoryUsage.rss)} MB, ` +
      `HeapTotal: ${toMB(memoryUsage.heapTotal)} MB, ` +
      `HeapUsed: ${toMB(memoryUsage.heapUsed)} MB, ` +
      `External: ${toMB(memoryUsage.external)} MB\n`;

    await appendFile(LOG_FILE_PATH, logEntry);
  } catch (error) {
    console.error(`[MemoryLogger][Thread ${threadId}] Failed to write to memory log file:`, error);
  }
}
// --- End of Memory Usage Logging ---

const log = createLogger();

let lua;
let currentState = {};
let scriptConfig = {};
let loopInterval = null;
let asyncFunctionNames = [];
let keepAliveInterval = null;

// --- Keep Alive Function ---
function keepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    // This empty interval prevents the worker from exiting when idle.
  }, 60 * 60 * 1000); // Run once per hour
}

async function initializeLuaVM() {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing Lua VM...`);
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();
    log('info', `[Lua Script Worker ${scriptConfig.id}] Lua VM initialized successfully.`);
  } catch (error) {
    log('error', `[Lua Script Worker ${scriptConfig.id}] Error initializing Lua VM:`, error);
    throw error;
  }
}

function exposeGameStateToLua(luaInstance) {
  if (!luaInstance || !currentState.gameState) return;
  for (const key in currentState.gameState) {
    if (Object.hasOwnProperty.call(currentState.gameState, key)) {
      const value = currentState.gameState[key];
      luaInstance.global.set(key, value === null || value === undefined ? luaInstance.nil : value);
    }
  }
}

function updateLuaApiGlobals() {
  if (!lua) return;
  const { api, asyncFunctionNames: newAsyncNames } = createLuaApi({
    type: 'script',
    getState: () => currentState,
    postSystemMessage: (message) => parentPort.postMessage(message),
    logger: log,
    id: scriptConfig.id,
  });
  asyncFunctionNames = newAsyncNames;
  for (const funcName in api) {
    if (Object.hasOwnProperty.call(api, funcName)) {
      lua.global.set(funcName, api[funcName]);
    }
  }
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Lua API globals updated with latest state.`);
}

// --- [NEW] --- Logic for one-shot execution (for Cavebot Actions)
async function executeOneShot() {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Executing one-shot script.`);
  if (!lua || !scriptConfig.code || !scriptConfig.code.trim()) {
    parentPort.postMessage({
      type: 'scriptExecutionResult',
      id: scriptConfig.id,
      success: false,
      error: 'No script code provided or Lua VM not ready.',
    });
    return;
  }

  try {
    // Ensure the latest state is available to the script
    exposeGameStateToLua(lua);
    updateLuaApiGlobals();
    await lua.doString(preprocessLuaScript(scriptConfig.code, asyncFunctionNames));
    // Report success back to the workerManager
    parentPort.postMessage({ type: 'scriptExecutionResult', id: scriptConfig.id, success: true });
  } catch (error) {
    const errorMessage = error.message || String(error);
    log('error', `[Lua Script Worker ${scriptConfig.id}] Error executing one-shot script:`, errorMessage);
    // Report failure back to the workerManager
    parentPort.postMessage({ type: 'scriptExecutionResult', id: scriptConfig.id, success: false, error: errorMessage });
  }
}

// --- Logic for persistent script execution (existing)
async function executeScriptLoop() {
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Entering executeScriptLoop. Script enabled: ${scriptConfig.enabled}`);
  if (!lua || !scriptConfig.enabled) {
    log('debug', `[Lua Script Worker ${scriptConfig.id}] Lua VM not initialized or script not enabled. Stopping loop.`);
    stopScriptLoop();
    return;
  }

  if (!scriptConfig.code.trim()) {
    log('debug', `[Lua Script Worker ${scriptConfig.id}] Script code is empty. Skipping execution for this iteration.`);
  } else {
    log('info', `[Lua Script Worker ${scriptConfig.id}] Executing script code.`);
    try {
      exposeGameStateToLua(lua);
      await lua.doString(preprocessLuaScript(scriptConfig.code, asyncFunctionNames));
      parentPort.postMessage({ type: 'scriptResult', success: true, scriptId: scriptConfig.id });
    } catch (error) {
      log('error', `[Lua Script Worker ${scriptConfig.id}] Error executing script:`, error);
      parentPort.postMessage({ type: 'scriptError', success: false, scriptId: scriptConfig.id, error: error.message });
    }
  }

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
  executeScriptLoop();
}

function stopScriptLoop() {
  if (loopInterval) {
    log('info', `[Lua Script Worker ${scriptConfig.id}] Stopping script loop.`);
    clearTimeout(loopInterval);
    loopInterval = null;
  }
}

// --- [MODIFIED] --- The main message handler now decides the execution path
parentPort.on('message', async (message) => {
  // --- Integrated Memory Logging Check ---
  const now = performance.now();
  if (enableMemoryLogging && now - lastLogTime > LOG_INTERVAL_MS) {
    await logMemoryUsage();
    lastLogTime = now;
  }
  // --- End of Integrated Memory Logging Check ---

  if (message.type === 'init') {
    scriptConfig = message.script;
    log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing with config:`, scriptConfig);
    await initializeLuaVM();
    updateLuaApiGlobals(); // Initial update

    // Check the script type to decide what to do
    if (scriptConfig.type === 'oneshot') {
      // This is a cavebot action script. Execute it once and report back.
      await executeOneShot();
    } else {
      // This is a persistent or hotkey script. Start the loop if enabled.
      if (scriptConfig.enabled) {
        startScriptLoop();
      }
      // Keep the worker alive
      keepAlive();
    }
  } else if (message.type === 'update') {
    scriptConfig = message.script;
    if (scriptConfig.enabled) {
      startScriptLoop();
    } else {
      stopScriptLoop();
    }
  } else {
    // For all other messages, it's a state update.
    currentState = message;
    if (lua) {
      // Keep the Lua environment's globals in sync with the app state.
      exposeGameStateToLua(lua);
      updateLuaApiGlobals();
    }
  }
});

parentPort.on('close', () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Worker closing.`);
  stopScriptLoop();
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  if (lua) {
    lua.close();
    lua = null;
  }
});

// --- Worker Initialization ---
(async () => {
  if (enableMemoryLogging) {
    try {
      const header = `\n--- New Session Started at ${new Date().toISOString()} for Thread ${threadId} ---\n`;
      await appendFile(LOG_FILE_PATH, header);
      log('info', `[MemoryLogger][Thread ${threadId}] Memory usage logging is active. Outputting to ${LOG_FILE_PATH}`);
      lastLogTime = performance.now();
      await logMemoryUsage();
    } catch (error) {
      log('error', `[MemoryLogger][Thread ${threadId}] Could not initialize memory log file:`, error);
    }
  }
})();