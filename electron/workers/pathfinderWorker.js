import { start } from './pathfinder/core.js';

start().catch((err) => {
  console.error('[PathfinderWorker] Failed to start worker core:', err);
  process.exit(1);
});
