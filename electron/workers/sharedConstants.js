// /home/feiron/Dokumenty/Automaton/electron/workers/sharedConstants.js

// --- SharedArrayBuffer (SAB) Indices for Player Position ---
export const PLAYER_X_INDEX = 0;
export const PLAYER_Y_INDEX = 1;
export const PLAYER_Z_INDEX = 2;
export const PLAYER_POS_UPDATE_COUNTER_INDEX = 3;
export const PLAYER_POS_SAB_SIZE = 4; // x, y, z, counter

// --- SharedArrayBuffer (SAB) Indices for Pathfinder Data ---
export const PATH_LENGTH_INDEX = 0;
export const PATH_CHEBYSHEV_DISTANCE_INDEX = 1;
export const PATH_START_X_INDEX = 2;
export const PATH_START_Y_INDEX = 3;
export const PATH_START_Z_INDEX = 4;
export const PATHFINDING_STATUS_INDEX = 5;
export const PATH_UPDATE_COUNTER_INDEX = 6;
export const PATH_WAYPOINTS_START_INDEX = 7;

// --- Path Data Configuration ---
export const MAX_PATH_WAYPOINTS = 1000;
export const PATH_WAYPOINT_SIZE = 3; // Each waypoint is x, y, z
export const PATH_DATA_SAB_SIZE =
  PATH_WAYPOINTS_START_INDEX + MAX_PATH_WAYPOINTS * PATH_WAYPOINT_SIZE;

// --- REMOVED: All constants related to creaturePosSAB are gone ---

// --- Pathfinder Status Codes ---
export const PATH_STATUS_IDLE = 0;
export const PATH_STATUS_PATH_FOUND = 1;
export const PATH_STATUS_WAYPOINT_REACHED = 2;
export const PATH_STATUS_NO_PATH_FOUND = 3;
export const PATH_STATUS_DIFFERENT_FLOOR = 4;
export const PATH_STATUS_ERROR = 5;
export const PATH_STATUS_NO_VALID_START_OR_END = 6;
