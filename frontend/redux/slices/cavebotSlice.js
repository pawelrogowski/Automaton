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
    // --- MODIFIED REDUCER ---
    addWaypoint: (state, action) => {
      // 1. Prepare the new waypoint object.
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

      // 2. Determine the insertion index and store it for later.
      const selectedIndex = state.waypoints.findIndex((waypoint) => waypoint.id === state.selectedWaypointId);
      let newWaypointIndex;

      if (selectedIndex > -1) {
        // If a waypoint is selected, insert the new one after it.
        newWaypointIndex = selectedIndex + 1;
        state.waypoints.splice(newWaypointIndex, 0, newWaypoint);
      } else {
        // Otherwise, add to the end. The index will be the new last position.
        state.waypoints.push(newWaypoint);
        newWaypointIndex = state.waypoints.length - 1;
      }

      // 3. Re-index all waypoints to assign sequential IDs.
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });

      // 4. Update the selection to the newly added waypoint.
      // We use the index we saved earlier to find the waypoint (which now has its new ID).
      if (state.waypoints[newWaypointIndex]) {
        state.selectedWaypointId = state.waypoints[newWaypointIndex].id;
      }
    },

    removeWaypoint: (state, action) => {
      const idToRemove = action.payload;
      const indexToRemove = state.waypoints.findIndex((waypoint) => waypoint.id === idToRemove);

      if (indexToRemove === -1) {
        return;
      }

      const isRemovingSelected = state.selectedWaypointId === idToRemove;
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
          state.selectedWaypointId = null;
        } else {
          state.selectedWaypointId = state.waypoints[newSelectedIndex].id;
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
        const parsedUpdates = parseLegacyCoordinates(updates);
        Object.assign(existingWaypoint, parsedUpdates);
      }
    },
    setState: (state, action) => {
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
  setState,
} = cavebotSlice.actions;

export default cavebotSlice;
