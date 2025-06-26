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
  enabled: false, // State for cavebot enable/disable
  wptId: 'null',
  wptSelection: null,
  currentSection: 'default', // New state to track the active section
  wptDistance: 0,
  routeSearchMs: 0,
  waypointSections: {
    default: {
      name: 'Default',
      waypoints: [],
    },
  },
  pathWaypoints: [],
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
        id: action.payload.id, // ID is now passed from the frontend component
      };
      const currentWaypoints = state.waypointSections[state.currentSection].waypoints;
      const selectedIndex = currentWaypoints.findIndex((waypoint) => waypoint.id === state.wptSelection);
      let newWaypointIndex;
      if (selectedIndex > -1) {
        newWaypointIndex = selectedIndex + 1;
        currentWaypoints.splice(newWaypointIndex, 0, newWaypoint);
      } else {
        currentWaypoints.push(newWaypoint);
        newWaypointIndex = currentWaypoints.length - 1;
      }
      if (currentWaypoints[newWaypointIndex]) {
        state.wptSelection = currentWaypoints[newWaypointIndex].id;
      }
    },
    removeWaypoint: (state, action) => {
      const idToRemove = action.payload;
      const currentWaypoints = state.waypointSections[state.currentSection].waypoints;
      const indexToRemove = currentWaypoints.findIndex((waypoint) => waypoint.id === idToRemove);
      if (indexToRemove === -1) {
        return;
      }
      const isRemovingSelected = state.wptSelection === idToRemove;
      let newSelectedIndex = -1;
      if (isRemovingSelected) {
        newSelectedIndex = Math.min(indexToRemove, currentWaypoints.length - 2);
      }
      currentWaypoints.splice(indexToRemove, 1);
      if (isRemovingSelected) {
        if (currentWaypoints.length === 0) {
          state.wptSelection = null;
        } else {
          state.wptSelection = currentWaypoints[newSelectedIndex].id;
        }
      }
    },
    reorderWaypoints: (state, action) => {
      const { startIndex, endIndex } = action.payload;
      const currentWaypoints = state.waypointSections[state.currentSection].waypoints;
      const [removed] = currentWaypoints.splice(startIndex, 1);
      currentWaypoints.splice(endIndex, 0, removed);
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
      const existingWaypoint = state.waypointSections[state.currentSection].waypoints.find((waypoint) => waypoint.id === id);
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
    addWaypointSection: (state, action) => {
      const { id, name } = action.payload;
      if (!state.waypointSections[id]) {
        state.waypointSections[id] = { name, waypoints: [] };
        state.currentSection = id; // Automatically switch to the new section
      }
    },
    removeWaypointSection: (state, action) => {
      const idToRemove = action.payload;
      if (idToRemove === 'default') {
        console.warn('Cannot remove the default waypoint section.');
        return;
      }
      if (state.waypointSections[idToRemove]) {
        delete state.waypointSections[idToRemove];
        if (state.currentSection === idToRemove) {
          // If the removed section was current, switch to 'default' or another available section
          state.currentSection = Object.keys(state.waypointSections)[0] || 'default';
          if (!state.waypointSections[state.currentSection]) {
            state.waypointSections['default'] = { name: 'Default', waypoints: [] };
            state.currentSection = 'default';
          }
        }
      }
    },
    setCurrentWaypointSection: (state, action) => {
      const sectionId = action.payload;
      if (state.waypointSections[sectionId]) {
        state.currentSection = sectionId;
        state.wptSelection = null; // Clear selection when changing sections
        state.wptId = 'null'; // Clear active waypoint when changing sections
      } else {
        console.warn(`Waypoint section with ID ${sectionId} not found.`);
      }
    },
    renameWaypointSection: (state, action) => {
      const { id, name } = action.payload;
      if (state.waypointSections[id]) {
        state.waypointSections[id].name = name;
      }
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
  addWaypointSection,
  removeWaypointSection,
  setCurrentWaypointSection,
  renameWaypointSection, // New action
} = cavebotSlice.actions;
export default cavebotSlice;
