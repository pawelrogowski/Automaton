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

// --- [ROBUST FIX] --- State machine to prevent shutdown during initialization.
let workerState = 'pending'; // 'pending', 'initializing', 'running'
let shutdownRequested = false;

// --- [ROBUST FIX] --- Counter for active async operations to ensure safe shutdown.
let activeAsyncOperations = 0;
const onAsyncStart = () => activeAsyncOperations++;
const onAsyncEnd = () => activeAsyncOperations--;

const postStoreUpdate = (type, payload) => {
  parentPort.postMessage({ storeUpdate: true, type, payload });
};

const keepAlive = () => {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {}, 60 * 60 * 1000);
};

const cleanupAndExit = async () => {
  log(
    'info',
    `[Lua Script Worker ${scriptConfig.id}] Cleaning up and exiting.`,
  );
  stopScriptLoop();
  if (keepAliveInterval) clearInterval(keepAliveInterval);

  // --- [ROBUST FIX] --- Wait for pending async operations to complete.
  const maxWaitTime = 5000; // 5 seconds timeout.
  const startTime = Date.now();
  while (activeAsyncOperations > 0 && Date.now() - startTime < maxWaitTime) {
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Waiting for ${activeAsyncOperations} async operations to complete...`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms before checking again.
  }

  if (activeAsyncOperations > 0) {
    log(
      'warn',
      `[Lua Script Worker ${scriptConfig.id}] Exiting with ${activeAsyncOperations} async operations still pending after timeout.`,
    );
  }

  if (lua) {
    try {
      lua.global.close();
    } catch (e) {
      log(
        'error',
        `[Lua Script Worker ${scriptConfig.id}] Error during lua.global.close(): ${e.message}`,
      );
    }
  }
  process.exit(0);
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
    refreshLuaGlobalState: refreshLuaGlobalState,
    onAsyncStart,
    onAsyncEnd,
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
  if (!lua) {
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

parentPort.on('message', async (message) => {
  if (message.type === 'shutdown') {
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Received shutdown signal.`,
    );
    shutdownRequested = true;
    if (workerState === 'running') {
      await cleanupAndExit();
    }
    return;
  }

  if (message.type === 'init') {
    workerState = 'initializing';
    scriptConfig = message.script;
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Initializing with config:`,
      scriptConfig,
    );

    await initializeLuaVM();

    // --- [ROBUST FIX] --- Check if a shutdown was requested during initialization.
    if (shutdownRequested) {
      await cleanupAndExit();
      return;
    }

    workerState = 'running';
    _syncApiToLua();

    if (scriptConfig.type === 'oneshot') {
      await executeOneShot();
    } else {
      startScriptLoop();
      keepAlive();
    }
    return;
  }

  if (message.type === 'update') {
    scriptConfig = message.script;
    return;
  }

  if (message.type === 'state_diff') {
    currentState = { ...currentState, ...message.payload };
  } else if (message.type === undefined) {
    currentState = message;
  } else {
    return;
  }

  if (workerState === 'running') {
    refreshLuaGlobalState();
  }
});

parentPort.on('close', async () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Parent port closed.`);
  await cleanupAndExit();
});

(async () => {})();
