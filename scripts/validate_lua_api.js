#!/usr/bin/env node

/**
 * Lua API Validation Script
 *
 * This script validates that all the new and fixed Lua API functions
 * are properly implemented in the Automaton system.
 *
 * Usage: node validate_lua_api.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// Expected functions that should be implemented
const expectedFunctions = [
  'caround',
  'paround',
  'npcaround',
  'maround',
  'wptDistance',
  'isTileReachable',
];

// Expected state variables
const expectedStateVars = [
  'target.x',
  'target.y',
  'target.z',
  'target.distance',
  'target.name',
];

// Files to check
const filesToCheck = [
  '../electron/workers/luaApi.js',
  '../electron/workers/cavebotLuaExecutor.js',
  '../electron/workers/luaScriptWorker.js',
  '../electron/workers/cavebot/index.js',
  '../docs/LUA_API.md',
];

class LuaApiValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.successes = [];
  }

  log(type, message) {
    const timestamp = new Date().toISOString();
    switch (type) {
      case 'success':
        console.log(`${colors.green}✓${colors.reset} ${message}`);
        this.successes.push(message);
        break;
      case 'error':
        console.log(`${colors.red}✗${colors.reset} ${message}`);
        this.errors.push(message);
        break;
      case 'warning':
        console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
        this.warnings.push(message);
        break;
      case 'info':
        console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
        break;
    }
  }

  validateFileExists(filePath) {
    const fullPath = path.resolve(__dirname, filePath);
    if (fs.existsSync(fullPath)) {
      this.log('success', `File exists: ${filePath}`);
      return true;
    } else {
      this.log('error', `File missing: ${filePath}`);
      return false;
    }
  }

  validateFunctionImplementation(filePath, functionName) {
    const fullPath = path.resolve(__dirname, filePath);

    try {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check for function definition patterns
      const patterns = [
        new RegExp(`${functionName}\\s*:\\s*\\([^)]*\\)\\s*=>`, 'g'),
        new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*{`, 'g'),
        new RegExp(`['"]${functionName}['"]\\s*:\\s*\\([^)]*\\)\\s*=>`, 'g'),
        new RegExp(`${functionName}\\s*=\\s*\\([^)]*\\)\\s*=>`, 'g'),
      ];

      // Special handling for functions without parameters
      if (functionName === 'paround' || functionName === 'npcaround') {
        patterns.push(new RegExp(`${functionName}\\s*:\\s*\\(\\)\\s*=>`, 'g'));
        patterns.push(new RegExp(`${functionName}\\s*=\\s*\\(\\)\\s*=>`, 'g'));
      }

      let found = false;
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          found = true;
          break;
        }
      }

      if (found) {
        this.log('success', `Function ${functionName} found in ${filePath}`);
        return true;
      } else {
        this.log(
          'warning',
          `Function ${functionName} not found in ${filePath}`,
        );
        return false;
      }
    } catch (error) {
      this.log('error', `Error reading ${filePath}: ${error.message}`);
      return false;
    }
  }

  validateStateVariable(filePath, varPath) {
    const fullPath = path.resolve(__dirname, filePath);

    try {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check for state variable patterns
      const patterns = [
        new RegExp(`target\\.x`, 'g'),
        new RegExp(`target\\.y`, 'g'),
        new RegExp(`target\\.z`, 'g'),
        new RegExp(`targetX`, 'g'),
        new RegExp(`targetY`, 'g'),
        new RegExp(`targetZ`, 'g'),
      ];

      let found = false;
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          found = true;
          break;
        }
      }

      if (found) {
        this.log('success', `Target coordinate handling found in ${filePath}`);
        return true;
      } else {
        this.log(
          'warning',
          `Target coordinate handling not found in ${filePath}`,
        );
        return false;
      }
    } catch (error) {
      this.log('error', `Error reading ${filePath}: ${error.message}`);
      return false;
    }
  }

  validateDocumentation() {
    const docPath = path.resolve(__dirname, '../docs/LUA_API.md');

    if (!this.validateFileExists('../docs/LUA_API.md')) {
      return false;
    }

    try {
      const content = fs.readFileSync(docPath, 'utf8');
      let allDocumented = true;

      for (const func of expectedFunctions) {
        if (content.includes(func)) {
          this.log('success', `Function ${func} documented in LUA_API.md`);
        } else {
          this.log('error', `Function ${func} not documented in LUA_API.md`);
          allDocumented = false;
        }
      }

      return allDocumented;
    } catch (error) {
      this.log('error', `Error reading documentation: ${error.message}`);
      return false;
    }
  }

  validateAsyncFunctionsList() {
    const luaApiPath = path.resolve(__dirname, '../electron/workers/luaApi.js');

    try {
      const content = fs.readFileSync(luaApiPath, 'utf8');

      // Check if isTileReachable is in asyncFunctionNames array
      const asyncFunctionNamesMatch = content.match(
        /const asyncFunctionNames = \[([\s\S]*?)\]/,
      );

      if (asyncFunctionNamesMatch) {
        const asyncFunctions = asyncFunctionNamesMatch[1];
        if (asyncFunctions.includes('isTileReachable')) {
          this.log(
            'success',
            'isTileReachable properly marked as async function',
          );
        } else {
          this.log('error', 'isTileReachable not marked as async function');
        }
      } else {
        this.log('warning', 'Could not find asyncFunctionNames array');
      }
    } catch (error) {
      this.log('error', `Error validating async functions: ${error.message}`);
    }
  }

  validateContextIntegration() {
    const cavebotPath = path.resolve(
      __dirname,
      '../electron/workers/cavebot/index.js',
    );
    const scriptWorkerPath = path.resolve(
      __dirname,
      '../electron/workers/luaScriptWorker.js',
    );

    // Check if pathfinder integration is added to both workers
    const files = [
      { path: cavebotPath, name: 'cavebot worker' },
      { path: scriptWorkerPath, name: 'script worker' },
    ];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        if (
          content.includes('pathfinderInstance') &&
          content.includes('Pathfinder')
        ) {
          this.log('success', `Pathfinder integration found in ${file.name}`);
        } else {
          this.log('error', `Pathfinder integration missing in ${file.name}`);
        }
      } catch (error) {
        this.log('error', `Error checking ${file.name}: ${error.message}`);
      }
    }
  }

  validateTestFiles() {
    const testFiles = [
      '../docs/lua_api_test.lua',
      '../docs/LUA_API_USAGE_GUIDE.md',
      '../docs/LUA_API_TROUBLESHOOTING.md',
    ];

    for (const testFile of testFiles) {
      if (this.validateFileExists(testFile)) {
        this.log('success', `Test/documentation file exists: ${testFile}`);
      }
    }
  }

  validateStateShortcuts() {
    const luaApiPath = path.resolve(__dirname, '../electron/workers/luaApi.js');

    try {
      const content = fs.readFileSync(luaApiPath, 'utf8');

      // Check for target state shortcut improvements
      if (
        content.includes('gameCoords?.x') ||
        content.includes('gameCoords.x')
      ) {
        this.log('success', 'Target coordinate improvements found');
      } else {
        this.log('warning', 'Target coordinate improvements not found');
      }

      // Check for wptDistance state shortcut
      if (content.includes('pathfinder?.wptDistance')) {
        this.log('success', 'Pathfinder wptDistance integration found');
      } else {
        this.log('warning', 'Pathfinder wptDistance integration not found');
      }
    } catch (error) {
      this.log('error', `Error validating state shortcuts: ${error.message}`);
    }
  }

  async run() {
    console.log(
      `${colors.bold}${colors.blue}Lua API Implementation Validator${colors.reset}\n`,
    );

    // Check if all required files exist
    this.log('info', 'Checking file existence...');
    for (const file of filesToCheck) {
      this.validateFileExists(file);
    }

    console.log('\n');
    this.log('info', 'Validating function implementations...');

    // Check function implementations in luaApi.js
    const luaApiPath = '../electron/workers/luaApi.js';
    for (const func of expectedFunctions) {
      this.validateFunctionImplementation(luaApiPath, func);
    }

    console.log('\n');
    this.log('info', 'Validating target coordinate fixes...');
    this.validateStateVariable(luaApiPath, 'target');

    console.log('\n');
    this.log('info', 'Validating documentation...');
    this.validateDocumentation();

    console.log('\n');
    this.log('info', 'Validating async function configuration...');
    this.validateAsyncFunctionsList();

    console.log('\n');
    this.log('info', 'Validating worker context integration...');
    this.validateContextIntegration();

    console.log('\n');
    this.log('info', 'Validating test and documentation files...');
    this.validateTestFiles();

    console.log('\n');
    this.log('info', 'Validating state shortcuts...');
    this.validateStateShortcuts();

    // Final report
    console.log(`\n${colors.bold}Validation Summary:${colors.reset}`);
    console.log(
      `${colors.green}Successes: ${this.successes.length}${colors.reset}`,
    );
    console.log(
      `${colors.yellow}Warnings: ${this.warnings.length}${colors.reset}`,
    );
    console.log(`${colors.red}Errors: ${this.errors.length}${colors.reset}`);

    if (this.errors.length === 0) {
      console.log(
        `\n${colors.green}${colors.bold}✓ All critical validations passed!${colors.reset}`,
      );
      console.log('The Lua API implementation appears to be complete.');

      if (this.warnings.length > 0) {
        console.log(
          `\n${colors.yellow}Note: There are ${this.warnings.length} warnings that should be reviewed.${colors.reset}`,
        );
      }
    } else {
      console.log(
        `\n${colors.red}${colors.bold}✗ Validation failed with ${this.errors.length} errors.${colors.reset}`,
      );
      console.log('Please fix the errors above before using the API.');
    }

    console.log(
      `\n${colors.blue}To test the API functions, run the test script in your bot:${colors.reset}`,
    );
    console.log('Load and execute: docs/lua_api_test.lua');

    console.log(`\n${colors.blue}Function Usage Notes:${colors.reset}`);
    console.log(
      '- caround(distance) - counts creatures (all if no distance, within distance if specified)',
    );
    console.log(
      '- paround() - counts total visible players (no distance param)',
    );
    console.log(
      '- npcaround() - counts total visible NPCs (no distance param)',
    );
    console.log(
      '- maround() - counts total battle list monsters (no distance param)',
    );
    console.log(
      '- isTileReachable(x,y,z) - uses actual pathfinder engine for reachability',
    );

    return this.errors.length === 0;
  }
}

// Run validation if this script is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const validator = new LuaApiValidator();
  validator
    .run()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error(
        `${colors.red}Validation failed with error: ${error.message}${colors.reset}`,
      );
      process.exit(1);
    });
}

export default LuaApiValidator;
