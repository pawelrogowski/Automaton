// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/pathfinderSlice.js
// --- NEW FILE ---

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  version: 0,

  // Legacy/general fields (kept for compatibility if still used anywhere)
  pathWaypoints: [],
  wptDistance: null,
  routeSearchMs: 0,
  pathfindingStatus: 'IDLE', // e.g., 'IDLE', 'PATH_FOUND', 'NO_PATH_FOUND'

  // Dedicated cavebot path exposure (from cavebotPathData SAB channel)
  cavebotPathWaypoints: [],
  cavebotPathStatus: 'IDLE',
  cavebotPathDistance: null,

  // Dedicated targeting path exposure (from targetingPathData SAB channel)
  targetingPathWaypoints: [],
  targetingPathStatus: 'IDLE',
  targetingPathDistance: null,
};

const pathfinderSlice = createSlice({
  name: 'pathfinder',
  initialState,
  reducers: {
    /**
     * Sets the feedback from the pathfinder worker.
     * Kept primarily for backwards compatibility / generic usage.
     */
    setPathfindingFeedback: (state, action) => {
      const {
        pathWaypoints,
        wptDistance,
        routeSearchMs,
        pathfindingStatus,
      } = action.payload || {};

      if (pathWaypoints !== undefined) state.pathWaypoints = pathWaypoints;
      if (wptDistance !== undefined) state.wptDistance = wptDistance;
      if (routeSearchMs !== undefined) state.routeSearchMs = routeSearchMs;
      if (pathfindingStatus) state.pathfindingStatus = pathfindingStatus;

      state.version = (state.version || 0) + 1;
    },
    /**
     * Individual property setters for efficient updates from SAB
     */
    pathWaypoints: (state, action) => {
      state.pathWaypoints = action.payload;
      state.version = (state.version || 0) + 1;
    },
    wptDistance: (state, action) => {
      state.wptDistance = action.payload;
      state.version = (state.version || 0) + 1;
    },
    pathfindingStatus: (state, action) => {
      state.pathfindingStatus = action.payload;
      state.version = (state.version || 0) + 1;
    },
    routeSearchMs: (state, action) => {
      state.routeSearchMs = action.payload;
      state.version = (state.version || 0) + 1;
    },

    /**
     * Explicit cavebot path channel setter.
     * payload: { waypoints, status, chebyshevDistance }
     */
    setCavebotPath: (state, action) => {
      const { waypoints, status, chebyshevDistance } = action.payload || {};
      state.cavebotPathWaypoints = Array.isArray(waypoints) ? waypoints : [];
      state.cavebotPathStatus = status || 'IDLE';
      state.cavebotPathDistance =
        typeof chebyshevDistance === 'number' ? chebyshevDistance : null;
      state.version = (state.version || 0) + 1;
    },

    /**
     * Explicit targeting path channel setter.
     * payload: { waypoints, status, chebyshevDistance }
     */
    setTargetingPath: (state, action) => {
      const { waypoints, status, chebyshevDistance } = action.payload || {};
      state.targetingPathWaypoints = Array.isArray(waypoints) ? waypoints : [];
      state.targetingPathStatus = status || 'IDLE';
      state.targetingPathDistance =
        typeof chebyshevDistance === 'number' ? chebyshevDistance : null;
      state.version = (state.version || 0) + 1;
    },
    /**
     * Resets the pathfinder state to its initial values.
     */
    resetPathfinder: (state) => {
      Object.assign(state, initialState);
      state.version = (state.version || 0) + 1;
    },
    /**
     * Replaces the entire slice state. Use with caution.
     */
    setState: (state, action) => {
      return { ...initialState, ...(action.payload || {}) };
    },
  },
});

export const {
  setPathfindingFeedback,
  pathWaypoints,
  wptDistance,
  pathfindingStatus,
  routeSearchMs,
  resetPathfinder,
  setState,
  setCavebotPath,
  setTargetingPath,
} = pathfinderSlice.actions;

export default pathfinderSlice;
