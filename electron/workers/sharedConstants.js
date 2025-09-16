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
export const PATH_BLOCKING_CREATURE_X_INDEX = 7;
export const PATH_BLOCKING_CREATURE_Y_INDEX = 8;
export const PATH_BLOCKING_CREATURE_Z_INDEX = 9;
export const PATH_WAYPOINTS_START_INDEX = 10;

// --- Path Data Configuration ---
export const MAX_PATH_WAYPOINTS = 1000;
export const PATH_WAYPOINT_SIZE = 3; // Each waypoint is x, y, z
export const PATH_DATA_SAB_SIZE =
  PATH_WAYPOINTS_START_INDEX + MAX_PATH_WAYPOINTS * PATH_WAYPOINT_SIZE;

// --- REMOVED: All constants related to creaturePosSAB are gone ---

// --- SharedArrayBuffer (SAB) Indices for Battle List ---
export const BATTLE_LIST_COUNT_INDEX = 0;
export const BATTLE_LIST_UPDATE_COUNTER_INDEX = 1;
export const BATTLE_LIST_ENTRIES_START_INDEX = 2;
export const MAX_BATTLE_LIST_ENTRIES = 50;
export const BATTLE_LIST_ENTRY_SIZE = 32; // 32 chars max per name
export const BATTLE_LIST_SAB_SIZE =
  BATTLE_LIST_ENTRIES_START_INDEX +
  MAX_BATTLE_LIST_ENTRIES * BATTLE_LIST_ENTRY_SIZE;

// --- SharedArrayBuffer (SAB) Indices for Creatures ---
export const CREATURES_COUNT_INDEX = 0;
export const CREATURES_UPDATE_COUNTER_INDEX = 1;
export const CREATURES_DATA_START_INDEX = 2;
export const MAX_CREATURES = 100;
export const CREATURE_DATA_SIZE = 8; // instanceId, x, y, z, isReachable, isAdjacent, distance, reserved
export const CREATURES_SAB_SIZE =
  CREATURES_DATA_START_INDEX + MAX_CREATURES * CREATURE_DATA_SIZE;

// --- SharedArrayBuffer (SAB) Indices for Looting State ---
export const LOOTING_REQUIRED_INDEX = 0;
export const LOOTING_UPDATE_COUNTER_INDEX = 1;
export const LOOTING_SAB_SIZE = 2;

// --- SharedArrayBuffer (SAB) Indices for Targeting List ---
export const TARGETING_LIST_COUNT_INDEX = 0;
export const TARGETING_LIST_UPDATE_COUNTER_INDEX = 1;
export const TARGETING_LIST_DATA_START_INDEX = 2;
export const MAX_TARGETING_RULES = 50;
export const TARGETING_RULE_SIZE = 40; // name(32) + action(4) + priority(1) + stickiness(1) + stance(1) + distance(1)
export const TARGETING_LIST_SAB_SIZE =
  TARGETING_LIST_DATA_START_INDEX + MAX_TARGETING_RULES * TARGETING_RULE_SIZE;

// --- SharedArrayBuffer (SAB) Indices for Current Target ---
export const TARGET_INSTANCE_ID_INDEX = 0;
export const TARGET_X_INDEX = 1;
export const TARGET_Y_INDEX = 2;
export const TARGET_Z_INDEX = 3;
export const TARGET_DISTANCE_INDEX = 4; // multiplied by 100
export const TARGET_IS_REACHABLE_INDEX = 5;
export const TARGET_NAME_START_INDEX = 6;
export const TARGET_UPDATE_COUNTER_INDEX = 38; // 32 chars for name + 6 data fields
export const TARGET_SAB_SIZE = 39;

// --- Pathfinder Status Codes ---
export const PATH_STATUS_IDLE = 0;
export const PATH_STATUS_PATH_FOUND = 1;
export const PATH_STATUS_WAYPOINT_REACHED = 2;
export const PATH_STATUS_NO_PATH_FOUND = 3;
export const PATH_STATUS_DIFFERENT_FLOOR = 4;
export const PATH_STATUS_ERROR = 5;
export const PATH_STATUS_NO_VALID_START_OR_END = 6;
export const PATH_STATUS_BLOCKED_BY_CREATURE = 7;
