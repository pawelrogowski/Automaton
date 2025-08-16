// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/pathfinderSlice.js
// --- NEW FILE ---

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  pathWaypoints: [],
  wptDistance: null,
  routeSearchMs: 0,
  pathfindingStatus: 'IDLE', // e.g., 'IDLE', 'PATH_FOUND', 'NO_PATH_FOUND'
};

const pathfinderSlice = createSlice({
  name: 'pathfinder',
  initialState,
  reducers: {
    /**
     * Sets the feedback from the pathfinder worker. This is the primary way
     * the pathfinder communicates its results to the rest of the application.
     * @param {object} state - The current state.
     * @param {object} action - The action object containing the pathfinding results.
     */
    setPathfindingFeedback: (state, action) => {
      const { pathWaypoints, wptDistance, routeSearchMs, pathfindingStatus } =
        action.payload;
      state.pathWaypoints = pathWaypoints;
      state.wptDistance = wptDistance;
      state.routeSearchMs = routeSearchMs;
      if (pathfindingStatus) {
        state.pathfindingStatus = pathfindingStatus;
      }
    },
    /**
     * Resets the pathfinder state to its initial values.
     */
    resetPathfinder: (state) => {
      Object.assign(state, initialState);
    },
    /**
     * Replaces the entire slice state. Use with caution.
     */
    setState: (state, action) => {
      return { ...initialState, ...(action.payload || {}) };
    },
  },
});

export const { setPathfindingFeedback, resetPathfinder, setState } =
  pathfinderSlice.actions;

export default pathfinderSlice;
