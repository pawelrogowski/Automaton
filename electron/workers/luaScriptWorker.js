import { parentPort, workerData, threadId } from 'worker_threads';
import { LuaFactory } from 'wasmoon';
import { createLogger } from '../utils/logger.js';
import { createLuaApi } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

const log = createLogger();
let lua;
let currentState = {};
let scriptConfig = {};
let loopInterval = null;
let asyncFunctionNames = [];
let keepAliveInterval = null;

const postStoreUpdate = (type, payload) => {
  parentPort.postMessage({ storeUpdate: true, type, payload });
};

const keepAlive = () => {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {}, 60 * 60 * 1000);
};

const initializeLuaVM = async () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing Lua VM...`);
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Lua VM initialized successfully.`,
    );
  } catch (error) {
    log(
      'error',
      `[Lua Script Worker ${scriptConfig.id}] Error initializing Lua VM:`,
      error,
    );
    throw error;
  }
};

const _syncApiToLua = () => {
  if (!lua) return;

  const {
    api,
    asyncFunctionNames: newAsyncNames,
    stateObject,
  } = createLuaApi({
    type: 'script',
    getState: () => currentState,
    postSystemMessage: (message) => parentPort.postMessage(message),
    logger: log,
    id: scriptConfig.id,
    postStoreUpdate: postStoreUpdate,
    refreshLuaGlobalState: refreshLuaGlobalState, // Pass the refresh function
  });

  asyncFunctionNames = newAsyncNames;
  for (const funcName in api) {
    lua.global.set(funcName, api[funcName]);
  }

  lua.global.set('__BOT_STATE__', stateObject);
  log(
    'debug',
    `[Lua Script Worker ${scriptConfig.id}] Lua API and state variables synced.`,
  );
};

// New function to refresh the Lua global state
const refreshLuaGlobalState = () => {
  _syncApiToLua();
  log(
    'debug',
    `[Lua Script Worker ${scriptConfig.id}] Lua global state refreshed.`,
  );
};

const executeOneShot = async () => {
  log(
    'info',
    `[Lua Script Worker ${scriptConfig.id}] Executing one-shot script.`,
  );
  if (!lua || !scriptConfig.code?.trim()) {
    const errorMsg = 'No script code provided or Lua VM not ready.';
    postStoreUpdate('lua/addLogEntry', {
      id: scriptConfig.id,
      message: `[ERROR] ${errorMsg}`,
    });
    return;
  }
  try {
    _syncApiToLua();
    await lua.doString(
      preprocessLuaScript(scriptConfig.code, asyncFunctionNames),
    );
  } catch (error) {
    const errorMessage = error.message || String(error);
    log(
      'error',
      `[Lua Script Worker ${scriptConfig.id}] Error executing one-shot script:`,
      errorMessage,
    );
    postStoreUpdate('lua/addLogEntry', {
      id: scriptConfig.id,
      message: `[ERROR] ${errorMessage}`,
    });
  }
};

const executeScriptLoop = async () => {
  if (!lua || !scriptConfig.enabled) {
    stopScriptLoop();
    return;
  }
  if (!scriptConfig.code?.trim()) {
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] Script code is empty. Skipping.`,
    );
  } else {
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Executing script loop.`,
    );
    try {
      _syncApiToLua();
      await lua.doString(
        preprocessLuaScript(scriptConfig.code, asyncFunctionNames),
      );
    } catch (error) {
      const errorMessage = error.message || String(error);
      log(
        'error',
        `[Lua Script Worker ${scriptConfig.id}] Error in script loop:`,
        errorMessage,
      );
      postStoreUpdate('lua/addLogEntry', {
        id: scriptConfig.id,
        message: `[ERROR] ${errorMessage}`,
      });
    }
  }
  const min = scriptConfig.loopMin || 100;
  const max = scriptConfig.loopMax || 200;
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  loopInterval = setTimeout(executeScriptLoop, delay);
};

const startScriptLoop = () => {
  if (loopInterval) clearTimeout(loopInterval);
  log('info', `[Lua Script Worker ${scriptConfig.id}] Starting script loop.`);
  executeScriptLoop();
};

const stopScriptLoop = () => {
  if (loopInterval) {
    log('info', `[Lua Script Worker ${scriptConfig.id}] Stopping script loop.`);
    clearTimeout(loopInterval);
    loopInterval = null;
  }
};

// --- [MODIFIED] --- Updated message handler for new state management model.
parentPort.on('message', async (message) => {
  // Handle control messages first
  if (message.type === 'init') {
    scriptConfig = message.script;
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Initializing with config:`,
      scriptConfig,
    );
    await initializeLuaVM();
    _syncApiToLua(); // Initial sync

    if (scriptConfig.type === 'oneshot') {
      await executeOneShot();
    } else {
      if (scriptConfig.enabled) startScriptLoop();
      keepAlive();
    }
    return; // End processing for this message
  }

  if (message.type === 'update') {
    scriptConfig = message.script;
    if (scriptConfig.enabled) startScriptLoop();
    else stopScriptLoop();
    return; // End processing for this message
  }

  // Handle state update messages
  if (message.type === 'state_diff') {
    // Merge the incoming changed slices into the local state.
    currentState = { ...currentState, ...message.payload };
  } else if (message.type === undefined) {
    // This is the initial, full state object sent when the worker starts.
    currentState = message;
  } else {
    // Ignore other unknown message types
    return;
  }

  // After any state change, refresh the Lua global state to ensure
  // the script has access to the most up-to-date data.
  refreshLuaGlobalState();
});

parentPort.on('close', () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Worker closing.`);
  stopScriptLoop();
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  if (lua) lua.close();
});

(async () => {
  // Worker initialization is handled by the 'init' message.
})();
