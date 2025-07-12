/**
 * @fileoverview Centralized processor for preparing Lua scripts for execution.
 * This module contains utility functions for manipulating Lua script code before
 * it is run by the wasmoon engine.
 */

/**
 * Replaces convenient '$' prefixed variables with their valid, secret internal counterparts.
 * This uses a regular expression to safely replace `$var` with `__BOT_STATE__.var`
 * to avoid conflicts with user-defined variables.
 *
 * @param {string} code - The raw Lua code from the user.
 * @returns {string} The processed code with valid Lua syntax.
 */
const replaceShortcutVariables = (code) => {
  // This regex finds a literal '$' followed by a valid Lua identifier
  // (starts with a letter or underscore, followed by letters, numbers, or underscores).
  const regex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

  // The replacement string '__BOT_STATE__.$1' uses the captured group ($1)
  // to construct the valid Lua code, e.g., '$hp' becomes '__BOT_STATE__.hp'.
  return code.replace(regex, '__BOT_STATE__.$1');
};

/**
 * Preprocesses a raw Lua script string to handle custom syntax.
 * This now runs as a two-step process:
 * 1. Replaces '$' shortcut variables (e.g., `$hp`) with their valid form (`__BOT_STATE__.hp`).
 * 2. Appends `:await()` to specified async function calls for wasmoon compatibility.
 *
 * @param {string} scriptCode - The raw Lua script to preprocess.
 * @param {string[]} asyncFunctionNames - A list of function names that are asynchronous and return Promises.
 * @returns {string} The fully processed script with valid syntax, ready for execution.
 */
export function preprocessLuaScript(scriptCode, asyncFunctionNames) {
  // Step 1: Replace the convenient '$' variables first.
  let processedCode = replaceShortcutVariables(scriptCode);

  // Step 2: Apply the async/await transformation to the result of Step 1.
  if (!asyncFunctionNames || asyncFunctionNames.length === 0) {
    return processedCode;
  }

  // Build a dynamic regex to match any of the specified async function names.
  const funcNamePattern = asyncFunctionNames.join('|');
  const regex = new RegExp(`\\b(${funcNamePattern})\\s*\\([^)]*\\)`, 'g');

  processedCode = processedCode.replace(regex, (match) => {
    // To prevent redundant additions, check if the function call already ends with ':await()'.
    if (match.endsWith(':await()')) {
      return match;
    }
    // Append the await call to the matched function string.
    return `${match}:await()`;
  });

  return processedCode;
}
