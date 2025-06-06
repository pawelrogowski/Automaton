import { parentPort, workerData } from 'worker_threads';
import { LuaFactory } from 'wasmoon';

let lua;

async function initializeLuaVM() {
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();
    console.log('[Lua VM Worker] Lua VM initialized successfully.');
  } catch (error) {
    console.error('[Lua VM Worker] Error initializing Lua VM:', error);
    // In a worker, throwing an error will terminate it, which might be desired
    // or we might want to send a specific error message back.
    throw error;
  }
}

async function executeLuaScript(script) {
  if (!lua) {
    console.error('[Lua VM Worker] Lua VM not initialized.');
    // Send error back to main thread
    parentPort.postMessage({ type: 'error', message: 'Lua VM not initialized.' });
    return null;
  }
  try {
    // Execute the script and return the result
    // wasmoon's doString can return multiple values, capture them.
    const results = await lua.doString(script);
    console.log('[Lua VM Worker] Lua script executed. Results:', results);
    // Send results back to main thread
    parentPort.postMessage({ type: 'scriptResult', success: true, results });
    return results;
  } catch (error) {
    console.error('[Lua VM Worker] Error executing Lua script:', error);
    // Send error back to main thread
    parentPort.postMessage({ type: 'scriptError', success: false, error: error.message });
    return null;
  }
}

// Initialize the VM when the worker starts
initializeLuaVM().catch(err => {
    console.error('[Lua VM Worker] Unhandled initialization error:', err);
    // Terminate the worker if initialization fails
    process.exit(1);
});

// Listen for messages from the main thread
parentPort.on('message', async (message) => {
//   console.log('[Lua VM Worker] Received message:', message);
  if (message.type === 'executeScript') {
    const { script } = message;
    if (script) {
      await executeLuaScript(script);
    } else {
    //   console.warn('[Lua VM Worker] Received executeScript message without script.');
       parentPort.postMessage({ type: 'scriptError', success: false, error: 'No script provided.' });
    }
  } else {
    //   console.warn('[Lua VM Worker] Received unknown message type:', message.type);
  }
});
