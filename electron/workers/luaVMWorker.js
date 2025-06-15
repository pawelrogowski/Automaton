import { parentPort, workerData } from 'worker_threads';
import { LuaFactory } from 'wasmoon';
import { getRandomNumber } from '../utils/getRandomNumber.js';
import { wait } from './exposedLuaFunctions.js';
import { keyPress } from '../keyboardControll/keyPress.js';

let lua;
let currentState = {};
const runningPersistentScripts = new Map();
// Removed isReadyForScriptExecution flag

// Reverted to exposing only gameState properties directly to Lua globals.
// Other state slices are accessed via currentState in JS code (e.g., keyPress wrapper).
function exposeGameStateToLua(luaInstance) {
  if (!luaInstance || !currentState.gameState) return; // Ensure gameState exists in currentState
  for (const key in currentState.gameState) {
    if (Object.hasOwnProperty.call(currentState.gameState, key)) {
      const value = currentState.gameState[key];
      luaInstance.global.set(key, (value === null || value === undefined) ? luaInstance.nil : value);
    }
  }
}

const playAlert = () => {
  console.log("sending play_alert message")
  parentPort.postMessage({ type: 'play_alert' });
}

/**
 * Pre-processes a Lua script string to automatically append :await() to 'wait(args)' calls.
 * @param {string} scriptCode The original Lua script string.
 * @returns {string} The processed Lua script string.\n */
function preprocessLuaScript(scriptCode) {
  // This regex looks for 'wait' as a whole word (\bwait\b), followed by any whitespace (\s*),
  // an opening parenthesis \(, any characters that are not a closing parenthesis ([^)]*),
  // and then a closing parenthesis \).
  // The 'g' flag ensures all occurrences are replaced.
  // '$&' in the replacement string refers to the entire matched text.
  const processedCode = scriptCode.replace(/\bwait\s*\([^)]*\)/g, '$&:await()');

  // Optional: Log the transformation for debugging
  // if (scriptCode !== processedCode) {
  //   console.log(`[Lua VM Worker] Original script:\\n${scriptCode}`);
  //   console.log(`[Lua VM Worker] Processed script (with :await()):\\n${processedCode}`);
  // }

  return processedCode;
}

async function initializeLuaVM() {
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();

    // Ensure print and other core exposed functions are set correctly here during init
    lua.global.set('print', (...messages) => {
      const message = messages.map(String).join(' ');
      const scriptId = lua.currentScriptId || 'unknown';
      parentPort.postMessage({ type: 'luaPrint', scriptId, message });
    });

    lua.global.set('keyPress', (key, rule) => {
      // Access windowId from the currentState.global slice, which is updated by message handler
      const windowId = currentState?.global?.windowId;
      if (windowId === undefined || windowId === null) {
        // Throw an error if windowId is missing when keyPress is called
        console.error('[Lua VM Worker] keyPress wrapper called without windowId in state.');
        throw new Error('Window ID not available for keyPress.');
      }
      keyPress(String(windowId), key, rule);
    });

    // Add a new function to simulate typing text character by character
    lua.global.set('type', async (text) => {
      if (typeof text !== 'string') {
        console.error('[Lua VM Worker] type function requires a string argument.');
        throw new Error('type function requires a string argument.');
      }
      const windowId = currentState?.global?.windowId;
      if (windowId === undefined || windowId === null) {
        console.error('[Lua VM Worker] type wrapper called without windowId in state.');
        throw new Error('Window ID not available for type.');
      }
      for (const char of text) {
        let keyToSend = char;
        // Handle space character specifically
        if (char === ' ') {
          keyToSend = 'space'; // Use the key name 'space'
        }
        // Note: More complex characters (like Shift+key for uppercase, symbols)
        // would require a more comprehensive mapping here depending on the keypress library.
        keyPress(String(windowId), keyToSend, {});
        // Add a small delay between key presses to simulate typing speed
        await wait(50); // Adjust delay as needed
      }
    });


    lua.global.set('wait', wait);
    lua.global.set('alert', playAlert);

    console.log('[Lua VM Worker] Lua VM initialized successfully.');
  } catch (error) {
    console.error('[Lua VM Worker] Error initializing Lua VM:', error);
    throw error;
  }
}

async function executeLuaScript(scriptId, scriptCode) {
  if (!lua) {
    console.error('[Lua VM Worker] Lua VM not initialized.');
    parentPort.postMessage({ type: 'scriptError', success: false, scriptId, error: 'Lua VM not initialized.' });
    return null;
  }

  try {
    // Expose only the gameState slice to Lua globals before execution
    exposeGameStateToLua(lua);
    lua.currentScriptId = scriptId;
    const results = await lua.doString(preprocessLuaScript(scriptCode));
    parentPort.postMessage({ type: 'scriptResult', success: true, scriptId, results });
    return results;
  } catch (error) {
    console.error(`[Lua VM Worker] Error executing script: ${scriptId}`, error);
    parentPort.postMessage({ type: 'scriptError', success: false, scriptId, error: error.message });
    console.warn(`[Lua VM Worker] Stopping loop for persistent script ${scriptId} due to execution error.`);
    stopPersistentScriptExecution(scriptId);
    return null;
  } finally {
    lua.currentScriptId = null;
  }
}

async function startPersistentScriptExecution(script) {
  if (!script || !script.id || !script.code) {
    console.error('[Lua VM Worker] Invalid script provided to startPersistentScriptExecution.');
    return;
  }

  // Only start persistent scripts if windowId is available.
  const windowId = currentState?.global?.windowId;
  if (windowId === undefined || windowId === null) {
    console.warn(`[Lua VM Worker] Cannot start persistent script ${script.id}: Window ID not available. Delaying start.`);
    return; // Do not start the loop if windowId is not available
  }


  if (runningPersistentScripts.has(script.id)) {
    const currentTask = runningPersistentScripts.get(script.id);
    if (currentTask.script.loopMin !== script.loopMin || currentTask.script.loopMax !== script.loopMax || currentTask.script.code !== script.code) {
      console.log(`[Lua VM Worker] Persistent script ${script.id} settings or code updated. Restarting loop.`);
      stopPersistentScriptExecution(script.id);
    } else {
      return; // Script is already running with the same config
    }
  }

  console.log(`[Lua VM Worker] Starting execution loop for persistent script: ${script.id}`);
  parentPort.postMessage({ type: 'luaStatusUpdate', scriptId: script.id, message: '[Status] Started looping execution.' });


  const executeAndLoop = async () => {
    const scriptConfig = currentState?.lua?.persistentScripts?.find(s => s.id === script.id);
    if (!scriptConfig?.enabled) {
      console.log(`[Lua VM Worker] Persistent script ${script.id} is no longer enabled, stopping loop.`);
      stopPersistentScriptExecution(script.id);
      return;
    }

    runningPersistentScripts.set(script.id, { script });

    // executeLuaScript will handle errors from keyPress if windowId becomes unavailable later
    await executeLuaScript(script.id, script.code);

    if (runningPersistentScripts.has(script.id)) {
      const task = runningPersistentScripts.get(script.id);
      const minDelay = task.script.loopMin !== undefined ? task.script.loopMin : 100;
      const maxDelay = task.script.loopMax !== undefined ? task.script.loopMax : 200;
      const delay = getRandomNumber(minDelay, maxDelay);

      const timeoutId = setTimeout(executeAndLoop, delay);
      task.timeoutId = timeoutId;
      runningPersistentScripts.set(script.id, task);
    } else {
      // Loop was stopped externally
    }
  };


  executeAndLoop().catch(err => {
    console.error(`[Lua VM Worker] Unhandled error in persistent script loop for ${script.id}:`, err);
    parentPort.postMessage({ type: 'luaStatusUpdate', scriptId: script.id, message: `[Status] Unhandled error in loop: ${err.message}` });
    stopPersistentScriptExecution(scriptId);
  });
}


function stopPersistentScriptExecution(scriptId) {
  const task = runningPersistentScripts.get(scriptId);
  if (task) {
    console.log(`[Lua VM Worker] Stopping execution loop for persistent script: ${scriptId}`);
    clearTimeout(task.timeoutId);
    runningPersistentScripts.delete(scriptId);
    parentPort.postMessage({ type: 'luaStatusUpdate', scriptId: scriptId, message: '[Status] Stopped looping execution.' });
  }
}



initializeLuaVM().catch(err => {
  console.error('[Lua VM Worker] Unhandled initialization error:', err);
  process.exit(1);
});

parentPort.on('message', async (message) => {
  if (message.type === 'executeScript') {
    const { scriptId, code } = message;
    if (scriptId && code !== undefined) {
      // Allow execution of ad-hoc scripts regardless of windowId availability.
      // Errors related to missing windowId will now occur within the script execution
      // when a function like keyPress is called, and will be caught by the executeLuaScript try/catch.
      await executeLuaScript(scriptId, code);

    } else {
      console.warn('[Lua VM Worker] Received executeScript message without scriptId or code.');
      parentPort.postMessage({ type: 'scriptError', success: false, error: 'No scriptId or code provided for execution.' });
    }
  } else if (message.type === 'stateUpdate' || message.type === 'initialState') {
    const newState = message.state || {};
    const oldWindowId = currentState?.global?.windowId;
    const newWindowId = newState?.global?.windowId;

    // Always update state and expose it to Lua.
    currentState = newState;
    if (lua) {
      // Expose only the gameState slice to Lua globals on state update/initialization
      exposeGameStateToLua(lua);
    }


    if (message.type === 'initialState') {
      console.log('[Lua VM Worker] Set initial currentState and exposed gameState to Lua.');
      // Start persistent scripts based on the initial state if windowId is present
      if (newWindowId) {
        const initialEnabledScripts = currentState?.lua?.persistentScripts.filter(script => script.enabled)
          .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax })) || [];
        console.log('[Lua VM Worker] Received initial state with window ID. Enabled scripts:', initialEnabledScripts.map(s => s.id));
        // startPersistentScriptExecution now checks for windowId internally before starting the loop
        initialEnabledScripts.forEach(script => startPersistentScriptExecution(script));


      } else {
        console.log('[Lua VM Worker] Received initial state, but window ID is not available. Persistent scripts will not start.');
      }

    } else if (message.type === 'stateUpdate') {
      if (newWindowId && !oldWindowId) {
        // Window ID becomes available
        console.log('[Lua VM Worker] Window ID became available. Re-evaluating persistent scripts.');
        // Re-evaluate persistent scripts to start them if enabled
        const currentEnabledScripts = currentState?.lua?.persistentScripts.filter(script => script.enabled)
          .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax })) || [];
        console.log(`[Lua VM Worker] Window ID updated from ${oldWindowId} to ${newWindowId}. Re-evaluating persistent scripts.`);
        // startPersistentScriptExecution now checks for windowId internally before starting the loop
        currentEnabledScripts.forEach(script => startPersistentScriptExecution(script));


      } else if (!newWindowId && oldWindowId) {
        // Window ID becomes unavailable
        console.log(`[Lua VM Worker] Window ID ${oldWindowId} is no longer available. Stopping persistent scripts.`);
        const runningScriptIds = Array.from(runningPersistentScripts.keys());
        runningScriptIds.forEach(scriptId => stopPersistentScriptExecution(scriptId));
      } else if (newWindowId && oldWindowId && newWindowId !== oldWindowId) {
        // Window ID changes (less likely but possible)
        console.log(`[Lua VM Worker] Window ID changed from ${oldWindowId} to ${newWindowId}. Re-evaluating persistent scripts.`);
        const currentEnabledScripts = currentState?.lua?.persistentScripts.filter(script => script.enabled)
          .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax })) || [];
        currentEnabledScripts.forEach(script => startPersistentScriptExecution(script));
      }
      // If windowId is still available and hasn't changed, the state update is handled by exposing currentState.
    }
  } else if (message.type === 'luaStatusUpdate') {

  }

});


parentPort.on('close', () => {
  console.log('[Lua VM Worker] Worker closing. Clearing timeouts.');
  for (const task of runningPersistentScripts.values()) {
    clearTimeout(task.timeoutId);
  }
  runningPersistentScripts.clear();
  if (lua) {
    lua.close();
    lua = null;
  }
});