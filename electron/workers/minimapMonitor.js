/**
 * @file minimap-monitor.js
 * @summary A dedicated worker for analyzing minimap data to determine player position.
 * @description This file is the entry point for the minimap worker. It delegates
 * all logic to the modules in the /minimap sub-directory.
 */

import { start } from './minimap/core.js';

try {
  start();
} catch (error) {
  console.error('[MinimapMonitor] Failed to start worker core:', error);
  process.exit(1);
}
