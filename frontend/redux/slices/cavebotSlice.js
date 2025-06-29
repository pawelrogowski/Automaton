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
  enabled: false, // State for the entire cavebot system
  wptId: 'null',
  wptSelection: null,
  currentSection: 'default',
  wptDistance: 0,
  routeSearchMs: 0,
  standTime: 0, // Time in ms the player has been stationary
  waypointSections: {
    default: {
      name: 'Default',
      waypoints: [],
    },
  },
  pathWaypoints: [],
  // The main array for our special avoidance areas
  specialAreas: [],
};

const cavebotSlice = createSlice({
  name: 'cavebot',
  initialState,
  reducers: {
    // --- GENERAL & WAYPOINT REDUCERS ---

    setenabled: (state, action) => {
      state.enabled = action.payload;
    },

    setwptId: (state, action) => {
      const newWptId = action.payload;
      // This atomic update is the critical fix for the waypoint skipping race condition.
      if (state.wptId !== newWptId) {
        state.wptId = newWptId;
        state.pathWaypoints = [];
        state.wptDistance = null;
        state.routeSearchMs = 0;
      }
    },

    setwptSelection: (state, action) => {
      state.wptSelection = action.payload;
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

    setStandTime: (state, action) => {
      state.standTime = action.payload;
    },

    // --- WAYPOINT-SPECIFIC REDUCERS ---

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
        id: action.payload.id,
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

    updateWaypoint: (state, action) => {
      const { id, updates } = action.payload;
      const existingWaypoint = state.waypointSections[state.currentSection].waypoints.find((waypoint) => waypoint.id === id);
      if (existingWaypoint) {
        const parsedUpdates = parseLegacyCoordinates(updates);
        Object.assign(existingWaypoint, parsedUpdates);
      }
    },

    // --- WAYPOINT SECTION REDUCERS ---

    addWaypointSection: (state, action) => {
      const { id, name } = action.payload;
      if (!state.waypointSections[id]) {
        state.waypointSections[id] = { name, waypoints: [] };
        state.currentSection = id;
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
        state.wptSelection = null;
        state.wptId = 'null';
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

    // --- SPECIAL AREA REDUCERS ---

    addSpecialArea: (state, action) => {
      const newArea = {
        name: `Area ${state.specialAreas.length + 1}`,
        x: 0,
        y: 0,
        z: 0,
        sizeX: 1,
        sizeY: 1,
        avoidance: 100,
        type: 'cavebot',
        enabled: true,
        ...action.payload,
      };

      if (!newArea.id) {
        console.error('Action `addSpecialArea` requires an `id` in the payload.');
        return;
      }
      const idExists = state.specialAreas.some((area) => area.id === newArea.id);
      if (idExists) {
        console.error(`FATAL: Attempted to add special area with a duplicate ID: ${newArea.id}`);
        return;
      }
      const nameExists = state.specialAreas.some((area) => area.name === newArea.name);
      if (nameExists) {
        console.warn(`Special area with name "${newArea.name}" already exists.`);
        return;
      }

      state.specialAreas.push(newArea);
    },

    removeSpecialArea: (state, action) => {
      const idToRemove = action.payload;
      state.specialAreas = state.specialAreas.filter((area) => area.id !== idToRemove);
    },

    updateSpecialArea: (state, action) => {
      const { id, updates } = action.payload;
      const existingArea = state.specialAreas.find((area) => area.id === id);

      if (existingArea) {
        if (updates.name && state.specialAreas.some((area) => area.id !== id && area.name === updates.name)) {
          console.warn(`Special area with name "${updates.name}" already exists.`);
          delete updates.name;
        }
        Object.assign(existingArea, updates);
      }
    },
  },
});

export const {
  // General
  setenabled,
  setState,
  // Pathing & State
  setwptId,
  setwptSelection,
  setPathfindingFeedback,
  setStandTime,
  // Waypoints
  addWaypoint,
  removeWaypoint,
  reorderWaypoints,
  updateWaypoint,
  // Waypoint Sections
  addWaypointSection,
  removeWaypointSection,
  setCurrentWaypointSection,
  renameWaypointSection,
  // Special Areas
  addSpecialArea,
  removeSpecialArea,
  updateSpecialArea,
} = cavebotSlice.actions;

export default cavebotSlice;
