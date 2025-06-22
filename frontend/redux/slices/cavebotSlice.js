import { createSlice } from '@reduxjs/toolkit';

// A helper function to parse the coordinate string if it exists
const parseCoordinates = (payload) => {
  // If x, y, z already exist, the format is correct. Return as is.
  if (typeof payload.x !== 'undefined') {
    return payload;
  }

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

  // Fallback for safety, though ideally all payloads are correct
  return { x: 0, y: 0, z: 0, ...payload };
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
      // Use the helper to ensure the payload is in the correct format
      const newWaypoint = parseCoordinates(action.payload);

      state.waypoints.push(newWaypoint);
      // Re-index waypoints after adding
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
    },
    removeWaypoint: (state, action) => {
      // ... (no changes needed here)
      if (state.selectedWaypointId === action.payload) {
        state.selectedWaypointId = null;
      }
      state.waypoints = state.waypoints.filter((waypoint) => waypoint.id !== action.payload);
      state.waypoints.forEach((waypoint, index) => {
        waypoint.id = (index + 1).toString().padStart(3, '0');
      });
    },
    reorderWaypoints: (state, action) => {
      // ... (no changes needed here)
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
        // Ensure updates are also parsed correctly if needed
        const parsedUpdates = parseCoordinates(updates);
        Object.assign(existingWaypoint, parsedUpdates);
      }
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
