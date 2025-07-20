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
    log('info', `[Lua Script Worker ${scriptConfig.id}] Lua VM initialized successfully.`);
  } catch (error) {
    log('error', `[Lua Script Worker ${scriptConfig.id}] Error initializing Lua VM:`, error);
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
  });

  asyncFunctionNames = newAsyncNames;
  for (const funcName in api) {
    lua.global.set(funcName, api[funcName]);
  }

  lua.global.set('__BOT_STATE__', stateObject);
  log('debug', `[Lua Script Worker ${scriptConfig.id}] Lua API and state variables synced.`);
};

const executeOneShot = async () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Executing one-shot script.`);
  if (!lua || !scriptConfig.code?.trim()) {
    const errorMsg = 'No script code provided or Lua VM not ready.';
    postStoreUpdate('lua/addLogEntry', { id: scriptConfig.id, message: `[ERROR] ${errorMsg}` });
    return;
  }
  try {
    _syncApiToLua();
    await lua.doString(preprocessLuaScript(scriptConfig.code, asyncFunctionNames));
  } catch (error) {
    const errorMessage = error.message || String(error);
    log('error', `[Lua Script Worker ${scriptConfig.id}] Error executing one-shot script:`, errorMessage);
    // --- MODIFICATION: Use postStoreUpdate to log the error to the UI ---
    postStoreUpdate('lua/addLogEntry', { id: scriptConfig.id, message: `[ERROR] ${errorMessage}` });
  }
};

const executeScriptLoop = async () => {
  if (!lua || !scriptConfig.enabled) {
    stopScriptLoop();
    return;
  }
  if (!scriptConfig.code?.trim()) {
    log('debug', `[Lua Script Worker ${scriptConfig.id}] Script code is empty. Skipping.`);
  } else {
    log('info', `[Lua Script Worker ${scriptConfig.id}] Executing script loop.`);
    try {
      _syncApiToLua();
      await lua.doString(preprocessLuaScript(scriptConfig.code, asyncFunctionNames));
    } catch (error) {
      const errorMessage = error.message || String(error);
      log('error', `[Lua Script Worker ${scriptConfig.id}] Error in script loop:`, errorMessage);
      // --- MODIFICATION: Use postStoreUpdate to log the error to the UI ---
      postStoreUpdate('lua/addLogEntry', { id: scriptConfig.id, message: `[ERROR] ${errorMessage}` });
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

parentPort.on('message', async (message) => {
  if (message.type === 'init') {
    scriptConfig = message.script;
    log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing with config:`, scriptConfig);
    await initializeLuaVM();
    _syncApiToLua();

    if (scriptConfig.type === 'oneshot') {
      await executeOneShot();
    } else {
      if (scriptConfig.enabled) startScriptLoop();
      keepAlive();
    }
  } else if (message.type === 'update') {
    scriptConfig = message.script;
    if (scriptConfig.enabled) startScriptLoop();
    else stopScriptLoop();
  } else {
    currentState = message;
  }
});

parentPort.on('close', () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Worker closing.`);
  stopScriptLoop();
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  if (lua) lua.close();
});

(async () => {
  // Worker initialization complete
})();
