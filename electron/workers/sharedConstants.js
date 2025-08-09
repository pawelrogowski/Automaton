// --- SharedArrayBuffer (SAB) Indices for Player Position ---
// This section is unchanged.
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

// NEW: Added a dedicated index for the pathfinder's status result.
export const PATHFINDING_STATUS_INDEX = 5;

// SHIFTED: The update counter is shifted to make room for the new status index.
export const PATH_UPDATE_COUNTER_INDEX = 6;

// SHIFTED: The start of the waypoint data is shifted accordingly.
export const PATH_WAYPOINTS_START_INDEX = 7;

// --- Path Data Configuration ---
export const MAX_PATH_WAYPOINTS = 1000;
export const PATH_WAYPOINT_SIZE = 3; // Each waypoint is x, y, z

// The size calculation automatically adjusts to the new layout.
export const PATH_DATA_SAB_SIZE =
  PATH_WAYPOINTS_START_INDEX + MAX_PATH_WAYPOINTS * PATH_WAYPOINT_SIZE;

// --- NEW: Definitive Status Codes for Pathfinder Communication ---
// These codes are written by the pathfinder and read by the cavebot worker.
export const PATH_STATUS_IDLE = 0; // Initial state, no calculation done yet.
export const PATH_STATUS_PATH_FOUND = 1; // A valid path was found.
export const PATH_STATUS_WAYPOINT_REACHED = 2; // The start point is the destination.
export const PATH_STATUS_NO_PATH_FOUND = 3; // The destination is unreachable.
export const PATH_STATUS_DIFFERENT_FLOOR = 4; // Start and end are on different z-levels.
export const PATH_STATUS_ERROR = 5; // An unexpected error occurred during pathfinding.
export const PATH_STATUS_NO_VALID_START_OR_END = 6; // Start or end point is in an unwalkable area with no nearby valid points.
