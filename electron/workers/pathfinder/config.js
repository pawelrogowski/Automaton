import path from 'path';

// --- Performance Logging ---
export const PERFORMANCE_LOGGING_ENABLED = true;
export const PERFORMANCE_LOG_INTERVAL_MS = 10000;

// --- File Paths ---
export const PREPROCESSED_BASE_DIR = path.join(
  process.cwd(),
  'resources',
  'preprocessed_minimaps',
);

console.log('PREPROCESSED_BASE_DIR:', process.cwd());
// --- Logic Constants ---
// Maps a waypoint type to the type of special avoidance area it should respect.
export const WAYPOINT_AVOIDANCE_MAP = {
  Node: 'cavebot',
  Stand: 'cavebot',
  Ladder: 'cavebot',
  Script: 'cavebot',
  Lure: 'targeting',
};
