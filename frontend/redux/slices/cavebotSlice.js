import { createSlice } from '@reduxjs/toolkit';

/**
 * A helper function whose ONLY job is to convert a legacy 'coordinates' string
 * into separate x, y, z properties. It no longer adds default values.
 * @param {object} payload - The object that might contain a `coordinates` string.
 * @returns {object} The payload with x, y, z properties if parsing occurred.
 */
const parseLegacyCoordinates = (payload) => {
  // If the old 'coordinates' string exists, parse it.
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

  // CORRECTED FALLBACK: If there's nothing to parse, return the original object.
  // This is the key fix that prevents default coordinates from being added during an update.
  return payload;
};

const initialState = {
  waypoints: [],
  isCavebotEnabled: false,
  currentWaypointId: null,
  selectedWaypointId: null,
};

const cavebotSlice = createSlice({
  name: 'cavebot',
  initialState,
  reducers: {
    addWaypoint: (state, action) => {
      // 1. Parse the payload in case it's in the old format.
      const parsedPayload = parseLegacyCoordinates(action.payload);

      // 2. Define the complete structure of a new waypoint with all required defaults.
      // This is the single source of truth for a new waypoint's shape.
      const newWaypoint = {
        type: 'Node',
        label: '',
        x: 0,
        y: 0,
        z: 0,
        range: 5,
        action: '',
        ...parsedPayload, // Let the incoming payload overwrite any defaults.
      };

      state.waypoints.push(newWaypoint);
      // Re-index all waypoints to ensure IDs are sequential and padded.
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
    },

    removeWaypoint: (state, action) => {
      const idToRemove = action.payload;
      if (state.selectedWaypointId === idToRemove) {
        state.selectedWaypointId = null;
      }
      state.waypoints = state.waypoints.filter((waypoint) => waypoint.id !== idToRemove);
      // Re-index after removing to keep IDs consistent.
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
    },

    reorderWaypoints: (state, action) => {
      const { startIndex, endIndex } = action.payload;
      const [removed] = state.waypoints.splice(startIndex, 1);
      state.waypoints.splice(endIndex, 0, removed);
      // Re-index after reordering.
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
    },

    setIsCavebotEnabled: (state, action) => {
      state.isCavebotEnabled = action.payload;
    },

    setCurrentWaypointId: (state, action) => {
      state.currentWaypointId = action.payload;
    },

    setSelectedWaypointId: (state, action) => {
      state.selectedWaypointId = action.payload;
    },

    updateWaypoint: (state, action) => {
      const { id, updates } = action.payload;
      const existingWaypoint = state.waypoints.find((waypoint) => waypoint.id === id);

      if (existingWaypoint) {
        // First, check if the `updates` object is in the legacy format.
        const parsedUpdates = parseLegacyCoordinates(updates);

        // Then, merge the parsed updates into the existing waypoint.
        // Because `parseLegacyCoordinates` no longer adds default x,y,z,
        // an update like { action: 'new code' } will ONLY update the action.
        Object.assign(existingWaypoint, parsedUpdates);
      }
    },
    setState: (state, action) => {
      // A robust way to set state is to merge the loaded payload
      // with the initial state. This ensures that if you add new properties
      // to the slice in the future, they will get their default values
      // if they aren't present in an older save file.
      return {
        ...initialState,
        ...(action.payload || {}),
      };
    },
  },
});

export const {
  addWaypoint,
  removeWaypoint,
  reorderWaypoints,
  setIsCavebotEnabled,
  setCurrentWaypointId,
  setSelectedWaypointId,
  updateWaypoint,
} = cavebotSlice.actions;

export default cavebotSlice;
