// luaScriptWorker.js  (drop-in replacement)

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

// --- State machine to prevent shutdown during init ---
let workerState = 'pending'; // 'pending' | 'initializing' | 'running'
let shutdownRequested = false;

// --- Active async operation counter ---
let activeAsyncOperations = 0;
const onAsyncStart = () => activeAsyncOperations++;
const onAsyncEnd = () => activeAsyncOperations--;

// NEW: lazy pull handle
const getFreshState = () =>
  new Promise((res) => {
    const onSnap = (msg) => {
      if (msg.type === 'state_snapshot') {
        parentPort.off('message', onSnap);
        res(msg.payload);
      }
    };
    parentPort.on('message', onSnap);
    parentPort.postMessage({ type: 'request_state_snapshot' });
  });

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

  const maxWait = 5000;
  const start = Date.now();
  while (activeAsyncOperations > 0 && Date.now() - start < maxWait) {
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Waiting for ${activeAsyncOperations} async ops…`,
    );
    await new Promise((r) => setTimeout(r, 100));
  }

  if (lua) {
    try {
      lua.global.close();
    } catch (e) {
      log(
        'error',
        `[Lua Script Worker ${scriptConfig.id}] close error: ${e.message}`,
      );
    }
  }
  process.exit(0);
};

const initializeLuaVM = async () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing Lua VM…`);
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();
    log('info', `[Lua Script Worker ${scriptConfig.id}] Lua VM ready.`);
  } catch (error) {
    log(
      'error',
      `[Lua Script Worker ${scriptConfig.id}] VM init failed:`,
      error,
    );
    throw error;
  }
};

const _syncApiToLua = async (force = false) => {
  if (!lua) return;

  if (force) {
    try {
      const freshState = await getFreshState();
      if (freshState) {
        currentState = freshState;
      }
    } catch (e) {
      log(
        'error',
        `[Lua Script Worker ${scriptConfig.id}] Failed to get fresh state: ${e.message}`,
      );
    }
  }

  const {
    api,
    asyncFunctionNames: newNames,
    stateObject,
  } = createLuaApi({
    type: 'script',
    getState: () => currentState,
    postSystemMessage: (m) => parentPort.postMessage(m),
    logger: log,
    id: scriptConfig.id,
    postStoreUpdate,
    refreshLuaGlobalState: () => _syncApiToLua(true), // Pass the force option
    onAsyncStart,
    onAsyncEnd,
  });

  asyncFunctionNames = newNames;
  for (const fn in api) {
    lua.global.set(fn, api[fn]);
  }
  lua.global.set('__BOT_STATE__', stateObject);
};

const executeOneShot = async () => {
  log(
    'info',
    `[Lua Script Worker ${scriptConfig.id}] Executing one-shot script.`,
  );
  if (!lua || !scriptConfig.code?.trim()) {
    postStoreUpdate('lua/addLogEntry', {
      id: scriptConfig.id,
      message: '[ERROR] No script code provided or Lua VM not ready.',
    });
    return;
  }
  try {
    await _syncApiToLua(true);
    const processedCode = preprocessLuaScript(
      scriptConfig.code,
      asyncFunctionNames,
    );
    console.log('About to execute Lua code:', processedCode);
    await lua.doString(processedCode);
    console.log('Lua code execution completed');
  } catch (error) {
    const msg = error.message || String(error);
    console.error('Lua execution error:', msg, error.stack);
    log('error', `[Lua Script Worker ${scriptConfig.id}] loop error:`, msg);
    postStoreUpdate('lua/addLogEntry', {
      id: scriptConfig.id,
      message: `[ERROR] ${msg}`,
    });
  }
};

const executeScriptLoop = async () => {
  if (!lua) return stopScriptLoop();
  if (!scriptConfig.code?.trim()) {
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] Script empty; skipping.`,
    );
  } else {
    try {
      await _syncApiToLua(true);
      await lua.doString(
        preprocessLuaScript(scriptConfig.code, asyncFunctionNames),
      );
    } catch (error) {
      const msg = error.message || String(error);
      log('error', `[Lua Script Worker ${scriptConfig.id}] loop error:`, msg);
      postStoreUpdate('lua/addLogEntry', {
        id: scriptConfig.id,
        message: `[ERROR] ${msg}`,
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

/* ------------ message router ------------ */
parentPort.on('message', async (message) => {
  if (message.type === 'shutdown') {
    shutdownRequested = true;
    if (workerState === 'running') await cleanupAndExit();
    return;
  }

  if (message.type === 'init') {
    workerState = 'initializing';
    scriptConfig = message.script;
    log('info', `[Lua Script Worker ${scriptConfig.id}] Init`, scriptConfig);

    await initializeLuaVM();
    if (shutdownRequested) {
      await cleanupAndExit();
      return;
    }

    workerState = 'running';
    await _syncApiToLua(true);

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

  if (message.type === 'state_snapshot') {
    currentState = message.payload;
  } else if (message.type === 'state_diff') {
    // Apply partial state updates
    if (!currentState) currentState = {};
    Object.assign(currentState, message.payload);
  }
});

parentPort.on('close', async () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Parent port closed.`);
  await cleanupAndExit();
});
