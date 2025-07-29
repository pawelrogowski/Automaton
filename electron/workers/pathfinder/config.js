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

// --- Logic Constants ---
// Maps a waypoint type to the type of special avoidance area it should respect.
export const WAYPOINT_AVOIDANCE_MAP = {
  Node: 'cavebot',
  Stand: 'cavebot',
  Shovel: 'cavebot',
  Rope: 'cavebot',
  Machete: 'cavebot',
  Ladder: 'cavebot',
  Use: 'cavebot',
  Action: 'cavebot',
  Lure: 'targeting',
  Attack: 'targeting',
};
