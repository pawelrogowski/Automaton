/**
 * @file pathfinderWorker.js
 * @summary A dedicated worker for all pathfinding calculations.
 * @description This file is the entry point for the pathfinder worker. It delegates
 * all logic to the modules in the /pathfinder sub-directory for maintainability.
 */

import { start } from './pathfinder/core.js';

start().catch((err) => {
  // This catch is for errors during the initial `start` execution itself,
  // though most errors within the worker are handled by the core module.
  console.error('[PathfinderWorker] Failed to start worker core:', err);
  process.exit(1);
});
