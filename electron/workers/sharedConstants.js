// --- SharedArrayBuffer (SAB) Indices for Player Position ---
export const PLAYER_X_INDEX = 0;
export const PLAYER_Y_INDEX = 1;
export const PLAYER_Z_INDEX = 2;
export const PLAYER_POS_UPDATE_COUNTER_INDEX = 3;
export const PLAYER_POS_SAB_SIZE = 4; // x, y, z, counter

// --- SharedArrayBuffer (SAB) Indices for Pathfinder Data ---
export const PATH_LENGTH_INDEX = 0;
export const PATH_CHEBYSHEV_DISTANCE_INDEX = 1; // Chebyshev distance from start to target
export const PATH_START_X_INDEX = 2;
export const PATH_START_Y_INDEX = 3;
export const PATH_START_Z_INDEX = 4;
export const PATH_UPDATE_COUNTER_INDEX = 5;
export const PATH_WAYPOINTS_START_INDEX = 6; // Each waypoint is x, y, z (3 Int32)
export const MAX_PATH_WAYPOINTS = 1000;
export const PATH_WAYPOINT_SIZE = 3; // x, y, z
export const PATH_DATA_SAB_SIZE =
  PATH_WAYPOINTS_START_INDEX + MAX_PATH_WAYPOINTS * PATH_WAYPOINT_SIZE; // length, chebyshev_distance, start_x, start_y, start_z, counter, then 1000 * (x,y,z)
