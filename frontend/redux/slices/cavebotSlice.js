import { createSlice } from '@reduxjs/toolkit';

/**
 * A helper function whose ONLY job is to convert a legacy 'coordinates' string
 * into separate x, y, z properties. It no longer adds default values.
 * @param {object} payload - The object that might contain a `coordinates` string.
 * @returns {object} The payload with x, y, z properties if parsing occurred.
 */
const parseLegacyCoordinates = (payload) => {
  if (typeof payload.coordinates === 'string') {
    const newPayload = { ...payload };
    const coords = newPayload.coordinates.split(',');
    coords.forEach((coord) => {
      const [key, value] = coord.split(':');
      if (key && value) {
        newPayload[key.trim()] = parseInt(value.trim(), 10);
      }
    });
    delete newPayload.coordinates; // Remove the old property
    return newPayload;
  }

  return payload;
};

const initialState = {
  waypoints: [],
  enabled: false,
  wptId: 'null',
  wptSelection: null,
  pathWaypoints: [],
  wptDistance: 0,
  routeSearchMs: 0,
};

const cavebotSlice = createSlice({
  name: 'cavebot',
  initialState,
  reducers: {
    addWaypoint: (state, action) => {
      const parsedPayload = parseLegacyCoordinates(action.payload);
      const newWaypoint = {
        type: 'Node',
        label: '',
        x: 0,
        y: 0,
        z: 0,
        range: 5,
        action: '',
        ...parsedPayload,
      };
      const selectedIndex = state.waypoints.findIndex((waypoint) => waypoint.id === state.wptSelection);
      let newWaypointIndex;
      if (selectedIndex > -1) {
        newWaypointIndex = selectedIndex + 1;
        state.waypoints.splice(newWaypointIndex, 0, newWaypoint);
      } else {
        state.waypoints.push(newWaypoint);
        newWaypointIndex = state.waypoints.length - 1;
      }
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
      if (state.waypoints[newWaypointIndex]) {
        state.wptSelection = state.waypoints[newWaypointIndex].id;
      }
    },
    removeWaypoint: (state, action) => {
      const idToRemove = action.payload;
      const indexToRemove = state.waypoints.findIndex((waypoint) => waypoint.id === idToRemove);
      if (indexToRemove === -1) {
        return;
      }
      const isRemovingSelected = state.wptSelection === idToRemove;
      let newSelectedIndex = -1;
      if (isRemovingSelected) {
        newSelectedIndex = Math.min(indexToRemove, state.waypoints.length - 2);
      }
      state.waypoints.splice(indexToRemove, 1);
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
      if (isRemovingSelected) {
        if (state.waypoints.length === 0) {
          state.wptSelection = null;
        } else {
          state.wptSelection = state.waypoints[newSelectedIndex].id;
        }
      }
    },
    reorderWaypoints: (state, action) => {
      const { startIndex, endIndex } = action.payload;
      const [removed] = state.waypoints.splice(startIndex, 1);
      state.waypoints.splice(endIndex, 0, removed);
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
    },
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },

    // LOGGING ADDED
    setwptId: (state, action) => {
      console.log(`[Redux/setwptId] Reducer called. Payload: ${action.payload}`);
      console.log(`[Redux/setwptId] State BEFORE: wptId = ${state.wptId}`);
      state.wptId = action.payload;
      console.log(`[Redux/setwptId] State AFTER: wptId = ${state.wptId}`);
    },
    // LOGGING ADDED
    setwptSelection: (state, action) => {
      console.log(`[Redux/setwptSelection] Reducer called. Payload: ${action.payload}`);
      console.log(`[Redux/setwptSelection] State BEFORE: wptSelection = ${state.wptSelection}`);
      state.wptSelection = action.payload;
      console.log(`[Redux/setwptSelection] State AFTER: wptSelection = ${state.wptSelection}`);
    },
    updateWaypoint: (state, action) => {
      const { id, updates } = action.payload;
      const existingWaypoint = state.waypoints.find((waypoint) => waypoint.id === id);
      if (existingWaypoint) {
        const parsedUpdates = parseLegacyCoordinates(updates);
        Object.assign(existingWaypoint, parsedUpdates);
      }
    },
    setState: (state, action) => {
      return { ...initialState, ...(action.payload || {}) };
    },
    setPathfindingFeedback: (state, action) => {
      const { pathWaypoints, wptDistance, routeSearchMs } = action.payload;
      state.pathWaypoints = pathWaypoints;
      state.wptDistance = wptDistance;
      state.routeSearchMs = routeSearchMs;
    },
  },
});
export const {
  addWaypoint,
  removeWaypoint,
  reorderWaypoints,
  setenabled,
  setwptId,
  setwptSelection,
  updateWaypoint,
  setState,
  setPathfindingFeedback,
} = cavebotSlice.actions;
export default cavebotSlice;
