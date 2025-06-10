import { parentPort, workerData } from 'worker_threads';
import { LuaFactory } from 'wasmoon';
import { getRandomNumber } from '../utils/getRandomNumber.js'; // Assuming path is correct
import { wait } from './exposedLuaFunctions.js';

let lua;
const runningPersistentScripts = new Map();
let gameState = {};

const SNIPPET_SCRIPT_ID = 'script-snippet';

function exposeGameStateToLua(luaInstance) {
    if (!luaInstance) return;
    for (const key in gameState) {
      if (Object.hasOwnProperty.call(gameState, key)) {
        const value = gameState[key];
        luaInstance.global.set(key, (value === null || value === undefined) ? luaInstance.nil : value);
      }
    }
  }

async function initializeLuaVM() {
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();

    lua.global.set('print', (...messages) => {
        const message = messages.map(String).join(' ');
        const scriptId = lua.currentScriptId || 'unknown';
        parentPort.postMessage({ type: 'luaPrint', scriptId, message });
    });


    lua.global.set('wait', wait);

    
    exposeGameStateToLua(lua); 

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
    exposeGameStateToLua(lua);
    lua.currentScriptId = scriptId;
    const results = await lua.doString(scriptCode);
    parentPort.postMessage({ type: 'scriptResult', success: true, scriptId, results });
    return results;
  } catch (error) {
    console.error(`[Lua VM Worker] Error executing script: ${scriptId}`, error);
    parentPort.postMessage({ type: 'scriptError', success: false, scriptId, error: error.message });
    if (scriptId !== SNIPPET_SCRIPT_ID && runningPersistentScripts.has(scriptId)) {
         console.warn(`[Lua VM Worker] Stopping loop for persistent script ${scriptId} due to execution error.`);
         stopPersistentScriptExecution(scriptId);
    }
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
     if (runningPersistentScripts.has(script.id)) {
         const currentTask = runningPersistentScripts.get(script.id);
         if (currentTask.script.loopMin !== script.loopMin || currentTask.script.loopMax !== script.loopMax || currentTask.script.code !== script.code) {
              console.log(`[Lua VM Worker] Persistent script ${script.id} settings or code updated. Restarting loop.`);
              stopPersistentScriptExecution(script.id);
         } else {
              return;
         }
     }

    console.log(`[Lua VM Worker] Starting execution loop for persistent script: ${script.id}`);
    parentPort.postMessage({ type: 'luaStatusUpdate', scriptId: script.id, message: '[Status] Started looping execution.' });


    const executeAndLoop = async () => {
        runningPersistentScripts.set(script.id, { script });

        await executeLuaScript(script.id, script.code);

        if (runningPersistentScripts.has(script.id)) {
             const task = runningPersistentScripts.get(script.id);
             const minDelay = task.script.loopMin !== undefined ? task.script.loopMin : 100;
             const maxDelay = task.script.loopMax !== undefined ? task.script.loopMax : 200;
             const delay = getRandomNumber(minDelay, maxDelay);
            
             const timeoutId = setTimeout(executeAndLoop, delay);
             task.timeoutId = timeoutId; // Store the new timeout ID
             runningPersistentScripts.set(script.id, task); // Update the map entry
        } else {
             // console.log(`[Lua VM Worker] Persistent script ${script.id} disabled, stopping loop.`); // Mute internal log
             // Message already sent when stopped via updatePersistentScripts handler
        }
    };

   
    executeAndLoop().catch(err => {
        console.error(`[Lua VM Worker] Unhandled error in persistent script loop for ${script.id}:`, err);
         parentPort.postMessage({ type: 'luaStatusUpdate', scriptId: script.id, message: `[Status] Unhandled error in loop: ${err.message}` });
        stopPersistentScriptExecution(script.id);
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
      await executeLuaScript(scriptId, code);
    } else {
       console.warn('[Lua VM Worker] Received executeScript message without scriptId or code.');
       parentPort.postMessage({ type: 'scriptError', success: false, error: 'No scriptId or code provided for execution.' });
    }
  } else if (message.type === 'updatePersistentScripts') {
      const newEnabledScripts = message.scripts || [];
      if (newEnabledScripts.length > 0 || runningPersistentScripts.size > 0) { 
          console.log('[Lua VM Worker] Received update for enabled persistent scripts. Current enabled:', newEnabledScripts.map(s => s.id), 'Currently running:', Array.from(runningPersistentScripts.keys()));
      } else {
         // console.log('[Lua VM Worker] Received update: No persistent scripts enabled or running.'); // Mute if no relevant change
      }

      const newEnabledMap = new Map(newEnabledScripts.map(script => [script.id, script]));

      for (const [scriptId, task] of runningPersistentScripts.entries()) {
          if (!newEnabledMap.has(scriptId)) {
              stopPersistentScriptExecution(scriptId);
          }
      }

      
      for (const script of newEnabledScripts) {
          if (!runningPersistentScripts.has(script.id)) {
              startPersistentScriptExecution(script); 
          } else {
               const currentTask = runningPersistentScripts.get(script.id);
               const scriptDetailsChanged =
                   currentTask.script.loopMin !== script.loopMin ||
                   currentTask.script.loopMax !== script.loopMax ||
                   currentTask.script.code !== script.code;

               if (scriptDetailsChanged) {
                   
                    startPersistentScriptExecution(script);
               } else {
                  // console.log(`[Lua VM Worker] Persistent script ${script.id} already running with same settings.`); // Mute internal log
               }
          }
      }

  } else if (message.type === 'stateUpdate') {
      gameState = message.state?.gameState || {};
       if (lua) {
            exposeGameStateToLua(lua);
       }
  } else if (message.type === 'initialState') {
      gameState = message.state?.gameState || {};
       if (lua) {
           exposeGameStateToLua(lua);
           console.log('[Lua VM Worker] Set initial gameState and exposed to Lua.');
       }
       const initialEnabledScripts = message.state?.lua?.persistentScripts.filter(script => script.enabled)
           .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax })) || [];
       console.log('[Lua VM Worker] Received initial state. Enabled scripts:', initialEnabledScripts.map(s => s.id));

       initialEnabledScripts.forEach(script => startPersistentScriptExecution(script));

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