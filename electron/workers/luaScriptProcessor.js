/**
 * @fileoverview Centralized processor for preparing Lua scripts for execution.
 * This module contains utility functions for manipulating Lua script code before
 * it is run by the wasmoon engine.
 */

/**
 * Preprocesses Lua script code to enable awaiting Promises for synchronous-style functions.
 * It dynamically adds `:await()` to function calls found in the `asyncFunctionNames` list,
 * allowing for a more seamless integration between async JavaScript and sync Lua.
 *
 * @param {string} scriptCode - The raw Lua script to preprocess.
 * @param {string[]} asyncFunctionNames - A list of function names that are asynchronous and return Promises.
 * @returns {string} The processed script with `:await()` appended to the appropriate function calls.
 */
export function preprocessLuaScript(scriptCode, asyncFunctionNames) {
  if (!asyncFunctionNames || asyncFunctionNames.length === 0) {
    return scriptCode;
  }

  // Build a dynamic regex to match any of the specified async function names.
  // This will look for a whole word boundary `\b`, one of the function names,
  // followed by optional whitespace and parentheses.
  // Example regex for ['wait', 'fetchData']: /\b(wait|fetchData)\s*\([^)]*\)/g
  const funcNamePattern = asyncFunctionNames.join('|');
  const regex = new RegExp(`\\b(${funcNamePattern})\\s*\\([^)]*\\)`, 'g');

  return scriptCode.replace(regex, (match) => {
    // To prevent redundant additions, check if the function call already ends with ':await()'.
    // This makes the pre-processing step idempotent.
    if (match.endsWith(':await()')) {
      return match;
    }
    // Append the await call to the matched function string.
    return `${match}:await()`;
  });
}
