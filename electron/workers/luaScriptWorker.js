// luaScriptWorker.js

import { parentPort, workerData, threadId } from 'worker_threads';
import { LuaFactory } from 'wasmoon';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import { createLuaApi } from './luaApi.js';
import { createStateShortcutObject } from './luaApi.js';
import { preprocessLuaScript } from './luaScriptProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = createLogger({ info: true, error: true, debug: false });
let lua;
let currentState = {};
let scriptConfig = {};
let loopInterval = null;
let asyncFunctionNames = [];
let keepAliveInterval = null;
let apiInitialized = false;

// --- State machine to prevent shutdown during init ---
let workerState = 'pending'; // 'pending' | 'initializing' | 'running'
let shutdownRequested = false;

// --- Active async operation counter ---
let activeAsyncOperations = 0;
const onAsyncStart = () => activeAsyncOperations++;
const onAsyncEnd = () => activeAsyncOperations--;

const getFreshState = () =>
  new Promise((res, rej) => {
    const timeout = setTimeout(() => {
      parentPort.off('message', onSnap);
      rej(new Error('Timeout waiting for state snapshot from main thread.'));
    }, 5000); // 5 second timeout

    const onSnap = (msg) => {
      if (msg.type === 'state_snapshot') {
        clearTimeout(timeout);
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

const postGlobalVarUpdate = (key, value) => {
  parentPort.postMessage({
    type: 'lua_global_update',
    payload: { key, value },
  });
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
    // Silently wait for operations to finish, checking less frequently to throttle.
    await new Promise((r) => setTimeout(r, 250));
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
        `[Lua Script Worker ${scriptConfig.id}] close error: ${e.message}`,
      );
    }
  }
  process.exit(0);
};

const loadLuaLibraries = async () => {
  if (!lua) return;
  const libPath = path.join(__dirname, 'lua', 'lib');
  try {
    const files = await fs.readdir(libPath);
    for (const file of files) {
      if (path.extname(file) === '.lua') {
        const filePath = path.join(libPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        await lua.doString(content);
        log('info', `[Lua Script Worker ${scriptConfig.id}] Loaded Lua library: ${file}`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('error', `[Lua Script Worker ${scriptConfig.id}] Error loading Lua libraries:`, error);
    } else {
      log('info', `[Lua Script Worker ${scriptConfig.id}] No Lua libraries found to load.`);
    }
  }
};

const initializeLuaVM = async () => {
  log('info', `[Lua Script Worker ${scriptConfig.id}] Initializing Lua VM…`);
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();
    await loadLuaLibraries();
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

const initializeLuaApi = async () => {
  if (!lua) {
    log(
      'warn',
      `[Lua Script Worker ${scriptConfig.id}] initializeLuaApi: Lua VM not available.`,
    );
    return;
  }
  if (apiInitialized) {
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] initializeLuaApi: API already initialized.`,
    );
    return;
  }

  try {
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] initializeLuaApi: Requesting fresh state.`,
    );
    currentState = await getFreshState();
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] initializeLuaApi: Fresh state received.`,
    );

    const { api, asyncFunctionNames: newNames } = await createLuaApi({
      type: 'script',
      getState: () => currentState,
      postSystemMessage: (m) => parentPort.postMessage(m),
      logger: log,
      id: scriptConfig.id,
      postStoreUpdate,
      postGlobalVarUpdate,
      refreshLuaGlobalState: syncDynamicStateToLua, // Pass the sync function
      onAsyncStart,
      onAsyncEnd,
      sharedLuaGlobals: workerData.sharedLuaGlobals,
      lua: lua,
    });

    asyncFunctionNames = newNames;
    for (const fn in api) {
      lua.global.set(fn, api[fn]);
    }

    apiInitialized = true;
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] initializeLuaApi: API setup complete.`,
    );
  } catch (error) {
    log(
      'error',
      `[Lua Script Worker ${scriptConfig.id}] initializeLuaApi: Error during API initialization: ${error.message}`,
      error,
    );
    throw error; // Re-throw to be caught by the init handler's try/catch
  }
};

const syncDynamicStateToLua = async () => {
  if (!lua || !apiInitialized) return;

  try {
    const freshState = await getFreshState();
    if (freshState) {
      currentState = freshState;
      const stateObject = createStateShortcutObject(
        () => currentState,
        'script',
      );
      lua.global.set('__BOT_STATE__', stateObject);
    }
  } catch (e) {
    log(
      'error',
      `[Lua Script Worker ${scriptConfig.id}] Failed to get fresh state: ${e.message}`,
    );
  }
};

const executeOneShot = async () => {
  log(
    'info',
    `[Lua Script Worker ${scriptConfig.id}] Executing one-shot script.`,
  );

  if (!lua) {
    const errorMsg = 'Lua VM not ready.';
    log(
      'error',
      `[Lua Script Worker ${scriptConfig.id}] one-shot error: ${errorMsg}`,
    );
    parentPort.postMessage({
      type: 'scriptExecutionResult',
      payload: {
        id: scriptConfig.id,
        success: false,
        error: errorMsg,
        isCavebotScript: workerData.isCavebotScript,
      },
    });
    return; // Still return if Lua VM is not ready, as API init will fail
  }

  // Initialize API even for empty scripts to ensure SharedGlobals are set up
  await initializeLuaApi();
  log(
    'debug',
    `[Lua Script Worker ${scriptConfig.id}] Lua API initialized for one-shot script.`,
  );

  if (!scriptConfig.code?.trim()) {
    const infoMsg = 'No script code provided. Script will do nothing.';
    log('info', `[Lua Script Worker ${scriptConfig.id}] one-shot: ${infoMsg}`);
    parentPort.postMessage({
      type: 'scriptExecutionResult',
      payload: {
        id: scriptConfig.id,
        success: true, // An empty script is not an error, it just does nothing.
        error: null,
        isCavebotScript: workerData.isCavebotScript,
      },
    });
    return; // Return after sending result for empty script
  }

  try {
    await syncDynamicStateToLua();
    // Log SharedGlobals.asd before execution
    const sharedAsdValue = workerData.sharedLuaGlobals.asd;
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] Lua script sees SharedGlobals.asd as: ${sharedAsdValue}`,
    );

    const processedCode = preprocessLuaScript(
      scriptConfig.code,
      asyncFunctionNames,
    );
    await lua.doString(processedCode);
    parentPort.postMessage({
      type: 'scriptExecutionResult',
      payload: {
        id: scriptConfig.id,
        success: true,
        isCavebotScript: workerData.isCavebotScript,
      },
    });
  } catch (error) {
    const msg = error.message || String(error);
    log('error', `[Lua Script Worker ${scriptConfig.id}] one-shot error:`, msg);
    postStoreUpdate('lua/addLogEntry', {
      id: scriptConfig.id,
      message: `[ERROR] ${msg}`,
    });
    parentPort.postMessage({
      type: 'scriptExecutionResult',
      payload: {
        id: scriptConfig.id,
        success: false,
        error: msg,
        isCavebotScript: workerData.isCavebotScript,
      },
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
      await syncDynamicStateToLua();
      // Log SharedGlobals.asd before execution
      const sharedAsdValue = workerData.sharedLuaGlobals.asd;
      log(
        'debug',
        `[Lua Script Worker ${scriptConfig.id}] Lua script sees SharedGlobals.asd as: ${sharedAsdValue}`,
      );

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

  if (message.type === 'lua_global_broadcast') {
    const { key, value } = message.payload;
    log(
      'debug',
      `[Lua Script Worker ${scriptConfig.id}] Received lua_global_broadcast: key=${key}, value=${value}`,
    );
    if (workerData.sharedLuaGlobals) {
      workerData.sharedLuaGlobals[key] = value;
      log(
        'debug',
        `[Lua Script Worker ${scriptConfig.id}] workerData.sharedLuaGlobals.${key} updated to: ${workerData.sharedLuaGlobals[key]}`,
      );
    }
    return;
  }

  if (message.type === 'init') {
    workerState = 'initializing';
    scriptConfig = message.script;
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Init received. Script config:`,
      scriptConfig,
    );

    await initializeLuaVM();
    if (shutdownRequested) {
      log(
        'info',
        `[Lua Script Worker ${scriptConfig.id}] Shutdown requested during initialization. Exiting.`,
      );
      await cleanupAndExit();
      return;
    }

    await initializeLuaApi();
    log('info', `[Lua Script Worker ${scriptConfig.id}] Lua API initialized.`);

    workerState = 'running';
    log(
      'info',
      `[Lua Script Worker ${scriptConfig.id}] Worker state set to running.`,
    );

    if (scriptConfig.type === 'oneshot') {
      log(
        'info',
        `[Lua Script Worker ${scriptConfig.id}] Executing one-shot script.`,
      );
      await executeOneShot();
      log(
        'info',
        `[Lua Script Worker ${scriptConfig.id}] One-shot script execution finished.`,
      );
      // For one-shot scripts, we should exit after execution
      await cleanupAndExit();
    } else {
      log(
        'info',
        `[Lua Script Worker ${scriptConfig.id}] Starting script loop.`,
      );
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
