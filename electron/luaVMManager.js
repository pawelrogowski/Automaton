
let lua;

async function initializeLuaVM() {
  try {
    const factory = new LuaFactory();
    lua = await factory.createEngine();
    console.log('Lua VM initialized successfully.');
  } catch (error) {
    console.error('Error initializing Lua VM:', error);
    // Decide on error handling: exit or report? For now, log and allow app to continue.
    // process.exit(1);
  }
}

async function executeLuaScript(script) {
  if (!lua) {
    console.error('Lua VM not initialized.');
    return null;
  }
  try {
    // Execute the script and return the result
    const result = await lua.doString(script);
    console.log('Lua script executed. Result:', result);
    return result;
  } catch (error) {
    console.error('Error executing Lua script:', error);
    return null;
  }
}

export {
  initializeLuaVM,
  executeLuaScript,
};
